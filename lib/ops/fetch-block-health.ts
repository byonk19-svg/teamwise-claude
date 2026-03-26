import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import type { OpsFilterParams } from './types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

export interface BlockHealthFetchResult {
  filteredBlocks: BlockRow[]
  allBlocks: BlockRow[]
  blockIds: string[]
  shifts: Array<{
    id: string
    schedule_block_id: string
    shift_date: string
    cell_state: string
    lead_user_id: string | null
  }>
  pendingSwaps: number
  pendingChangeRequests: number
  pendingPrnInterest: number
  pendingSwapBlockIds: string[]
  pendingChangeBlockIds: string[]
  pendingPrnByBlockId: Map<string, number>
  actualRows: Array<{ schedule_block_id: string; shift_date: string; total_actual: number }>
}

export async function fetchBlockHealthData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  departmentId: string,
  filters: OpsFilterParams
): Promise<BlockHealthFetchResult> {
  const shift = filters.shift === 'day' || filters.shift === 'night' ? filters.shift : 'all'
  const blockId = filters.blockId ?? ''
  const from = filters.from ?? ''
  const to = filters.to ?? ''

  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', departmentId)
    .order('start_date', { ascending: false })
  const allBlocks = (blocksData ?? []) as BlockRow[]

  const filteredBlocks = allBlocks.filter((b) => {
    if (shift !== 'all' && b.shift_type !== shift) return false
    if (blockId && b.id !== blockId) return false
    return true
  })
  const blockIds = filteredBlocks.map((b) => b.id)

  if (blockIds.length === 0) {
    return {
      filteredBlocks,
      allBlocks,
      blockIds: [],
      shifts: [],
      pendingSwaps: 0,
      pendingChangeRequests: 0,
      pendingPrnInterest: 0,
      pendingSwapBlockIds: [],
      pendingChangeBlockIds: [],
      pendingPrnByBlockId: new Map(),
      actualRows: [],
    }
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
  const { count: pendingSwapsCount } = await (supabase as any)
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
  const { count: pendingChangeCount } = await (supabase as any)
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
  let actualRows: Array<{ schedule_block_id: string; shift_date: string; total_actual: number }> = []
  if (activeCompletedBlockIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualQuery = (supabase as any)
      .from('shift_actual_headcount')
      .select('*')
      .in('schedule_block_id', activeCompletedBlockIds)
    if (from) actualQuery.gte('shift_date', from)
    if (to) actualQuery.lte('shift_date', to)
    const { data } = await actualQuery as { data: ActualHeadcountRow[] | null; error: unknown }
    actualRows = (data ?? []).map((r) => ({
      schedule_block_id: r.schedule_block_id,
      shift_date: r.shift_date,
      total_actual: r.total_actual,
    }))
  }

  return {
    filteredBlocks,
    allBlocks,
    blockIds,
    shifts,
    pendingSwaps: pendingSwapsCount ?? 0,
    pendingChangeRequests: pendingChangeCount ?? 0,
    pendingPrnInterest,
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
    actualRows,
  }
}
