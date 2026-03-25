// app/actions/change-requests.ts
'use server'
import { runAfterResponse } from '@/lib/server/deferred-work'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/create'
import { sendPush } from '@/lib/notifications/push'
import { changeRequestResolvedPayload } from '@/lib/notifications/payloads'
import { isChangeRequestAllowed } from '@/lib/schedule/change-requests'
import { logActionFailure, logActionStart, logActionSuccess } from '@/lib/observability/action-log'
import type { Database } from '@/lib/types/database.types'

type RequestType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']

/**
 * FT therapist submits a change request on a Preliminary block.
 * Guards: must be FT therapist, block must be preliminary, no duplicate pending request on same shift.
 */
export async function submitChangeRequest(
  blockId: string,
  shiftId: string,
  requestType: RequestType,
  note: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('submitChangeRequest', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('submitChangeRequest', user.id, { blockId, shiftId, requestType })

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }
  if (!profile) {
    logActionFailure('submitChangeRequest', user.id, 'Profile not found', { blockId })
    return { error: 'Profile not found' }
  }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) {
    logActionFailure('submitChangeRequest', user.id, 'Block not found', { blockId })
    return { error: 'Block not found' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isChangeRequestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
    logActionFailure('submitChangeRequest', user.id, 'Guard rejected', { blockId, shiftId, status: block.status })
    return { error: 'Change requests are only allowed for FT therapists on Preliminary blocks' }
  }

  // Guard: no duplicate pending requests on the same shift from the same user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('id')
    .eq('shift_id', shiftId)
    .eq('requester_id', user.id)
    .eq('status', 'pending')
    .maybeSingle() as { data: { id: string } | null; error: unknown }
  if (existing) {
    logActionFailure('submitChangeRequest', user.id, 'Duplicate pending request', { shiftId })
    return { error: 'You already have a pending request for this shift' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('preliminary_change_requests')
    .insert({
      schedule_block_id: blockId,
      requester_id: user.id,
      shift_id: shiftId,
      request_type: requestType,
      note: note || null,
      status: 'pending',
    })

  if (error) {
    logActionFailure('submitChangeRequest', user.id, error.message, { blockId, shiftId })
    return { error: error.message }
  }

  revalidatePath('/schedule')
  logActionSuccess('submitChangeRequest', user.id, { blockId, shiftId, requestType })
  return {}
}

/**
 * Manager accepts or rejects a change request.
 * If accepted + request_type === 'mark_off': updates the shift cell_state to 'off'.
 * Note: 'move_shift' acceptance only marks the request resolved — the manager manually edits the cell.
 */
export async function resolveChangeRequest(
  requestId: string,
  decision: 'accepted' | 'rejected',
  responseNote: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('resolveChangeRequest', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('resolveChangeRequest', user.id, { requestId, decision })

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') {
    logActionFailure('resolveChangeRequest', user.id, 'Manager access required', { requestId })
    return { error: 'Manager access required' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: req } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('shift_id, request_type, status, schedule_block_id, requester_id')
    .eq('id', requestId)
    .single() as {
      data: {
        shift_id: string
        request_type: string
        status: string
        schedule_block_id: string
        requester_id: string
      } | null
      error: unknown
    }
  if (!req) {
    logActionFailure('resolveChangeRequest', user.id, 'Change request not found', { requestId })
    return { error: 'Change request not found' }
  }
  if (req.status !== 'pending') {
    logActionFailure('resolveChangeRequest', user.id, 'Request not pending', { requestId, status: req.status })
    return { error: 'Request is no longer pending' }
  }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', req.schedule_block_id)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) {
    logActionFailure('resolveChangeRequest', user.id, 'Block not found', { requestId, blockId: req.schedule_block_id })
    return { error: 'Block not found' }
  }
  if (block.status !== 'preliminary') {
    logActionFailure('resolveChangeRequest', user.id, 'Block status guard rejected', { requestId, status: block.status })
    return { error: 'Cannot resolve requests unless block is still Preliminary' }
  }

  const { data: shiftForNotif } = await supabase
    .from('shifts')
    .select('shift_date')
    .eq('id', req.shift_id)
    .single() as { data: { shift_date: string } | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('preliminary_change_requests')
    .update({
      status: decision,
      response_note: responseNote || null,
      actioned_at: new Date().toISOString(),
      actioned_by: user.id,
    })
    .eq('id', requestId)

  if (updateErr) {
    logActionFailure('resolveChangeRequest', user.id, updateErr.message, { requestId, decision })
    return { error: updateErr.message }
  }

  // If accepted + mark_off: update the shift
  if (decision === 'accepted' && req.request_type === 'mark_off') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'off' })
      .eq('id', req.shift_id)
  }

  const crPayload = changeRequestResolvedPayload(
    decision === 'accepted' ? 'approved' : 'rejected',
    shiftForNotif?.shift_date ?? 'your shift'
  )
  await createNotification(
    req.requester_id,
    'change_request_resolved',
    crPayload.title,
    crPayload.body,
    crPayload.href
  )
  runAfterResponse(() => sendPush(req.requester_id, crPayload))

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  logActionSuccess('resolveChangeRequest', user.id, { requestId, decision })
  return {}
}
