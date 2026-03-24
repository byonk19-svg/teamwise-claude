'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

export type EntryInput = {
  entry_date: string
  entry_type: 'cannot_work' | 'requesting_to_work' | 'available_day' | 'available_night' | 'available_either'
  note?: string
}

/** Upsert availability submission for a block. Replaces all prior entries. */
export async function submitAvailability(
  blockId: string,
  entries: EntryInput[]
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // Verify window is open (server-side check)
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('availability_window_open, availability_window_close')
    .eq('id', blockId)
    .single() as { data: { availability_window_open: string | null; availability_window_close: string | null } | null; error: unknown }

  if (!block) return { error: 'Block not found' }

  const now = Date.now()
  const windowOpen = block.availability_window_open
    ? new Date(block.availability_window_open).getTime()
    : null
  const windowClose = block.availability_window_close
    ? new Date(block.availability_window_close).getTime()
    : null

  if (!windowOpen || !windowClose || now < windowOpen || now > windowClose) {
    return { error: 'Availability window is not open' }
  }

  // Upsert the submission record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: submission, error: subErr } = await (supabase as any)
    .from('availability_submissions')
    .upsert(
      { schedule_block_id: blockId, user_id: user.id },
      { onConflict: 'schedule_block_id,user_id' }
    )
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (subErr || !submission) return { error: subErr?.message ?? 'Submission failed' }

  // Delete all existing entries for this submission, then insert fresh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('availability_entries')
    .delete()
    .eq('submission_id', submission.id)

  if (entries.length > 0) {
    const rows = entries.map(e => ({
      submission_id: submission.id,
      entry_date: e.entry_date,
      entry_type: e.entry_type,
      note: e.note ?? null,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: entriesErr } = await (supabase as any)
      .from('availability_entries')
      .insert(rows) as { error: { message: string } | null }

    if (entriesErr) return { error: entriesErr.message }
  }

  revalidatePath('/availability')
  return {}
}
