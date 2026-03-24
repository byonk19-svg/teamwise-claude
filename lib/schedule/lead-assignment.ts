// lib/schedule/lead-assignment.ts

/**
 * Whether a therapist is eligible to be assigned as lead on a given date.
 * @param userId - the candidate's user id
 * @param isLeadQualified - from users.is_lead_qualified
 * @param workingUserIds - user_ids with cell_state='working' on this date in this block
 */
export function isLeadEligible(
  userId: string,
  isLeadQualified: boolean,
  workingUserIds: string[]
): boolean {
  return isLeadQualified && workingUserIds.includes(userId)
}

type ShiftSummary = {
  shift_date: string
  cell_state: string
  lead_user_id: string | null
}

/**
 * Returns the sorted list of dates that have at least one Working shift
 * but no lead assignment (lead_user_id IS NULL on all shifts for that date).
 */
export function getLeadGapDates(shifts: ShiftSummary[]): string[] {
  const dateMap = new Map<string, { hasWorking: boolean; hasLead: boolean }>()

  for (const s of shifts) {
    const entry = dateMap.get(s.shift_date) ?? { hasWorking: false, hasLead: false }
    if (s.cell_state === 'working') entry.hasWorking = true
    if (s.lead_user_id !== null) entry.hasLead = true
    dateMap.set(s.shift_date, entry)
  }

  return Array.from(dateMap.entries())
    .filter(([, v]) => v.hasWorking && !v.hasLead)
    .map(([date]) => date)
    .sort()
}
