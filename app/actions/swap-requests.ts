// app/actions/swap-requests.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isSwapAllowed, swapExpiryDate } from '@/lib/schedule/swap-requests'

/**
 * Therapist submits a swap request.
 * requesterShiftId: the requester's Working shift they offer
 * partnerShiftId: the partner's Working shift the requester wants
 */
export async function submitSwap(
  blockId: string,
  requesterShiftId: string,
  partnerShiftId: string,
  requestNote: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // Validate block status
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) return { error: 'Block not found' }
  if (!isSwapAllowed(block.status)) return { error: 'Swaps are not allowed for this block status' }

  // Validate requester shift belongs to this user and is working
  const { data: reqShift } = await supabase
    .from('shifts')
    .select('id, user_id, cell_state, shift_date, is_cross_shift, schedule_block_id')
    .eq('id', requesterShiftId)
    .single() as { data: { id: string; user_id: string; cell_state: string; shift_date: string; is_cross_shift: boolean; schedule_block_id: string } | null; error: unknown }
  if (!reqShift) return { error: 'Shift not found' }
  if (reqShift.user_id !== user.id) return { error: 'You can only swap your own shifts' }
  if (reqShift.cell_state !== 'working') return { error: 'You can only swap a Working shift' }
  if (reqShift.schedule_block_id !== blockId) return { error: 'Shift does not belong to this block' }

  // Validate partner shift exists and is working
  const { data: partnerShift } = await supabase
    .from('shifts')
    .select('id, user_id, cell_state, is_cross_shift, schedule_block_id')
    .eq('id', partnerShiftId)
    .single() as { data: { id: string; user_id: string; cell_state: string; is_cross_shift: boolean; schedule_block_id: string } | null; error: unknown }
  if (!partnerShift) return { error: 'Partner shift not found' }
  if (partnerShift.cell_state !== 'working') return { error: 'Partner must be working on that date' }
  if (partnerShift.schedule_block_id !== blockId) return { error: 'Partner shift does not belong to this block' }
  if (partnerShift.user_id === user.id) return { error: 'Cannot swap with yourself' }

  const isCrossShift = reqShift.is_cross_shift || partnerShift.is_cross_shift

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('swap_requests')
    .insert({
      schedule_block_id: blockId,
      requester_id: user.id,
      requester_shift_id: requesterShiftId,
      partner_id: partnerShift.user_id,
      partner_shift_id: partnerShiftId,
      is_cross_shift: isCrossShift,
      status: 'pending',
      expires_at: swapExpiryDate().toISOString(),
      request_note: requestNote || null,
    })

  if (error) return { error: error.message }

  revalidatePath('/swaps')
  revalidatePath('/schedule')
  return {}
}

/**
 * Manager approves or rejects a swap request.
 * On approval: swaps the cell_states of the two shifts and clears lead if requester was lead.
 */
export async function resolveSwap(
  swapId: string,
  decision: 'approved' | 'rejected',
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
  const { data: swap } = await (supabase as any)
    .from('swap_requests')
    .select('requester_id, partner_id, requester_shift_id, partner_shift_id, status, schedule_block_id')
    .eq('id', swapId)
    .single() as {
      data: {
        requester_id: string; partner_id: string
        requester_shift_id: string; partner_shift_id: string
        status: string; schedule_block_id: string
      } | null; error: unknown
    }
  if (!swap) return { error: 'Swap request not found' }
  if (swap.status !== 'pending') return { error: 'Swap is no longer pending' }

  // Update swap status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('swap_requests')
    .update({
      status: decision,
      response_note: responseNote || null,
      actioned_at: new Date().toISOString(),
      actioned_by: user.id,
    })
    .eq('id', swapId)
  if (updateErr) return { error: updateErr.message }

  if (decision === 'approved') {
    // Fetch both shifts to get dates and lead info
    const { data: reqShift } = await supabase
      .from('shifts')
      .select('id, user_id, shift_date, lead_user_id, schedule_block_id')
      .eq('id', swap.requester_shift_id)
      .single() as { data: { id: string; user_id: string; shift_date: string; lead_user_id: string | null; schedule_block_id: string } | null; error: unknown }

    const { data: partShift } = await supabase
      .from('shifts')
      .select('id, user_id, shift_date')
      .eq('id', swap.partner_shift_id)
      .single() as { data: { id: string; user_id: string; shift_date: string } | null; error: unknown }

    if (!reqShift || !partShift) return { error: 'Could not fetch shift details' }

    const reqGivesDate = reqShift.shift_date
    const partGivesDate = partShift.shift_date

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('shifts').update({ cell_state: 'off' }).eq('id', swap.requester_shift_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('shifts').update({ cell_state: 'off' }).eq('id', swap.partner_shift_id)

    // Requester gains partner's date — find their shift row for that date
    const { data: reqGainsShift } = await supabase
      .from('shifts')
      .select('id')
      .eq('schedule_block_id', reqShift.schedule_block_id)
      .eq('user_id', swap.requester_id)
      .eq('shift_date', partGivesDate)
      .single() as { data: { id: string } | null; error: unknown }

    if (reqGainsShift) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('shifts').update({ cell_state: 'working' }).eq('id', reqGainsShift.id)
    }

    // Partner gains requester's date — find their shift row for that date
    const { data: partGainsShift } = await supabase
      .from('shifts')
      .select('id')
      .eq('schedule_block_id', reqShift.schedule_block_id)
      .eq('user_id', swap.partner_id)
      .eq('shift_date', reqGivesDate)
      .single() as { data: { id: string } | null; error: unknown }

    if (partGainsShift) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('shifts').update({ cell_state: 'working' }).eq('id', partGainsShift.id)
    }

    // If requester was the lead on their given date, clear it
    if (reqShift.lead_user_id !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('shifts')
        .update({ lead_user_id: null })
        .eq('schedule_block_id', reqShift.schedule_block_id)
        .eq('shift_date', reqGivesDate)
    }
  }

  revalidatePath('/swaps')
  revalidatePath('/schedule')
  return {}
}
