import { describe, it, expect } from 'vitest'
import { pivotEquityRows, type TherapistBlockRow } from '@/lib/fairness/fetch-therapist-equity'

const rows: TherapistBlockRow[] = [
  {
    userId: 'u1',
    fullName: 'Alice',
    employmentType: 'full_time',
    blockId: 'b1',
    blockLabel: 'Day — Jan 1 – Feb 11',
    shiftType: 'day',
    workingCount: 8,
  },
  {
    userId: 'u1',
    fullName: 'Alice',
    employmentType: 'full_time',
    blockId: 'b2',
    blockLabel: 'Night — Feb 12 – Mar 25',
    shiftType: 'night',
    workingCount: 6,
  },
  {
    userId: 'u2',
    fullName: 'Bob',
    employmentType: 'full_time',
    blockId: 'b1',
    blockLabel: 'Day — Jan 1 – Feb 11',
    shiftType: 'day',
    workingCount: 10,
  },
  {
    userId: 'u3',
    fullName: 'Carmen',
    employmentType: 'prn',
    blockId: 'b1',
    blockLabel: 'Day — Jan 1 – Feb 11',
    shiftType: 'day',
    workingCount: 3,
  },
]

describe('pivotEquityRows', () => {
  it('returns ordered block labels', () => {
    const result = pivotEquityRows(rows)
    expect(result.blockLabels).toEqual(['Day — Jan 1 – Feb 11', 'Night — Feb 12 – Mar 25'])
  })

  it('separates FT and PRN therapists', () => {
    const result = pivotEquityRows(rows)
    expect(result.ft.map((t) => t.fullName)).toContain('Alice')
    expect(result.ft.map((t) => t.fullName)).toContain('Bob')
    expect(result.prn.map((t) => t.fullName)).toContain('Carmen')
    expect(result.ft.map((t) => t.fullName)).not.toContain('Carmen')
  })

  it('correctly sets day/night counts per block cell', () => {
    const result = pivotEquityRows(rows)
    const alice = result.ft.find((t) => t.fullName === 'Alice')!
    expect(alice.cells['b1']).toEqual({ dayCount: 8, nightCount: 0 })
    expect(alice.cells['b2']).toEqual({ dayCount: 0, nightCount: 6 })
  })

  it('returns zero counts for blocks where therapist has no shifts', () => {
    const result = pivotEquityRows(rows)
    const bob = result.ft.find((t) => t.fullName === 'Bob')!
    expect(bob.cells['b2']).toEqual({ dayCount: 0, nightCount: 0 })
  })

  it('computes correct totals', () => {
    const result = pivotEquityRows(rows)
    const alice = result.ft.find((t) => t.fullName === 'Alice')!
    expect(alice.totalDay).toBe(8)
    expect(alice.totalNight).toBe(6)
  })

  it('handles empty input', () => {
    const result = pivotEquityRows([])
    expect(result.ft).toEqual([])
    expect(result.prn).toEqual([])
    expect(result.blockLabels).toEqual([])
  })
})
