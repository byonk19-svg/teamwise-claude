import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface SwapRequest {
  requester_shift_id: string
  partner_shift_id: string
  status: string
}

type ShiftLite = Pick<ShiftRow, 'id' | 'schedule_block_id' | 'shift_date' | 'cell_state'>
type BlockLite = Pick<BlockRow, 'id' | 'shift_type' | 'start_date' | 'end_date' | 'status'>

function blockLabel(block: Pick<BlockRow, 'shift_type' | 'start_date' | 'end_date'>) {
  return `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`
}

function groupByBlock(shiftList: ShiftLite[]) {
  const groups = new Map<string, ShiftLite[]>()
  for (const s of shiftList) {
    const group = groups.get(s.schedule_block_id) ?? []
    group.push(s)
    groups.set(s.schedule_block_id, group)
  }
  return groups
}

function ShiftList({
  shiftList,
  blockMap,
  pendingShiftIds,
}: {
  shiftList: ShiftLite[]
  blockMap: Map<string, BlockLite>
  pendingShiftIds: Set<string>
}) {
  const groups = groupByBlock(shiftList)
  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([blockId, groupShifts]) => {
        const block = blockMap.get(blockId)
        if (!block) return null
        return (
          <div key={blockId}>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={block.shift_type === 'day' ? 'outline' : 'secondary'}>
                {block.shift_type === 'day' ? 'Day' : 'Night'}
              </Badge>
              <span className="text-sm font-medium text-slate-700">{blockLabel(block)}</span>
            </div>
            <div className="space-y-1">
              {groupShifts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-1.5 px-3 rounded-md bg-slate-50 text-sm"
                >
                  <span className="text-slate-900">
                    {format(new Date(s.shift_date + 'T00:00:00'), 'EEE, MMM d')}
                  </span>
                  {pendingShiftIds.has(s.id) && (
                    <Badge variant="secondary" className="text-xs">
                      Swap Pending
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function MySchedulePage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const profile = profileData as Pick<UserRow, 'role'> | null
  if (!profile) redirect('/login')
  if (profile.role === 'manager') redirect('/schedule')

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('id, schedule_block_id, shift_date, cell_state')
    .eq('user_id', user.id)
    .eq('cell_state', 'working')
    .order('shift_date', { ascending: true })

  const shifts = (shiftsData ?? []) as ShiftLite[]

  if (shifts.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">My Schedule</h1>
        <p className="text-slate-500 text-sm">No scheduled shifts found.</p>
      </div>
    )
  }

  const blockIds = Array.from(new Set(shifts.map((s) => s.schedule_block_id)))
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .in('id', blockIds)
    .not('status', 'eq', 'preliminary_draft')

  const blocks = (blocksData ?? []) as BlockLite[]
  const blockMap = new Map(blocks.map((b) => [b.id, b]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swapsData } = await (supabase as any)
    .from('swap_requests')
    .select('requester_shift_id, partner_shift_id, status')
    .or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`)
    .eq('status', 'pending')

  const pendingShiftIds = new Set<string>()
  for (const swap of (swapsData ?? []) as SwapRequest[]) {
    pendingShiftIds.add(swap.requester_shift_id)
    pendingShiftIds.add(swap.partner_shift_id)
  }

  const validShifts = shifts.filter((s) => blockMap.has(s.schedule_block_id))

  const upcomingStatuses = new Set(['preliminary', 'final', 'active'])
  const upcoming = validShifts.filter((s) => upcomingStatuses.has(blockMap.get(s.schedule_block_id)!.status))
  const past = validShifts.filter((s) => blockMap.get(s.schedule_block_id)!.status === 'completed')

  return (
    <div className="p-6 max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold text-slate-900">My Schedule</h1>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">Upcoming</h2>
          <ShiftList shiftList={upcoming} blockMap={blockMap} pendingShiftIds={pendingShiftIds} />
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">Past</h2>
          <ShiftList shiftList={past} blockMap={blockMap} pendingShiftIds={pendingShiftIds} />
        </section>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <p className="text-slate-500 text-sm">No scheduled shifts found.</p>
      )}
    </div>
  )
}
