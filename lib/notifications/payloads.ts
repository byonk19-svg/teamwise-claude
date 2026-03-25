// lib/notifications/payloads.ts

export interface NotificationPayload {
  title: string
  body: string
  href: string
}

export function swapRequestedPayload(partnerName: string, shiftDate: string): NotificationPayload {
  return {
    title: 'New Swap Request',
    body: `${partnerName} has requested a shift swap with you on ${shiftDate}`,
    href: '/swaps',
  }
}

export function swapResolvedPayload(
  decision: 'approved' | 'rejected',
  partnerName: string,
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'approved' ? 'Swap Approved' : 'Swap Rejected',
    body: `Your swap with ${partnerName} on ${shiftDate} was ${decision}`,
    href: '/swaps',
  }
}

export function changeRequestResolvedPayload(
  decision: 'approved' | 'rejected',
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'approved' ? 'Change Request Approved' : 'Change Request Rejected',
    body: `Your change request for ${shiftDate} was ${decision}`,
    href: '/schedule',
  }
}

export function prnInterestResolvedPayload(
  decision: 'confirmed' | 'declined',
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'confirmed' ? 'Shift Interest Confirmed' : 'Shift Interest Declined',
    body: `Your interest in the shift on ${shiftDate} was ${decision}`,
    href: '/availability/open-shifts',
  }
}

export function blockPostedPayload(
  shiftType: 'day' | 'night',
  startDate: string,
  endDate: string,
  status: 'final' | 'preliminary'
): NotificationPayload {
  const statusLabel = status === 'final' ? 'Final' : 'Preliminary'
  const typeLabel = shiftType === 'day' ? 'Day' : 'Night'
  return {
    title: `${statusLabel} Schedule Posted`,
    body: `${typeLabel} shift schedule for ${startDate}–${endDate} is now available`,
    href: '/schedule',
  }
}
