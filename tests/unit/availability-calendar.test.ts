// tests/unit/availability-calendar.test.ts
import { describe, it, expect } from 'vitest'
import { getEntryOptions } from '@/components/availability/AvailabilityCalendar'

describe('getEntryOptions', () => {
  it('FT gets cannot_work and requesting_to_work', () => {
    const opts = getEntryOptions('full_time')
    expect(opts.map(o => o.value)).toEqual(['cannot_work', 'requesting_to_work'])
  })

  it('PRN gets day/night/either', () => {
    const opts = getEntryOptions('prn')
    expect(opts.map(o => o.value)).toEqual(['available_day', 'available_night', 'available_either'])
  })
})
