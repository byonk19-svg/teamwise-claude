// lib/schedule/optimistic.ts
export type CellState = 'working' | 'cannot_work' | 'off' | 'fmla'

export function applyOptimisticUpdate<T extends { id: string; cell_state: CellState }>(
  shifts: T[],
  shiftId: string,
  newState: CellState
): T[] {
  return shifts.map(s => s.id === shiftId ? { ...s, cell_state: newState } : s)
}
