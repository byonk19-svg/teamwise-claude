import { describe, it, expect } from 'vitest'
import {
  swapRequestedPayload,
  swapResolvedPayload,
  changeRequestResolvedPayload,
  prnInterestResolvedPayload,
  blockPostedPayload,
} from '@/lib/notifications/payloads'

describe('swapRequestedPayload', () => {
  it('builds title, body and href', () => {
    const p = swapRequestedPayload('Jane Smith', '2026-04-01')
    expect(p.title).toBe('New Swap Request')
    expect(p.body).toContain('Jane Smith')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/swaps')
  })
})

describe('swapResolvedPayload', () => {
  it('approved variant', () => {
    const p = swapResolvedPayload('approved', 'Jane Smith', '2026-04-01')
    expect(p.title).toBe('Swap Approved')
    expect(p.body).toContain('Jane Smith')
    expect(p.href).toBe('/swaps')
  })

  it('rejected variant', () => {
    const p = swapResolvedPayload('rejected', 'Jane Smith', '2026-04-01')
    expect(p.title).toBe('Swap Rejected')
  })
})

describe('changeRequestResolvedPayload', () => {
  it('approved variant', () => {
    const p = changeRequestResolvedPayload('approved', '2026-04-01')
    expect(p.title).toBe('Change Request Approved')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/schedule')
  })

  it('rejected variant', () => {
    const p = changeRequestResolvedPayload('rejected', '2026-04-01')
    expect(p.title).toBe('Change Request Rejected')
  })
})

describe('prnInterestResolvedPayload', () => {
  it('confirmed variant', () => {
    const p = prnInterestResolvedPayload('confirmed', '2026-04-01')
    expect(p.title).toBe('Shift Interest Confirmed')
    expect(p.href).toContain('/availability')
  })

  it('declined variant', () => {
    const p = prnInterestResolvedPayload('declined', '2026-04-01')
    expect(p.title).toBe('Shift Interest Declined')
  })
})

describe('blockPostedPayload', () => {
  it('final day shift', () => {
    const p = blockPostedPayload('day', '2026-04-01', '2026-05-12', 'final')
    expect(p.title).toBe('Final Schedule Posted')
    expect(p.body).toContain('Day')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/schedule')
  })

  it('preliminary night shift', () => {
    const p = blockPostedPayload('night', '2026-04-01', '2026-05-12', 'preliminary')
    expect(p.title).toBe('Preliminary Schedule Posted')
    expect(p.body).toContain('Night')
  })
})
