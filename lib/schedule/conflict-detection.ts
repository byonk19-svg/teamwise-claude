export type ConflictType = 'cannot_work' | 'wrong_shift_type' | null

/**
 * Detects if a scheduled cell conflicts with a therapist's availability entry.
 * Only flags conflicts when the cell is 'working'.
 */
export function detectConflict(
  cellState: string,
  availEntryType: string | undefined,
  blockShiftType: 'day' | 'night'
): ConflictType {
  if (cellState !== 'working') return null
  if (!availEntryType) return null

  if (availEntryType === 'cannot_work') return 'cannot_work'

  if (blockShiftType === 'day' && availEntryType === 'available_night') return 'wrong_shift_type'
  if (blockShiftType === 'night' && availEntryType === 'available_day') return 'wrong_shift_type'

  return null
}
