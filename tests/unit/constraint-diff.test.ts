// tests/unit/constraint-diff.test.ts
import { describe, it, expect } from 'vitest'
import { groupDiffByUser, type DiffItem } from '@/components/schedule/ConstraintDiff'

describe('groupDiffByUser', () => {
  it('groups multiple dates under one user', () => {
    const items: DiffItem[] = [
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-02', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-03', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u2', full_name: 'Bob',   shift_date: '2026-03-04', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
    ]
    const grouped = groupDiffByUser(items)
    expect(grouped['u1'].dates).toHaveLength(2)
    expect(grouped['u2'].dates).toHaveLength(1)
    expect(grouped['u1'].name).toBe('Alice')
  })

  it('returns empty object for empty input', () => {
    expect(groupDiffByUser([])).toEqual({})
  })
})
