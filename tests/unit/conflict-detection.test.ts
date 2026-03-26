import { describe, it, expect } from 'vitest'
import { detectConflict } from '@/lib/schedule/conflict-detection'

describe('detectConflict', () => {
  describe('cannot_work conflicts', () => {
    it('returns cannot_work when working on a cannot_work day', () => {
      expect(detectConflict('working', 'cannot_work', 'day')).toBe('cannot_work')
    })
    it('returns cannot_work on a night block too', () => {
      expect(detectConflict('working', 'cannot_work', 'night')).toBe('cannot_work')
    })
  })

  describe('wrong_shift_type conflicts', () => {
    it('returns wrong_shift_type when working day block but available_night only', () => {
      expect(detectConflict('working', 'available_night', 'day')).toBe('wrong_shift_type')
    })
    it('returns wrong_shift_type when working night block but available_day only', () => {
      expect(detectConflict('working', 'available_day', 'night')).toBe('wrong_shift_type')
    })
  })

  describe('no conflict', () => {
    it('returns null when no availability entry exists', () => {
      expect(detectConflict('working', undefined, 'day')).toBeNull()
    })
    it('returns null when cell is off (not scheduled)', () => {
      expect(detectConflict('off', 'cannot_work', 'day')).toBeNull()
    })
    it('returns null when working day block and available_day', () => {
      expect(detectConflict('working', 'available_day', 'day')).toBeNull()
    })
    it('returns null when working night block and available_night', () => {
      expect(detectConflict('working', 'available_night', 'night')).toBeNull()
    })
    it('returns null when working and available_either', () => {
      expect(detectConflict('working', 'available_either', 'day')).toBeNull()
    })
    it('returns null when working and requesting_to_work', () => {
      expect(detectConflict('working', 'requesting_to_work', 'day')).toBeNull()
    })
    it('returns null when fmla state (not working)', () => {
      expect(detectConflict('fmla', 'cannot_work', 'day')).toBeNull()
    })
    it('returns null when cannot_work cell state (not a scheduled working cell)', () => {
      expect(detectConflict('cannot_work', 'cannot_work', 'day')).toBeNull()
    })
  })
})
