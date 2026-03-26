'use server'

import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { buildCoverageCSV } from '@/lib/exports/build-coverage-csv'

export async function exportCoverageCSV(
  blockId: string
): Promise<{ data: string } | { error: string }> {
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

  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('shift_type, status, department_id')
    .eq('id', blockId)
    .single() as {
    data: { shift_type: string; status: string; department_id: string } | null
    error: unknown
  }
  if (!blockData) return { error: 'Block not found' }
  if (blockData.department_id !== profile.department_id) return { error: 'Access denied' }

  const { data: planned } = await supabase
    .from('shift_planned_headcount')
    .select('shift_date, total_count')
    .eq('schedule_block_id', blockId) as {
    data: Array<{ shift_date: string; total_count: number }> | null
    error: unknown
  }

  let actualMap = new Map<string, number>()
  if (blockData.status === 'active' || blockData.status === 'completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actual } = await (supabase as any)
      .from('shift_actual_headcount')
      .select('shift_date, total_actual')
      .eq('schedule_block_id', blockId) as {
      data: Array<{ shift_date: string; total_actual: number }> | null
      error: unknown
    }
    actualMap = new Map((actual ?? []).map((r) => [r.shift_date, r.total_actual]))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thresholdData } = await (supabase as any)
    .from('coverage_thresholds')
    .select('minimum_staff')
    .eq('department_id', profile.department_id)
    .eq('shift_type', blockData.shift_type)
    .single() as { data: { minimum_staff: number } | null; error: unknown }
  const threshold = thresholdData?.minimum_staff ?? 3

  const rows = (planned ?? []).map((r) => ({
    date: r.shift_date,
    shift_type: blockData.shift_type,
    planned_headcount: r.total_count,
    actual_headcount: actualMap.get(r.shift_date) ?? null,
  }))

  const csv = buildCoverageCSV(rows, threshold)
  return { data: csv }
}
