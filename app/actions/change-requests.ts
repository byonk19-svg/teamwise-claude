// app/actions/change-requests.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isChangeRequestAllowed } from '@/lib/schedule/change-requests'
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
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }
  if (!profile) return { error: 'Profile not found' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) return { error: 'Block not found' }

  if (!isChangeRequestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
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
  if (existing) return { error: 'You already have a pending request for this shift' }

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

  if (error) return { error: error.message }

  revalidatePath('/schedule')
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
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: req } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('shift_id, request_type, status')
    .eq('id', requestId)
    .single() as { data: { shift_id: string; request_type: string; status: string } | null; error: unknown }
  if (!req) return { error: 'Change request not found' }
  if (req.status !== 'pending') return { error: 'Request is no longer pending' }

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

  if (updateErr) return { error: updateErr.message }

  // If accepted + mark_off: update the shift
  if (decision === 'accepted' && req.request_type === 'mark_off') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'off' })
      .eq('id', req.shift_id)
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  return {}
}
