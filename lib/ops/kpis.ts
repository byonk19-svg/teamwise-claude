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

export interface OpsKpis {
  leadGapDates: number
  pendingSwaps: number
  pendingChangeRequests: number
  pendingPrnInterest: number
  lowCoverageDates: number
}

export function getLeadGapCount(shifts: ShiftLite[]): number {
  const working = new Set<string>()
  const hasLead = new Set<string>()

  for (const s of shifts) {
    const key = `${s.schedule_block_id}:${s.shift_date}`
    if (s.cell_state === 'working') working.add(key)
    if (s.lead_user_id !== null) hasLead.add(key)
  }

  let gaps = 0
  for (const key of Array.from(working)) {
    if (!hasLead.has(key)) gaps += 1
  }
  return gaps
}

export function getLowCoverageCount(actualRows: ActualLite[]): number {
  const low = new Set<string>()
  for (const row of actualRows) {
    if (row.total_actual < 3) {
      low.add(`${row.schedule_block_id}:${row.shift_date}`)
    }
  }
  return low.size
}

export function buildOpsKpis(input: {
  shifts: ShiftLite[]
  pendingSwaps: number
  pendingChangeRequests: number
  pendingPrnInterest: number
  actualRows: ActualLite[]
}): OpsKpis {
  return {
    leadGapDates: getLeadGapCount(input.shifts),
    pendingSwaps: input.pendingSwaps,
    pendingChangeRequests: input.pendingChangeRequests,
    pendingPrnInterest: input.pendingPrnInterest,
    lowCoverageDates: getLowCoverageCount(input.actualRows),
  }
}
