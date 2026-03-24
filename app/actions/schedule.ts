// app/actions/schedule.ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { addDays, format } from 'date-fns'
import { canEditCell, canPostPreliminary, canPublishFinal } from '@/lib/schedule/block-status'

/** Create a new schedule block. Optionally copies FT shifts from the most recent prior block. */
export async function createBlock(formData: FormData) {
  const user = await getServerUser()
  if (!user) throw new Error('Not authenticated')

  const supabase = createClient()

  // Verify manager role
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') throw new Error('Manager access required')
  if (!profile.department_id) throw new Error('No department assigned')

  const shiftType = formData.get('shift_type') as 'day' | 'night'
  const startDate = formData.get('start_date') as string
  const copyPrior = formData.get('copy_prior') === 'true'

  const endDate = format(addDays(new Date(startDate + 'T00:00:00'), 41), 'yyyy-MM-dd')

  // Find most recent prior block of same shift type (for copy)
  let copiedFromBlockId: string | null = null
  if (copyPrior) {
    const { data: priorBlock } = await supabase
      .from('schedule_blocks')
      .select('id')
      .eq('department_id', profile.department_id)
      .eq('shift_type', shiftType)
      .in('status', ['final', 'active', 'completed', 'preliminary_draft', 'preliminary'])
      .order('start_date', { ascending: false })
      .limit(1)
      .single() as { data: { id: string } | null; error: unknown }
    if (priorBlock) copiedFromBlockId = priorBlock.id
  }

  // Create the new block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newBlock, error: blockErr } = await (supabase as any)
    .from('schedule_blocks')
    .insert({
      department_id: profile.department_id,
      shift_type: shiftType,
      start_date: startDate,
      end_date: endDate,
      status: 'preliminary_draft',
      copied_from_block_id: copiedFromBlockId,
      created_by: user.id,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (blockErr || !newBlock) throw new Error(`Failed to create block: ${blockErr?.message}`)

  // Call copy_block RPC if copying
  if (copiedFromBlockId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: copyErr } = await (supabase as any).rpc('copy_block', {
      source_block_id: copiedFromBlockId,
      new_block_id: newBlock.id,
    }) as { error: { message: string } | null }
    if (copyErr) throw new Error(`Failed to copy block: ${copyErr.message}`)
  }

  revalidatePath('/schedule')
  redirect(`/schedule?blockId=${newBlock.id}&shift=${shiftType}`)
}

/** Update a single cell's state. Manager only. */
export async function updateCellState(
  shiftId: string,
  newState: 'working' | 'cannot_work' | 'off' | 'fmla'
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

  // Fetch block status to guard against editing published blocks
  const { data: shiftRow } = await supabase
    .from('shifts')
    .select('schedule_block_id')
    .eq('id', shiftId)
    .single() as { data: { schedule_block_id: string } | null; error: unknown }

  if (shiftRow) {
    const { data: blockRow } = await supabase
      .from('schedule_blocks')
      .select('status')
      .eq('id', shiftRow.schedule_block_id)
      .single() as { data: { status: string } | null; error: unknown }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (blockRow && !canEditCell(blockRow.status as any, 'manager')) {
      return { error: 'Cannot edit cells on a published block' }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('shifts')
    .update({ cell_state: newState })
    .eq('id', shiftId) as { error: { message: string } | null }

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/** Open the availability window for a block. Manager only.
 *  Returns an error if a window has already been set on this block.
 */
export async function openAvailabilityWindow(
  blockId: string,
  closesAt: string  // ISO timestamp string
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

  // Guard: prevent reopening a window that has already been set
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('availability_window_open')
    .eq('id', blockId)
    .single() as { data: { availability_window_open: string | null } | null; error: unknown }
  if (block?.availability_window_open) {
    return { error: 'Availability window has already been opened for this block' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('schedule_blocks')
    .update({
      availability_window_open: new Date().toISOString(),
      availability_window_close: closesAt,
    })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/** Post a preliminary_draft block as Preliminary. Manager only. */
export async function postPreliminary(blockId: string): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!block || !canPostPreliminary(block.status as any)) {
    return { error: 'Block must be in preliminary_draft status' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('schedule_blocks')
    .update({ status: 'preliminary' })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/** Publish a Preliminary block as Final. Manager only. Records published_by + published_at. */
export async function postFinal(blockId: string): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block || !canPublishFinal(block.status as 'preliminary')) {
    return { error: 'Block must be in Preliminary status to publish as Final' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('schedule_blocks')
    .update({
      status: 'final',
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}
