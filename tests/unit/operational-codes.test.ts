import { describe, it, expect } from 'vitest'
import { isOperationalEntryAllowed, isBackfill } from '@/lib/schedule/operational-codes'

describe('isOperationalEntryAllowed', () => {
  const TODAY = '2026-04-15'

  it('allows manager on active block for today', () => {
    expect(isOperationalEntryAllowed('active', 'manager', '2026-04-15', '2026-04-01', TODAY)).toBe(true)
  })

  it('allows manager on active block for a prior date (backfill)', () => {
    expect(isOperationalEntryAllowed('active', 'manager', '2026-04-10', '2026-04-01', TODAY)).toBe(true)
  })

  it('denies manager on non-active block', () => {
    expect(isOperationalEntryAllowed('final', 'manager', '2026-04-15', '2026-04-01', TODAY)).toBe(false)
  })

  it('allows therapist-lead on active block for today', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-15', '2026-04-01', TODAY)).toBe(true)
  })

  it('allows therapist-lead on active block for a prior date', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-05', '2026-04-01', TODAY)).toBe(true)
  })

  it('denies therapist-lead for a future date', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-20', '2026-04-01', TODAY)).toBe(false)
  })

  it('denies therapist-lead for a date before block start', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-03-15', '2026-04-01', TODAY)).toBe(false)
  })

  it('denies therapist-lead on completed block', () => {
    expect(isOperationalEntryAllowed('completed', 'therapist', '2026-04-15', '2026-04-01', TODAY)).toBe(false)
  })
})

describe('isBackfill', () => {
  it('returns false when entry date matches today', () => {
    expect(isBackfill('2026-04-15', '2026-04-15')).toBe(false)
  })

  it('returns true when entry date is before today', () => {
    expect(isBackfill('2026-04-10', '2026-04-15')).toBe(true)
  })
})
