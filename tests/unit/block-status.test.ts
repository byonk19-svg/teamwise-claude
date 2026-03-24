// tests/unit/block-status.test.ts
import { describe, it, expect } from 'vitest'
import {
  classifyBlock,
  canEditCell,
  isBlockReadOnly,
  canPostPreliminary,
  canPublishFinal,
  canActivateBlock,
  canRevertToFinal,
} from '@/lib/schedule/block-status'

describe('classifyBlock', () => {
  const today = '2026-03-23'
  it('returns past when end_date is before today', () => {
    expect(classifyBlock('2026-01-01', '2025-11-21', today)).toBe('past')
  })
  it('returns upcoming when start_date is after today', () => {
    expect(classifyBlock('2026-05-31', '2026-04-20', today)).toBe('upcoming')
  })
  it('returns current when today falls within the block', () => {
    expect(classifyBlock('2026-04-30', '2026-03-10', today)).toBe('current')
  })
  it('returns past when end_date is the day before today', () => {
    expect(classifyBlock('2026-03-22', '2026-02-10', today)).toBe('past')
  })
})

describe('canEditCell', () => {
  it('allows manager in preliminary_draft', () => {
    expect(canEditCell('preliminary_draft', 'manager')).toBe(true)
  })
  it('allows manager in preliminary', () => {
    expect(canEditCell('preliminary', 'manager')).toBe(true)
  })
  it('blocks manager in final', () => {
    expect(canEditCell('final', 'manager')).toBe(false)
  })
  it('blocks manager in active', () => {
    expect(canEditCell('active', 'manager')).toBe(false)
  })
  it('blocks therapist regardless of status', () => {
    expect(canEditCell('preliminary_draft', 'therapist')).toBe(false)
    expect(canEditCell('preliminary', 'therapist')).toBe(false)
  })
})

describe('isBlockReadOnly', () => {
  it('final is read-only', () => { expect(isBlockReadOnly('final')).toBe(true) })
  it('active is read-only', () => { expect(isBlockReadOnly('active')).toBe(true) })
  it('completed is read-only', () => { expect(isBlockReadOnly('completed')).toBe(true) })
  it('preliminary_draft is not read-only', () => { expect(isBlockReadOnly('preliminary_draft')).toBe(false) })
  it('preliminary is not read-only', () => { expect(isBlockReadOnly('preliminary')).toBe(false) })
})

describe('canPostPreliminary', () => {
  it('allows preliminary_draft only', () => {
    expect(canPostPreliminary('preliminary_draft')).toBe(true)
    expect(canPostPreliminary('preliminary')).toBe(false)
    expect(canPostPreliminary('final')).toBe(false)
    expect(canPostPreliminary('active')).toBe(false)
  })
})

describe('canPublishFinal', () => {
  it('allows preliminary only', () => {
    expect(canPublishFinal('preliminary')).toBe(true)
    expect(canPublishFinal('preliminary_draft')).toBe(false)
    expect(canPublishFinal('final')).toBe(false)
  })
})

describe('canActivateBlock', () => {
  it('returns true for final status', () => {
    expect(canActivateBlock('final')).toBe(true)
  })

  it('returns false for active status', () => {
    expect(canActivateBlock('active')).toBe(false)
  })

  it('returns false for preliminary_draft', () => {
    expect(canActivateBlock('preliminary_draft')).toBe(false)
  })
})

describe('canRevertToFinal', () => {
  it('returns true for active status', () => {
    expect(canRevertToFinal('active')).toBe(true)
  })

  it('returns false for final status', () => {
    expect(canRevertToFinal('final')).toBe(false)
  })

  it('returns false for completed status', () => {
    expect(canRevertToFinal('completed')).toBe(false)
  })
})
