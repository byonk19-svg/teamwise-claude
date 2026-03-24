// tests/unit/lead-assignment.test.ts
import { describe, it, expect } from 'vitest'
import { isLeadEligible, getLeadGapDates } from '@/lib/schedule/lead-assignment'

describe('isLeadEligible', () => {
  it('returns true when qualified and working', () => {
    expect(isLeadEligible('u1', true, ['u1', 'u2'])).toBe(true)
  })
  it('returns false when not qualified', () => {
    expect(isLeadEligible('u1', false, ['u1', 'u2'])).toBe(false)
  })
  it('returns false when not working on that date', () => {
    expect(isLeadEligible('u1', true, ['u2', 'u3'])).toBe(false)
  })
})

describe('getLeadGapDates', () => {
  it('returns dates with working shifts but no lead', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { shift_date: '2026-04-02', cell_state: 'working', lead_user_id: 'u1' },
      { shift_date: '2026-04-03', cell_state: 'off',     lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual(['2026-04-01'])
  })
  it('returns empty when all working dates have a lead', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: 'u1' },
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual([])
  })
  it('ignores dates where no one is working', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'off', lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual([])
  })
})
