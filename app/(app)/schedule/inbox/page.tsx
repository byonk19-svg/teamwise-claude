// app/(app)/schedule/inbox/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { InboxList } from '@/components/schedule/InboxList'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type ChangeReqRow = Database['public']['Tables']['preliminary_change_requests']['Row']
type PrnInterestRow = Database['public']['Tables']['prn_shift_interest']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

export interface ChangeReqWithContext extends ChangeReqRow {
  requester: Pick<UserRow, 'full_name'>
  shift: Pick<ShiftRow, 'shift_date' | 'cell_state'>
}

export interface PrnInterestWithContext extends PrnInterestRow {
  user: Pick<UserRow, 'full_name'>
  shift: Pick<ShiftRow, 'shift_date' | 'cell_state'>
}

interface PageProps {
  searchParams: { blockId?: string }
}

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  const blockId = searchParams.blockId
  if (!blockId) redirect('/schedule')

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('id, status, start_date, end_date')
    .eq('id', blockId)
    .single() as { data: { id: string; status: string; start_date: string; end_date: string } | null; error: unknown }

  if (!block || block.status !== 'preliminary') {
    return (
      <div className="p-8 text-sm text-slate-500">
        Inbox is only available for Preliminary blocks.{' '}
        <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // Pending change requests for this block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: changeReqsRaw } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*, requester:requester_id(full_name), shift:shift_id(shift_date, cell_state)')
    .eq('schedule_block_id', blockId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  // Shifts in this block (needed to filter PRN interest)
  const { data: blockShifts } = await supabase
    .from('shifts')
    .select('id')
    .eq('schedule_block_id', blockId) as { data: { id: string }[] | null; error: unknown }
  const shiftIds = (blockShifts ?? []).map(s => s.id)

  // Pending PRN interest for shifts in this block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any
  const { data: prnInterestRaw } = shiftIds.length > 0
    ? await supabaseAny
        .from('prn_shift_interest')
        .select('*, user:user_id(full_name), shift:shift_id(shift_date, cell_state)')
        .in('shift_id', shiftIds)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true })
    : { data: [] }

  const changeReqs = (changeReqsRaw ?? []) as ChangeReqWithContext[]
  const prnInterest = (prnInterestRaw ?? []) as PrnInterestWithContext[]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Preliminary Inbox</h1>
        <Link href={`/schedule?blockId=${blockId}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← Back to Schedule
        </Link>
      </div>
      <InboxList changeReqs={changeReqs} prnInterest={prnInterest} />
    </div>
  )
}
