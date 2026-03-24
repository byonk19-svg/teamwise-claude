// tests/unit/swap-requests.test.ts
import { describe, it, expect } from 'vitest'
import { isSwapAllowed, swapExpiryDate } from '@/lib/schedule/swap-requests'

describe('isSwapAllowed', () => {
  it('allows swaps on preliminary blocks', () => {
    expect(isSwapAllowed('preliminary')).toBe(true)
  })
  it('allows swaps on final blocks', () => {
    expect(isSwapAllowed('final')).toBe(true)
  })
  it('allows swaps on active blocks', () => {
    expect(isSwapAllowed('active')).toBe(true)
  })
  it('disallows swaps on preliminary_draft blocks', () => {
    expect(isSwapAllowed('preliminary_draft')).toBe(false)
  })
  it('disallows swaps on completed blocks', () => {
    expect(isSwapAllowed('completed')).toBe(false)
  })
})

describe('swapExpiryDate', () => {
  it('returns a date 48 hours in the future', () => {
    const base = new Date('2026-04-01T10:00:00Z')
    const expiry = swapExpiryDate(base)
    expect(expiry.toISOString()).toBe('2026-04-03T10:00:00.000Z')
  })
})
