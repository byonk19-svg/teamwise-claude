// tests/unit/availability-window.test.ts
import { describe, it, expect } from 'vitest'
import { isWindowOpen } from '@/components/schedule/AvailabilityWindowControl'

describe('isWindowOpen', () => {
  it('returns false when no window set', () => {
    expect(isWindowOpen(null, null)).toBe(false)
  })

  it('returns true when current time is within window', () => {
    const open = new Date(Date.now() - 1000).toISOString()
    const close = new Date(Date.now() + 60000).toISOString()
    expect(isWindowOpen(open, close)).toBe(true)
  })

  it('returns false when window has closed', () => {
    const open = new Date(Date.now() - 60000).toISOString()
    const close = new Date(Date.now() - 1000).toISOString()
    expect(isWindowOpen(open, close)).toBe(false)
  })
})
