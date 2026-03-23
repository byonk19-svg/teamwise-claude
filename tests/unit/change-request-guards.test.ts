// tests/unit/change-request-guards.test.ts
import { describe, it, expect } from 'vitest'
import { isChangeRequestAllowed, isPrnInterestAllowed } from '@/lib/schedule/change-requests'

describe('isChangeRequestAllowed', () => {
  it('allows FT therapist on preliminary block', () => {
    expect(isChangeRequestAllowed('preliminary', 'therapist', 'full_time')).toBe(true)
  })
  it('rejects PRN therapist (FT-only feature)', () => {
    expect(isChangeRequestAllowed('preliminary', 'therapist', 'prn')).toBe(false)
  })
  it('rejects manager', () => {
    expect(isChangeRequestAllowed('preliminary', 'manager', 'full_time')).toBe(false)
  })
  it('rejects non-preliminary blocks', () => {
    expect(isChangeRequestAllowed('preliminary_draft', 'therapist', 'full_time')).toBe(false)
    expect(isChangeRequestAllowed('final', 'therapist', 'full_time')).toBe(false)
    expect(isChangeRequestAllowed('active', 'therapist', 'full_time')).toBe(false)
  })
})

describe('isPrnInterestAllowed', () => {
  it('allows PRN therapist on preliminary block', () => {
    expect(isPrnInterestAllowed('preliminary', 'therapist', 'prn')).toBe(true)
  })
  it('rejects FT therapist', () => {
    expect(isPrnInterestAllowed('preliminary', 'therapist', 'full_time')).toBe(false)
  })
  it('rejects manager', () => {
    expect(isPrnInterestAllowed('preliminary', 'manager', 'prn')).toBe(false)
  })
  it('rejects non-preliminary blocks', () => {
    expect(isPrnInterestAllowed('preliminary_draft', 'therapist', 'prn')).toBe(false)
    expect(isPrnInterestAllowed('final', 'therapist', 'prn')).toBe(false)
  })
})
