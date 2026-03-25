import { describe, it, expect } from 'vitest'
import { buildWeekWindow, resolveLeadName, computeUnsignaledCount } from '@/lib/today/helpers'

describe('buildWeekWindow', () => {
  it('returns up to 7 days starting from today when today is within the block', () => {
    const shifts = [
      { shift_date: '2026-03-24', cell_state: 'working' },
      { shift_date: '2026-03-25', cell_state: 'off' },
      { shift_date: '2026-03-26', cell_state: 'working' },
      { shift_date: '2026-03-27', cell_state: 'off' },
      { shift_date: '2026-03-28', cell_state: 'working' },
      { shift_date: '2026-03-29', cell_state: 'off' },
      { shift_date: '2026-03-30', cell_state: 'working' },
      { shift_date: '2026-03-31', cell_state: 'off' },
    ]
    const result = buildWeekWindow(shifts, '2026-03-01', '2026-04-11', '2026-03-24')
    expect(result).toHaveLength(7)
    expect(result[0].shift_date).toBe('2026-03-24')
    expect(result[6].shift_date).toBe('2026-03-30')
  })

  it('returns fewer than 7 days when block ends before 7 days out', () => {
    const shifts = [
      { shift_date: '2026-04-09', cell_state: 'working' },
      { shift_date: '2026-04-10', cell_state: 'off' },
      { shift_date: '2026-04-11', cell_state: 'working' },
    ]
    const result = buildWeekWindow(shifts, '2026-03-01', '2026-04-11', '2026-04-09')
    expect(result).toHaveLength(3)
    expect(result[2].shift_date).toBe('2026-04-11')
  })

  it('starts from blockStart when today is before the block', () => {
    const shifts = [
      { shift_date: '2026-05-01', cell_state: 'working' },
      { shift_date: '2026-05-02', cell_state: 'off' },
    ]
    const result = buildWeekWindow(shifts, '2026-05-01', '2026-05-30', '2026-03-24')
    expect(result[0].shift_date).toBe('2026-05-01')
  })

  it('returns null cell_state for dates with no matching shift row', () => {
    const result = buildWeekWindow([], '2026-03-01', '2026-04-11', '2026-03-24')
    expect(result).toHaveLength(7)
    expect(result[0].cell_state).toBeNull()
    expect(result[0].shift_date).toBe('2026-03-24')
  })
})

describe('resolveLeadName', () => {
  const therapists = [
    { id: 'u1', full_name: 'Jane Smith' },
    { id: 'u2', full_name: 'Bob Lee' },
  ]

  it('returns the therapist full_name for a matching id', () => {
    expect(resolveLeadName('u1', therapists)).toBe('Jane Smith')
  })

  it('returns null when lead_user_id is null', () => {
    expect(resolveLeadName(null, therapists)).toBeNull()
  })

  it('returns null when id not found', () => {
    expect(resolveLeadName('u99', therapists)).toBeNull()
  })
})

describe('computeUnsignaledCount', () => {
  it('counts off-shifts with no matching interest row', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    const interestRows = [{ shift_id: 's1' }]
    expect(computeUnsignaledCount(offShifts, interestRows)).toBe(2)
  })

  it('returns 0 when all shifts are signaled', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }]
    const interestRows = [{ shift_id: 's1' }, { shift_id: 's2' }]
    expect(computeUnsignaledCount(offShifts, interestRows)).toBe(0)
  })

  it('returns 0 when offShifts is empty', () => {
    expect(computeUnsignaledCount([], [])).toBe(0)
  })

  it('counts all as unsignaled when interestRows is empty', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }]
    expect(computeUnsignaledCount(offShifts, [])).toBe(2)
  })
})
