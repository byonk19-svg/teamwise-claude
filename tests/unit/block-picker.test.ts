// tests/unit/block-picker.test.ts
import { describe, it, expect } from 'vitest'
import { blockLabel } from '@/components/schedule/BlockPicker'

describe('blockLabel', () => {
  it('formats dates and status', () => {
    expect(blockLabel('2026-03-01', '2026-04-11', 'preliminary_draft'))
      .toBe('Mar 1 – Apr 11 (preliminary draft)')
  })

  it('handles final status', () => {
    expect(blockLabel('2026-01-04', '2026-02-14', 'final'))
      .toBe('Jan 4 – Feb 14 (final)')
  })
})
