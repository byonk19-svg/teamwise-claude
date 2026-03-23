// tests/unit/phase2-types.test.ts
import { describe, it, expect } from 'vitest'
import type { Database } from '@/lib/types/database.types'

type AvailSub = Database['public']['Tables']['availability_submissions']['Row']
type AvailEntry = Database['public']['Tables']['availability_entries']['Row']

describe('Phase 2 database types', () => {
  it('availability_submissions has required fields', () => {
    const check: keyof AvailSub = 'schedule_block_id'
    expect(check).toBe('schedule_block_id')
  })

  it('availability_entries entry_type covers all 5 values', () => {
    const validTypes: Array<AvailEntry['entry_type']> = [
      'cannot_work',
      'requesting_to_work',
      'available_day',
      'available_night',
      'available_either',
    ]
    expect(validTypes).toHaveLength(5)
  })

  it('schedule_blocks has availability window fields', () => {
    type Block = Database['public']['Tables']['schedule_blocks']['Row']
    const check: keyof Block = 'availability_window_open'
    expect(check).toBe('availability_window_open')
  })
})
