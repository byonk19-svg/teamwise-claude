// app/actions/schedule.ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { addDays, format } from 'date-fns'

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
    .single()
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
      .single()
    if (priorBlock) copiedFromBlockId = priorBlock.id
  }

  // Create the new block
  const { data: newBlock, error: blockErr } = await supabase
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
    .single()

  if (blockErr || !newBlock) throw new Error(`Failed to create block: ${blockErr?.message}`)

  // Call copy_block RPC if copying
  if (copiedFromBlockId) {
    const { error: copyErr } = await supabase.rpc('copy_block', {
      source_block_id: copiedFromBlockId,
      new_block_id: newBlock.id,
    })
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
    .single()
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { error } = await supabase
    .from('shifts')
    .update({ cell_state: newState })
    .eq('id', shiftId)

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
    .single()
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // Guard: prevent reopening a window that has already been set
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('availability_window_open')
    .eq('id', blockId)
    .single()
  if (block?.availability_window_open) {
    return { error: 'Availability window has already been opened for this block' }
  }

  const { error } = await supabase
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
