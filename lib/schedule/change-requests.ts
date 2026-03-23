// lib/schedule/change-requests.ts
import type { Database } from '@/lib/types/database.types'

type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

/** FT therapist can submit a change request only on Preliminary blocks. */
export function isChangeRequestAllowed(
  status: BlockStatus,
  role: 'manager' | 'therapist',
  employmentType: 'full_time' | 'prn'
): boolean {
  return status === 'preliminary' && role === 'therapist' && employmentType === 'full_time'
}

/** PRN therapist can signal shift interest only on Preliminary blocks. */
export function isPrnInterestAllowed(
  status: BlockStatus,
  role: 'manager' | 'therapist',
  employmentType: 'full_time' | 'prn'
): boolean {
  return status === 'preliminary' && role === 'therapist' && employmentType === 'prn'
}
