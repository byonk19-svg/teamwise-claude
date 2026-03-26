import { describe, it, expect } from 'vitest'
import { validateCoverageThresholds } from '@/lib/settings/validate'

describe('validateCoverageThresholds', () => {
  it('returns null for a valid range', () => {
    expect(validateCoverageThresholds(2, 4, 5)).toBeNull()
  })

  it('returns null for equal boundary values (enforces <= not <)', () => {
    expect(validateCoverageThresholds(4, 4, 4)).toBeNull()
  })

  it('returns error string when min > ideal', () => {
    expect(validateCoverageThresholds(5, 3, 6)).toBe('Minimum staff cannot exceed ideal staff')
  })

  it('returns error string when ideal > max', () => {
    expect(validateCoverageThresholds(2, 6, 4)).toBe('Ideal staff cannot exceed maximum staff')
  })
})
