import { addDays, format, parseISO } from 'date-fns'

/**
 * Returns the window of days to show in the week strip.
 * Starts from max(today, blockStart), walks forward up to 7 days,
 * capped at blockEnd. Returns a placeholder row with cell_state: null
 * for any date that has no shift row.
 */
export function buildWeekWindow(
  shifts: Array<{ shift_date: string; cell_state: string | null }>,
  blockStartDate: string,
  blockEndDate: string,
  todayStr: string
): Array<{ shift_date: string; cell_state: string | null }> {
  const startStr = todayStr > blockStartDate ? todayStr : blockStartDate
  const shiftMap = new Map(shifts.map(s => [s.shift_date, s]))
  const result: Array<{ shift_date: string; cell_state: string | null }> = []

  let current = startStr
  while (current <= blockEndDate && result.length < 7) {
    result.push(shiftMap.get(current) ?? { shift_date: current, cell_state: null })
    current = format(addDays(parseISO(current), 1), 'yyyy-MM-dd')
  }

  return result
}

/**
 * Resolves a lead_user_id to a display name using the therapist list.
 */
export function resolveLeadName(
  leadUserId: string | null,
  therapists: Array<{ id: string; full_name: string | null }>
): string | null {
  if (!leadUserId) return null
  return therapists.find(t => t.id === leadUserId)?.full_name ?? null
}

/**
 * Counts PRN off-shifts that have no existing prn_shift_interest row
 * (any interest status counts as "already signaled").
 */
export function computeUnsignaledCount(
  offShifts: Array<{ id: string }>,
  interestRows: Array<{ shift_id: string }>
): number {
  const signaled = new Set(interestRows.map(r => r.shift_id))
  return offShifts.filter(s => !signaled.has(s.id)).length
}
