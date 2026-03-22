// tests/unit/cell-state.test.ts
import { describe, it, expect } from 'vitest'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'

describe('cellStateClass', () => {
  it('working → bg-[var(--shift-color)]', () => {
    expect(cellStateClass('working')).toContain('bg-[var(--shift-color)]')
  })
  it('cannot_work → asterisk/gray', () => {
    expect(cellStateClass('cannot_work')).toContain('bg-slate-100')
  })
  it('off → empty/transparent', () => {
    expect(cellStateClass('off')).toContain('bg-transparent')
  })
  it('fmla → distinct background', () => {
    expect(cellStateClass('fmla')).toContain('bg-amber-50')
  })
})

describe('cellStateLabel', () => {
  it('cannot_work → *', () => {
    expect(cellStateLabel('cannot_work')).toBe('*')
  })
  it('working → 1', () => {
    expect(cellStateLabel('working')).toBe('1')
  })
  it('fmla → FMLA', () => {
    expect(cellStateLabel('fmla')).toBe('FMLA')
  })
  it('off → empty string', () => {
    expect(cellStateLabel('off')).toBe('')
  })
})
