import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { OpsFilters } from '@/components/ops/OpsFilters'
import { OpsRealtimeRefresh } from '@/components/ops/OpsRealtimeRefresh'
import { OpsEventFeed, type OpsEventItem } from '@/components/ops/OpsEventFeed'
import { ExportKPIButton } from '@/components/ops/ExportKPIButton'
import { buildBlockHealthRows } from '@/lib/ops/block-health'
import { OpsBlockHealthTable } from '@/components/ops/OpsBlockHealthTable'
import { buildOpsKpis } from '@/lib/ops/kpis'
import { fetchBlockHealthData } from '@/lib/ops/fetch-block-health'
import type { OpsFilterParams } from '@/lib/ops/types'

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
  searchParams: OpsFilterParams
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

  const result = await fetchBlockHealthData(supabase, profile.department_id, searchParams)
  const {
    filteredBlocks,
    allBlocks,
    blockIds,
    shifts,
    pendingSwaps: pendingSwapsCount,
    pendingChangeRequests: pendingChangeCount,
    pendingPrnInterest,
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
    actualRows,
  } = result

  if (blockIds.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>
          <ExportKPIButton
            filters={{
              shift: searchParams.shift,
              blockId: searchParams.blockId,
              from: searchParams.from,
              to: searchParams.to,
            }}
          />
        </div>
        <OpsFilters shift={shift} blockId={blockId} from={from} to={to} blocks={allBlocks} />
        <p className="text-sm text-slate-500">No blocks matched your filters.</p>
      </div>
    )
  }

  const blockHealthRows = buildBlockHealthRows({
    blocks: filteredBlocks,
    shifts,
    actualRows,
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
  })

  const kpis = buildOpsKpis({
    shifts,
    pendingSwaps: pendingSwapsCount,
    pendingChangeRequests: pendingChangeCount,
    pendingPrnInterest,
    actualRows,
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>
        <ExportKPIButton
          filters={{
            shift: searchParams.shift,
            blockId: searchParams.blockId,
            from: searchParams.from,
            to: searchParams.to,
          }}
        />
      </div>

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
