// app/(app)/schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ScheduleGrid } from '@/components/schedule/ScheduleGrid'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

export default async function SchedulePage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')

  const defaultShift = (profile.default_shift_type ?? 'day') as 'day' | 'night'

  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id!)
    .eq('shift_type', defaultShift)
    .in('status', ['final', 'active', 'preliminary', 'preliminary_draft'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  const block = blockData as BlockRow | null

  if (!block) {
    return (
      <div className="text-slate-500 text-sm p-8">
        No schedule found. Ask your manager to create a block.
      </div>
    )
  }

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_block_id', block.id)

  const { data: therapistsData } = await supabase
    .from('users')
    .select('*')
    .eq('department_id', profile.department_id!)
    .eq('role', 'therapist')
    .order('employment_type', { ascending: true })
    .order('full_name', { ascending: true })

  const shifts = (shiftsData ?? []) as ShiftRow[]
  const therapists = (therapistsData ?? []) as UserRow[]

  return (
    <ScheduleGrid
      block={block}
      shifts={shifts}
      therapists={therapists}
      defaultShiftType={defaultShift}
    />
  )
}
