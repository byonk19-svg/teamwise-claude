// tests/unit/cell-editing.test.ts
import { describe, it, expect } from 'vitest'
import { applyOptimisticUpdate } from '@/lib/schedule/optimistic'

describe('optimistic cell update', () => {
  it('updates the target shift state', () => {
    const shifts = [
      { id: 'a', cell_state: 'working' as const },
      { id: 'b', cell_state: 'off' as const },
    ]
    const updated = applyOptimisticUpdate(shifts, 'a', 'fmla')
    expect(updated[0].cell_state).toBe('fmla')
    expect(updated[1].cell_state).toBe('off')
  })

  it('returns same state when shift not found', () => {
    const shifts = [{ id: 'a', cell_state: 'working' as const }]
    const updated = applyOptimisticUpdate(shifts, 'z', 'off')
    expect(updated[0].cell_state).toBe('working')
  })
})
