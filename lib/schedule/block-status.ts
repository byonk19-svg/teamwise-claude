// lib/schedule/block-status.ts
import type { Database } from '@/lib/types/database.types'

type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

/**
 * Classify a block into Past / Current / Upcoming relative to todayStr ('YYYY-MM-DD').
 * Used by BlockPicker to render optgroup labels.
 */
export function classifyBlock(
  endDate: string,
  startDate: string,
  todayStr: string
): 'past' | 'current' | 'upcoming' {
  if (endDate < todayStr) return 'past'
  if (startDate > todayStr) return 'upcoming'
  return 'current'
}

/** Manager can directly edit cells only in preliminary_draft or preliminary blocks. */
export function canEditCell(status: BlockStatus, role: 'manager' | 'therapist'): boolean {
  if (role !== 'manager') return false
  return status === 'preliminary_draft' || status === 'preliminary'
}

/** Block is read-only for all users — no posting, editing, or change requests. */
export function isBlockReadOnly(status: BlockStatus): boolean {
  return status === 'final' || status === 'active' || status === 'completed'
}

/** Manager can post this block as Preliminary. */
export function canPostPreliminary(status: BlockStatus): boolean {
  return status === 'preliminary_draft'
}

/** Manager can publish this block as Final. */
export function canPublishFinal(status: BlockStatus): boolean {
  return status === 'preliminary'
}
