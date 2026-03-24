import { describe, it, expect } from 'vitest'
import { buildOpsKpis, getLeadGapCount, getLowCoverageCount } from '@/lib/ops/kpis'

describe('ops kpis', () => {
  it('computes lead gap dates by block+date', () => {
    const count = getLeadGapCount([
      { schedule_block_id: 'b1', shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { schedule_block_id: 'b1', shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { schedule_block_id: 'b1', shift_date: '2026-04-02', cell_state: 'working', lead_user_id: 'u1' },
      { schedule_block_id: 'b2', shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
    ])
    expect(count).toBe(2)
  })

  it('computes low coverage dates when total_actual < 3', () => {
    const count = getLowCoverageCount([
      { schedule_block_id: 'b1', shift_date: '2026-04-01', total_actual: 2 },
      { schedule_block_id: 'b1', shift_date: '2026-04-02', total_actual: 3 },
      { schedule_block_id: 'b1', shift_date: '2026-04-03', total_actual: 1 },
    ])
    expect(count).toBe(2)
  })

  it('builds full KPI object', () => {
    const kpis = buildOpsKpis({
      shifts: [
        { schedule_block_id: 'b1', shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      ],
      pendingSwaps: 4,
      pendingChangeRequests: 2,
      pendingPrnInterest: 3,
      actualRows: [{ schedule_block_id: 'b1', shift_date: '2026-04-01', total_actual: 2 }],
    })

    expect(kpis).toEqual({
      leadGapDates: 1,
      pendingSwaps: 4,
      pendingChangeRequests: 2,
      pendingPrnInterest: 3,
      lowCoverageDates: 1,
    })
  })
})
