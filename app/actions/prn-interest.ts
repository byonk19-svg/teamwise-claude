// app/actions/prn-interest.ts
'use server'
import { runAfterResponse } from '@/lib/server/deferred-work'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/create'
import { sendPush } from '@/lib/notifications/push'
import { prnInterestResolvedPayload } from '@/lib/notifications/payloads'
import { isPrnInterestAllowed } from '@/lib/schedule/change-requests'
import { logActionFailure, logActionStart, logActionSuccess } from '@/lib/observability/action-log'

/**
 * PRN therapist signals interest in an open shift.
 * outsideAvailability = true when the date was not in their submitted availability.
 */
export async function submitPrnInterest(
  shiftId: string,
  blockId: string,
  outsideAvailability: boolean
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('submitPrnInterest', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('submitPrnInterest', user.id, { shiftId, blockId, outsideAvailability })

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }
  if (!profile) {
    logActionFailure('submitPrnInterest', user.id, 'Profile not found', { shiftId, blockId })
    return { error: 'Profile not found' }
  }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) {
    logActionFailure('submitPrnInterest', user.id, 'Block not found', { blockId })
    return { error: 'Block not found' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isPrnInterestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
    logActionFailure('submitPrnInterest', user.id, 'Guard rejected', { shiftId, blockId, status: block.status })
    return { error: 'PRN interest is only allowed for PRN therapists on Preliminary blocks' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('prn_shift_interest')
    .upsert(
      { user_id: user.id, shift_id: shiftId, outside_availability: outsideAvailability, status: 'pending' },
      { onConflict: 'user_id,shift_id' }
    )

  if (error) {
    logActionFailure('submitPrnInterest', user.id, error.message, { shiftId, blockId })
    return { error: error.message }
  }

  revalidatePath('/availability/open-shifts')
  revalidatePath('/schedule/inbox')
  logActionSuccess('submitPrnInterest', user.id, { shiftId, blockId, outsideAvailability })
  return {}
}

/**
 * Manager confirms or declines PRN interest.
 * If confirmed: sets the PRN therapist's shift cell_state to 'working'.
 */
export async function resolvePrnInterest(
  interestId: string,
  decision: 'confirmed' | 'declined'
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('resolvePrnInterest', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('resolvePrnInterest', user.id, { interestId, decision })

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') {
    logActionFailure('resolvePrnInterest', user.id, 'Manager access required', { interestId })
    return { error: 'Manager access required' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: interest } = await (supabase as any)
    .from('prn_shift_interest')
    .select('shift_id, status, user_id')
    .eq('id', interestId)
    .single() as { data: { shift_id: string; status: string; user_id: string } | null; error: unknown }
  if (!interest) {
    logActionFailure('resolvePrnInterest', user.id, 'Interest record not found', { interestId })
    return { error: 'Interest record not found' }
  }
  if (interest.status !== 'pending') {
    logActionFailure('resolvePrnInterest', user.id, 'Already resolved', { interestId, status: interest.status })
    return { error: 'Already resolved' }
  }

  const { data: shift } = await supabase
    .from('shifts')
    .select('schedule_block_id, shift_date')
    .eq('id', interest.shift_id)
    .single() as { data: { schedule_block_id: string; shift_date: string } | null; error: unknown }
  if (!shift) {
    logActionFailure('resolvePrnInterest', user.id, 'Shift not found', { interestId })
    return { error: 'Shift not found' }
  }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', shift.schedule_block_id)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) {
    logActionFailure('resolvePrnInterest', user.id, 'Block not found', { interestId, blockId: shift.schedule_block_id })
    return { error: 'Block not found' }
  }
  if (block.status !== 'preliminary') {
    logActionFailure('resolvePrnInterest', user.id, 'Block status guard rejected', { interestId, status: block.status })
    return { error: 'Cannot resolve PRN interest unless block is still Preliminary' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('prn_shift_interest')
    .update({ status: decision, actioned_at: new Date().toISOString(), actioned_by: user.id })
    .eq('id', interestId)

  if (updateErr) {
    logActionFailure('resolvePrnInterest', user.id, updateErr.message, { interestId, decision })
    return { error: updateErr.message }
  }

  if (decision === 'confirmed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'working' })
      .eq('id', interest.shift_id)
  }

  const prnPayload = prnInterestResolvedPayload(decision, shift.shift_date)
  await createNotification(
    interest.user_id,
    'prn_interest_resolved',
    prnPayload.title,
    prnPayload.body,
    prnPayload.href
  )
  runAfterResponse(() => sendPush(interest.user_id, prnPayload))

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  logActionSuccess('resolvePrnInterest', user.id, { interestId, decision })
  return {}
}
