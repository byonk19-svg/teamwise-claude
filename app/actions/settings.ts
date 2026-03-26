// app/actions/settings.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { validateCoverageThresholds } from '@/lib/settings/validate'

interface ThresholdInput {
  minimum_staff: number
  ideal_staff: number
  maximum_staff: number
}

export async function updateCoverageThresholds(
  day: ThresholdInput,
  night: ThresholdInput
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  const dayErr = validateCoverageThresholds(day.minimum_staff, day.ideal_staff, day.maximum_staff)
  if (dayErr) return { error: `Day shift: ${dayErr}` }
  const nightErr = validateCoverageThresholds(
    night.minimum_staff,
    night.ideal_staff,
    night.maximum_staff
  )
  if (nightErr) return { error: `Night shift: ${nightErr}` }

  const now = new Date().toISOString()
  const rows = [
    {
      department_id: profile.department_id,
      shift_type: 'day' as const,
      ...day,
      updated_by: user.id,
      updated_at: now,
    },
    {
      department_id: profile.department_id,
      shift_type: 'night' as const,
      ...night,
      updated_by: user.id,
      updated_at: now,
    },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('coverage_thresholds')
    .upsert(rows, { onConflict: 'department_id,shift_type' })
  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}
