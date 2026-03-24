// app/(app)/availability/open-shifts/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { OpenShiftsList } from '@/components/availability/OpenShiftsList'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type AvailEntryRow = Database['public']['Tables']['availability_entries']['Row']

export interface OpenShift {
  shiftId: string
  date: string
  blockId: string
  outsideAvailability: boolean
  alreadySignaled: boolean
}

interface PageProps {
  searchParams: { blockId?: string; shift?: string }
}

export default async function OpenShiftsPage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }

  // Only PRN therapists can access this page
  if (!profile || profile.role !== 'therapist' || profile.employment_type !== 'prn') {
    redirect('/schedule')
  }

  const blockId = searchParams.blockId
  if (!blockId) redirect('/schedule')

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('id, status')
    .eq('id', blockId)
    .single() as { data: { id: string; status: string } | null; error: unknown }

  if (!block || block.status !== 'preliminary') {
    return (
      <div className="p-8 text-sm text-slate-500">
        Open shifts are only available during a Preliminary block.{' '}
        <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // This PRN therapist's own 'off' shifts in this block (their open slots)
  const { data: myShifts } = await supabase
    .from('shifts')
    .select('id, shift_date, cell_state')
    .eq('schedule_block_id', blockId)
    .eq('user_id', user.id)
    .eq('cell_state', 'off')
    .order('shift_date', { ascending: true }) as {
      data: Pick<ShiftRow, 'id' | 'shift_date' | 'cell_state'>[] | null
      error: unknown
    }

  // Check which dates are within their submitted availability
  const { data: subData } = await supabase
    .from('availability_submissions')
    .select('id')
    .eq('schedule_block_id', blockId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  let availDates: Set<string> = new Set()
  if (subData) {
    const { data: entries } = await supabase
      .from('availability_entries')
      .select('entry_date, entry_type')
      .eq('submission_id', subData.id) as {
        data: Pick<AvailEntryRow, 'entry_date' | 'entry_type'>[] | null
        error: unknown
      }
    availDates = new Set(
      (entries ?? [])
        .filter(e => e.entry_type !== 'cannot_work')
        .map(e => e.entry_date)
    )
  }

  // Check which shifts this user has already signaled interest in
  const shiftIds = (myShifts ?? []).map(s => s.id)
  let signaledShiftIds: Set<string> = new Set()
  if (shiftIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingInterest } = await (supabase as any)
      .from('prn_shift_interest')
      .select('shift_id')
      .eq('user_id', user.id)
      .in('shift_id', shiftIds)
    signaledShiftIds = new Set<string>(
      ((existingInterest ?? []) as { shift_id: string }[]).map(i => i.shift_id)
    )
  }

  const openShifts: OpenShift[] = (myShifts ?? []).map(s => ({
    shiftId: s.id,
    date: s.shift_date,
    blockId,
    outsideAvailability: !availDates.has(s.shift_date),
    alreadySignaled: signaledShiftIds.has(s.id),
  }))

  return (
    <div className="max-w-lg mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Open Shifts</h1>
        <Link href="/schedule" className="text-sm text-slate-500 hover:text-slate-700">← Back</Link>
      </div>
      <p className="text-sm text-slate-500">
        Dates below are open in the Preliminary schedule. Signal interest and your manager will confirm.
      </p>
      <OpenShiftsList openShifts={openShifts} />
    </div>
  )
}
