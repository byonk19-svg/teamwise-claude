// app/actions/lead-assignment.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

/**
 * Manager assigns (or clears) the lead for a given date in a block.
 * Validation is server-side via the assign_lead RPC.
 * Pass leadUserId = null to clear the lead without assigning a new one.
 */
export async function assignLead(
  blockId: string,
  shiftDate: string,
  leadUserId: string | null
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
  const { data, error } = await (supabase as any).rpc('assign_lead', {
    p_schedule_block_id: blockId,
    p_shift_date: shiftDate,
    p_lead_user_id: leadUserId,
  })

  if (error) return { error: error.message }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}
