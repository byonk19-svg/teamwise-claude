import { describe, it, expect } from 'vitest'
import { buildBlockHealthRows } from '@/lib/ops/block-health'

describe('buildBlockHealthRows', () => {
  it('aggregates per-block metrics and risk score', () => {
    const rows = buildBlockHealthRows({
      blocks: [
        {
          id: 'b1',
          start_date: '2026-01-01',
          end_date: '2026-02-10',
          shift_type: 'day',
          status: 'preliminary',
        },
        {
          id: 'b2',
          start_date: '2026-03-01',
          end_date: '2026-04-10',
          shift_type: 'night',
          status: 'active',
        },
      ],
      shifts: [
        { schedule_block_id: 'b1', shift_date: '2026-01-05', cell_state: 'working', lead_user_id: null },
        { schedule_block_id: 'b1', shift_date: '2026-01-05', cell_state: 'working', lead_user_id: null },
        { schedule_block_id: 'b2', shift_date: '2026-03-02', cell_state: 'working', lead_user_id: 'u1' },
      ],
      actualRows: [
        { schedule_block_id: 'b2', shift_date: '2026-03-02', total_actual: 2 },
        { schedule_block_id: 'b2', shift_date: '2026-03-03', total_actual: 4 },
      ],
      pendingSwapBlockIds: ['b1', 'b1'],
      pendingChangeBlockIds: ['b1'],
      pendingPrnByBlockId: new Map([['b2', 2]]),
    })

    expect(rows).toHaveLength(2)
    const b1 = rows.find((r) => r.blockId === 'b1')
    const b2 = rows.find((r) => r.blockId === 'b2')
    expect(b1?.leadGapDates).toBe(1)
    expect(b1?.pendingSwaps).toBe(2)
    expect(b1?.pendingChangeRequests).toBe(1)
    expect(b1?.pendingPrnInterest).toBe(0)
    expect(b1?.lowCoverageDates).toBe(0)
    expect(b1?.riskScore).toBe(1 + 2 + 1 + 0 + 0)

    expect(b2?.leadGapDates).toBe(0)
    expect(b2?.lowCoverageDates).toBe(1)
    expect(b2?.pendingPrnInterest).toBe(2)
    expect(b2?.riskScore).toBe(0 + 0 + 0 + 2 + 1)
  })
})
