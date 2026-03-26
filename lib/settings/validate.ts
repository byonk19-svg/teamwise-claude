/**
 * Validates coverage threshold values.
 * Returns null if valid (min ≤ ideal ≤ max), or an error string.
 */
export function validateCoverageThresholds(
  min: number,
  ideal: number,
  max: number
): string | null {
  if (min > ideal) return 'Minimum staff cannot exceed ideal staff'
  if (ideal > max) return 'Ideal staff cannot exceed maximum staff'
  return null
}
