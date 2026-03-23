// tests/unit/block-create.test.ts
import { describe, it, expect } from 'vitest'
import { computeEndDate, isStartDateSunday } from '@/components/schedule/BlockCreateForm'

describe('block date utilities', () => {
  it('computes end date as start + 41 days', () => {
    expect(computeEndDate('2026-03-01')).toBe('2026-04-11')
  })

  it('2026-03-01 is a Sunday', () => {
    expect(isStartDateSunday('2026-03-01')).toBe(true)
  })

  it('2026-03-02 is not a Sunday', () => {
    expect(isStartDateSunday('2026-03-02')).toBe(false)
  })
})
