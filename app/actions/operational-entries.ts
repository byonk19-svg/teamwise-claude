'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

/** Enter an OC/CI/CX/LE code for a working shift. Lead/charge or manager only. */
export async function enterCode(
  blockId: string,
  shiftId: string,
  entryType: 'OC' | 'CI' | 'CX' | 'LE',
  note: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('enter_operational_code', {
    p_schedule_block_id: blockId,
    p_shift_id: shiftId,
    p_entry_type: entryType,
    p_note: note,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}

/** Soft-delete (remove) an operational code entry. */
export async function removeCode(
  entryId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('remove_operational_code', {
    p_entry_id: entryId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}

/** Manager-only: revert an active block back to Final status. */
export async function revertToFinal(
  blockId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('revert_to_final', {
    p_schedule_block_id: blockId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}
