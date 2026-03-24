import { getLeadGapCount } from '@/lib/ops/kpis'

type ShiftLite = {
  schedule_block_id: string
  shift_date: string
  cell_state: string
  lead_user_id: string | null
}

type ActualLite = {
  schedule_block_id: string
  shift_date: string
  total_actual: number
}

export interface BlockHealthRow {
  blockId: string
  shiftType: string
  startDate: string
  endDate: string
  status: string
  leadGapDates: number
  pendingSwaps: number
  pendingChangeRequests: number
  pendingPrnInterest: number
  lowCoverageDates: number
  /** Sum of the six metrics; higher means more attention needed */
  riskScore: number
}

function countIds(ids: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of ids) {
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
}

function lowCoverageDateCountForBlock(actualRows: ActualLite[], blockId: string): number {
  const dates = new Set<string>()
  for (const row of actualRows) {
    if (row.schedule_block_id !== blockId) continue
    if (row.total_actual < 3) dates.add(row.shift_date)
  }
  return dates.size
}

export function buildBlockHealthRows(input: {
  blocks: Array<{
    id: string
    start_date: string
    end_date: string
    shift_type: string
    status: string
  }>
  shifts: ShiftLite[]
  actualRows: ActualLite[]
  pendingSwapBlockIds: string[]
  pendingChangeBlockIds: string[]
  pendingPrnByBlockId: Map<string, number>
}): BlockHealthRow[] {
  const swapByBlock = countIds(input.pendingSwapBlockIds)
  const changeByBlock = countIds(input.pendingChangeBlockIds)

  return input.blocks.map((b) => {
    const blockShifts = input.shifts.filter((s) => s.schedule_block_id === b.id)
    const leadGapDates = getLeadGapCount(blockShifts)
    const lowCoverageDates = lowCoverageDateCountForBlock(input.actualRows, b.id)
    const pendingSwaps = swapByBlock.get(b.id) ?? 0
    const pendingChangeRequests = changeByBlock.get(b.id) ?? 0
    const pendingPrnInterest = input.pendingPrnByBlockId.get(b.id) ?? 0
    const riskScore =
      leadGapDates +
      pendingSwaps +
      pendingChangeRequests +
      pendingPrnInterest +
      lowCoverageDates

    return {
      blockId: b.id,
      shiftType: b.shift_type,
      startDate: b.start_date,
      endDate: b.end_date,
      status: b.status,
      leadGapDates,
      pendingSwaps,
      pendingChangeRequests,
      pendingPrnInterest,
      lowCoverageDates,
      riskScore,
    }
  })
}
