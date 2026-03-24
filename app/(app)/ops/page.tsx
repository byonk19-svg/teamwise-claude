import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { OpsFilters } from '@/components/ops/OpsFilters'
import { OpsRealtimeRefresh } from '@/components/ops/OpsRealtimeRefresh'
import { OpsEventFeed, type OpsEventItem } from '@/components/ops/OpsEventFeed'
import { buildBlockHealthRows } from '@/lib/ops/block-health'
import { OpsBlockHealthTable } from '@/components/ops/OpsBlockHealthTable'
import { buildOpsKpis } from '@/lib/ops/kpis'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']
type OperationalEventRow = {
  id: string
  schedule_block_id: string
  shift_id: string
  entry_type: string
  entered_by: string
  entered_at: string
  removed_by: string | null
  removed_at: string | null
}
type SwapEventRow = {
  id: string
  schedule_block_id: string
  requester_id: string
  status: string
  created_at: string
  actioned_at: string | null
  actioned_by: string | null
}
type ChangeEventRow = {
  id: string
  schedule_block_id: string
  requester_id: string
  request_type: string
  status: string
  created_at: string
  actioned_at: string | null
  actioned_by: string | null
}
type PrnEventRow = {
  id: string
  user_id: string
  shift_id: string
  status: string
  submitted_at: string
  actioned_at: string | null
  actioned_by: string | null
}

interface PageProps {
  searchParams: {
    shift?: string
    blockId?: string
    from?: string
    to?: string
  }
}

export default async function OpsPage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')
  if (!profile.department_id) redirect('/schedule')

  const shift = searchParams.shift === 'day' || searchParams.shift === 'night' ? searchParams.shift : 'all'
  const blockId = searchParams.blockId ?? ''
  const from = searchParams.from ?? ''
  const to = searchParams.to ?? ''
  const opsQuery = new URLSearchParams()
  if (shift !== 'all') opsQuery.set('shift', shift)
  if (blockId) opsQuery.set('blockId', blockId)
  if (from) opsQuery.set('from', from)
  if (to) opsQuery.set('to', to)
  const opsQueryStr = opsQuery.toString()
  const withOpsQuery = (path: string) => (opsQueryStr ? `${path}?${opsQueryStr}` : path)

  const opsFocusParams = new URLSearchParams()
  if (shift !== 'all') opsFocusParams.set('shift', shift)
  if (from) opsFocusParams.set('from', from)
  if (to) opsFocusParams.set('to', to)
  const opsFocusQueryStr = opsFocusParams.toString()

  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .order('start_date', { ascending: false })
  const allBlocks = (blocksData ?? []) as BlockRow[]

  const filteredBlocks = allBlocks.filter((b) => {
    if (shift !== 'all' && b.shift_type !== shift) return false
    if (blockId && b.id !== blockId) return false
    return true
  })
  const blockIds = filteredBlocks.map((b) => b.id)

  if (blockIds.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>
        <OpsFilters shift={shift} blockId={blockId} from={from} to={to} blocks={allBlocks} />
        <p className="text-sm text-slate-500">No blocks matched your filters.</p>
      </div>
    )
  }

  const shiftsQuery = supabase
    .from('shifts')
    .select('id, schedule_block_id, shift_date, cell_state, lead_user_id')
    .in('schedule_block_id', blockIds)
  if (from) shiftsQuery.gte('shift_date', from)
  if (to) shiftsQuery.lte('shift_date', to)
  const { data: shiftsData } = await shiftsQuery as {
    data: Array<{
      id: string
      schedule_block_id: string
      shift_date: string
      cell_state: string
      lead_user_id: string | null
    }> | null
    error: unknown
  }
  const shifts = shiftsData ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingSwaps } = await (supabase as any)
    .from('swap_requests')
    .select('*', { count: 'exact', head: true })
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingSwapRows } = await (supabase as any)
    .from('swap_requests')
    .select('schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingChangeRequests } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*', { count: 'exact', head: true })
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingChangeRows } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingPrnRows } = await (supabase as any)
    .from('prn_shift_interest')
    .select('shift_id')
    .eq('status', 'pending') as { data: Array<{ shift_id: string }> | null; error: unknown }

  const blockShiftIds = new Set(shifts.map((s) => s.id))
  const pendingPrnInterest = (pendingPrnRows ?? []).filter((r) => blockShiftIds.has(r.shift_id)).length

  const shiftToBlockId = new Map(shifts.map((s) => [s.id, s.schedule_block_id]))
  const pendingPrnByBlockId = new Map<string, number>()
  for (const r of pendingPrnRows ?? []) {
    if (!blockShiftIds.has(r.shift_id)) continue
    const bid = shiftToBlockId.get(r.shift_id)
    if (!bid) continue
    pendingPrnByBlockId.set(bid, (pendingPrnByBlockId.get(bid) ?? 0) + 1)
  }

  const pendingSwapBlockIds = (pendingSwapRows ?? []).map(
    (r: { schedule_block_id: string }) => r.schedule_block_id
  )
  const pendingChangeBlockIds = (pendingChangeRows ?? []).map(
    (r: { schedule_block_id: string }) => r.schedule_block_id
  )

  const activeCompletedBlockIds = filteredBlocks
    .filter((b) => b.status === 'active' || b.status === 'completed')
    .map((b) => b.id)
  let actualRows: ActualHeadcountRow[] = []
  if (activeCompletedBlockIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualQuery = (supabase as any)
      .from('shift_actual_headcount')
      .select('*')
      .in('schedule_block_id', activeCompletedBlockIds)
    if (from) actualQuery.gte('shift_date', from)
    if (to) actualQuery.lte('shift_date', to)
    const { data } = await actualQuery as { data: ActualHeadcountRow[] | null; error: unknown }
    actualRows = data ?? []
  }

  const blockHealthRows = buildBlockHealthRows({
    blocks: filteredBlocks,
    shifts,
    actualRows: actualRows.map((r) => ({
      schedule_block_id: r.schedule_block_id,
      shift_date: r.shift_date,
      total_actual: r.total_actual,
    })),
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
  })

  const kpis = buildOpsKpis({
    shifts,
    pendingSwaps: pendingSwaps ?? 0,
    pendingChangeRequests: pendingChangeRequests ?? 0,
    pendingPrnInterest,
    actualRows: actualRows.map((r) => ({
      schedule_block_id: r.schedule_block_id,
      shift_date: r.shift_date,
      total_actual: r.total_actual,
    })),
  })

  const { data: usersData } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('department_id', profile.department_id) as {
      data: Array<{ id: string; full_name: string | null }> | null
      error: unknown
    }
  const userMap = new Map((usersData ?? []).map((u) => [u.id, u.full_name ?? 'unknown']))

  const shiftMetaMap = new Map(shifts.map((s) => [s.id, { date: s.shift_date, blockId: s.schedule_block_id }]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: opData } = await (supabase as any)
    .from('operational_entries')
    .select('id,schedule_block_id,shift_id,entry_type,entered_by,entered_at,removed_by,removed_at')
    .in('schedule_block_id', blockIds)
    .order('entered_at', { ascending: false })
    .limit(50) as { data: OperationalEventRow[] | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swapData } = await (supabase as any)
    .from('swap_requests')
    .select('id,schedule_block_id,requester_id,status,created_at,actioned_at,actioned_by')
    .in('schedule_block_id', blockIds)
    .order('created_at', { ascending: false })
    .limit(50) as { data: SwapEventRow[] | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: changeData } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('id,schedule_block_id,requester_id,request_type,status,created_at,actioned_at,actioned_by')
    .in('schedule_block_id', blockIds)
    .order('created_at', { ascending: false })
    .limit(50) as { data: ChangeEventRow[] | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prnData } = await (supabase as any)
    .from('prn_shift_interest')
    .select('id,user_id,shift_id,status,submitted_at,actioned_at,actioned_by')
    .order('submitted_at', { ascending: false })
    .limit(50) as { data: PrnEventRow[] | null; error: unknown }

  const events: OpsEventItem[] = []

  for (const row of opData ?? []) {
    events.push({
      id: `op-entered-${row.id}`,
      ts: row.entered_at,
      type: 'operational.entered',
      actor: userMap.get(row.entered_by) ?? row.entered_by,
      summary: `${row.entry_type} logged for ${row.shift_id}`,
      href: withOpsQuery(`/audit/${row.schedule_block_id}`),
    })
    if (row.removed_at) {
      events.push({
        id: `op-removed-${row.id}`,
        ts: row.removed_at,
        type: 'operational.removed',
        actor: row.removed_by ? (userMap.get(row.removed_by) ?? row.removed_by) : 'unknown',
        summary: `${row.entry_type} removed for ${row.shift_id}`,
        href: withOpsQuery(`/audit/${row.schedule_block_id}`),
      })
    }
  }

  for (const row of swapData ?? []) {
    events.push({
      id: `swap-submitted-${row.id}`,
      ts: row.created_at,
      type: 'swap.submitted',
      actor: userMap.get(row.requester_id) ?? row.requester_id,
      summary: `Swap request status: ${row.status}`,
      href: withOpsQuery('/swaps'),
    })
    if (row.actioned_at) {
      events.push({
        id: `swap-actioned-${row.id}`,
        ts: row.actioned_at,
        type: 'swap.resolved',
        actor: row.actioned_by ? (userMap.get(row.actioned_by) ?? row.actioned_by) : 'unknown',
        summary: `Swap resolved: ${row.status}`,
        href: withOpsQuery('/swaps'),
      })
    }
  }

  for (const row of changeData ?? []) {
    events.push({
      id: `change-submitted-${row.id}`,
      ts: row.created_at,
      type: 'change_request.submitted',
      actor: userMap.get(row.requester_id) ?? row.requester_id,
      summary: `${row.request_type} (${row.status})`,
      href: row.schedule_block_id ? `/schedule/inbox?blockId=${row.schedule_block_id}` : '/schedule',
    })
    if (row.actioned_at) {
      events.push({
        id: `change-actioned-${row.id}`,
        ts: row.actioned_at,
        type: 'change_request.resolved',
        actor: row.actioned_by ? (userMap.get(row.actioned_by) ?? row.actioned_by) : 'unknown',
        summary: `Request resolved: ${row.status}`,
        href: row.schedule_block_id ? `/schedule/inbox?blockId=${row.schedule_block_id}` : '/schedule',
      })
    }
  }

  for (const row of prnData ?? []) {
    const shiftMeta = shiftMetaMap.get(row.shift_id)
    if (!shiftMeta) continue
    events.push({
      id: `prn-submitted-${row.id}`,
      ts: row.submitted_at,
      type: 'prn_interest.submitted',
      actor: userMap.get(row.user_id) ?? row.user_id,
      summary: `Interest for ${shiftMeta.date} (${row.status})`,
      href: shiftMeta.blockId ? `/schedule/inbox?blockId=${shiftMeta.blockId}` : '/schedule',
    })
    if (row.actioned_at) {
      events.push({
        id: `prn-actioned-${row.id}`,
        ts: row.actioned_at,
        type: 'prn_interest.resolved',
        actor: row.actioned_by ? (userMap.get(row.actioned_by) ?? row.actioned_by) : 'unknown',
        summary: `Interest resolved: ${row.status}`,
        href: shiftMeta.blockId ? `/schedule/inbox?blockId=${shiftMeta.blockId}` : '/schedule',
      })
    }
  }

  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  return (
    <div className="space-y-4">
      <OpsRealtimeRefresh blockIds={blockIds} shiftIds={shifts.map((s) => s.id)} />
      <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>

      <OpsFilters
        shift={shift}
        blockId={blockId}
        from={from}
        to={to}
        blocks={allBlocks}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <a className="rounded-lg border border-slate-200 bg-white p-3 block hover:bg-slate-50" href={withOpsQuery('/schedule')}>
          <p className="text-xs text-slate-500">Lead gap dates</p>
          <p className="text-xl font-semibold text-pink-600">{kpis.leadGapDates}</p>
        </a>
        <a className="rounded-lg border border-slate-200 bg-white p-3 block hover:bg-slate-50" href={withOpsQuery('/swaps')}>
          <p className="text-xs text-slate-500">Pending swaps</p>
          <p className="text-xl font-semibold text-amber-600">{kpis.pendingSwaps}</p>
        </a>
        <a className="rounded-lg border border-slate-200 bg-white p-3 block hover:bg-slate-50" href={blockId ? `/schedule/inbox?blockId=${blockId}` : '/schedule'}>
          <p className="text-xs text-slate-500">Pending change requests</p>
          <p className="text-xl font-semibold text-slate-800">{kpis.pendingChangeRequests}</p>
        </a>
        <a className="rounded-lg border border-slate-200 bg-white p-3 block hover:bg-slate-50" href={blockId ? `/schedule/inbox?blockId=${blockId}` : '/schedule'}>
          <p className="text-xs text-slate-500">Pending PRN interests</p>
          <p className="text-xl font-semibold text-slate-800">{kpis.pendingPrnInterest}</p>
        </a>
        <a className="rounded-lg border border-slate-200 bg-white p-3 block hover:bg-slate-50" href={withOpsQuery('/coverage')}>
          <p className="text-xs text-slate-500">Low coverage dates</p>
          <p className="text-xl font-semibold text-red-600">{kpis.lowCoverageDates}</p>
        </a>
      </div>

      <OpsBlockHealthTable rows={blockHealthRows} opsFocusQueryStr={opsFocusQueryStr} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Recent Events</h2>
        <OpsEventFeed events={events.slice(0, 100)} />
      </div>
    </div>
  )
}
