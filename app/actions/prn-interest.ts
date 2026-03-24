// app/actions/prn-interest.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isPrnInterestAllowed } from '@/lib/schedule/change-requests'

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isPrnInterestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
    return { error: 'PRN interest is only allowed for PRN therapists on Preliminary blocks' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('prn_shift_interest')
    .upsert(
      { user_id: user.id, shift_id: shiftId, outside_availability: outsideAvailability, status: 'pending' },
      { onConflict: 'user_id,shift_id' }
    )

  if (error) return { error: error.message }

  revalidatePath('/availability/open-shifts')
  revalidatePath('/schedule/inbox')
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
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: interest } = await (supabase as any)
    .from('prn_shift_interest')
    .select('shift_id, status')
    .eq('id', interestId)
    .single() as { data: { shift_id: string; status: string } | null; error: unknown }
  if (!interest) return { error: 'Interest record not found' }
  if (interest.status !== 'pending') return { error: 'Already resolved' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('prn_shift_interest')
    .update({ status: decision, actioned_at: new Date().toISOString(), actioned_by: user.id })
    .eq('id', interestId)

  if (updateErr) return { error: updateErr.message }

  if (decision === 'confirmed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'working' })
      .eq('id', interest.shift_id)
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  return {}
}
