'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { logActionFailure, logActionStart, logActionSuccess } from '@/lib/observability/action-log'

/** Enter an OC/CI/CX/LE code for a working shift. Lead/charge or manager only. */
export async function enterCode(
  blockId: string,
  shiftId: string,
  entryType: 'OC' | 'CI' | 'CX' | 'LE',
  note: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('enterCode', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('enterCode', user.id, { blockId, shiftId, entryType })

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('enter_operational_code', {
    p_schedule_block_id: blockId,
    p_shift_id: shiftId,
    p_entry_type: entryType,
    p_note: note,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) {
    logActionFailure('enterCode', user.id, String(error), { blockId, shiftId })
    return { error: String(error) }
  }
  if (data?.error) {
    logActionFailure('enterCode', user.id, data.error, { blockId, shiftId })
    return { error: data.error }
  }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  logActionSuccess('enterCode', user.id, { blockId, shiftId, entryType })
  return {}
}

/** Soft-delete (remove) an operational code entry. */
export async function removeCode(
  entryId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('removeCode', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('removeCode', user.id, { entryId })

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('remove_operational_code', {
    p_entry_id: entryId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) {
    logActionFailure('removeCode', user.id, String(error), { entryId })
    return { error: String(error) }
  }
  if (data?.error) {
    logActionFailure('removeCode', user.id, data.error, { entryId })
    return { error: data.error }
  }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  logActionSuccess('removeCode', user.id, { entryId })
  return {}
}

/** Manager-only: revert an active block back to Final status. */
export async function revertToFinal(
  blockId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) {
    logActionFailure('revertToFinal', undefined, 'Not authenticated')
    return { error: 'Not authenticated' }
  }
  logActionStart('revertToFinal', user.id, { blockId })

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('revert_to_final', {
    p_schedule_block_id: blockId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) {
    logActionFailure('revertToFinal', user.id, String(error), { blockId })
    return { error: String(error) }
  }
  if (data?.error) {
    logActionFailure('revertToFinal', user.id, data.error, { blockId })
    return { error: data.error }
  }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  logActionSuccess('revertToFinal', user.id, { blockId })
  return {}
}
