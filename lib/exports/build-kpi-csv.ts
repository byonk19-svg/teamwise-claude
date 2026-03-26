import type { BlockHealthRow } from '@/lib/ops/block-health'

export function buildKPICSV(rows: BlockHealthRow[]): string {
  const header =
    'block_id,shift_type,start_date,end_date,status,lead_gap_dates,pending_swaps,pending_change_requests,pending_prn_interest,low_coverage_dates,risk_score'
  const lines = rows.map((r) =>
    [
      r.blockId,
      r.shiftType,
      r.startDate,
      r.endDate,
      r.status,
      r.leadGapDates,
      r.pendingSwaps,
      r.pendingChangeRequests,
      r.pendingPrnInterest,
      r.lowCoverageDates,
      r.riskScore,
    ].join(',')
  )
  return [header, ...lines].join('\n')
}
