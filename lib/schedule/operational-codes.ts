/**
 * Whether a user can enter an operational code for a specific shift date.
 *
 * Therapists are expected to already be validated as lead/charge elsewhere.
 */
export function isOperationalEntryAllowed(
  blockStatus: string,
  _userRole: 'manager' | 'therapist',
  shiftDate: string,
  blockStart: string,
  today: string
): boolean {
  if (blockStatus !== 'active') return false
  if (shiftDate > today) return false
  if (shiftDate < blockStart) return false
  return true
}

/** Whether an entry is backfilled for a prior date. */
export function isBackfill(entryDate: string, today: string): boolean {
  return entryDate < today
}
