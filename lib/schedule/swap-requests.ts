// lib/schedule/swap-requests.ts

/** Swaps can be submitted on Preliminary, Final, or Active blocks only. */
export function isSwapAllowed(blockStatus: string): boolean {
  return blockStatus === 'preliminary' || blockStatus === 'final' || blockStatus === 'active'
}

/** Returns a Date 48 hours from `from` (defaults to now). */
export function swapExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + 48 * 60 * 60 * 1000)
}
