// app/(app)/schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ScheduleGrid } from '@/components/schedule/ScheduleGrid'
import { BlockPicker } from '@/components/schedule/BlockPicker'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface PageProps {
  searchParams: { blockId?: string; shift?: string }
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')

  if (!profile.department_id) {
    return (
      <div className="text-slate-500 text-sm p-8">
        Your account is not assigned to a department. Contact your manager.
      </div>
    )
  }

  // Fetch all blocks for the department (all statuses, both shifts)
  const { data: allBlocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .in('status', ['preliminary_draft', 'preliminary', 'final', 'active', 'completed'])
    .order('start_date', { ascending: false })

  const allBlocks = (allBlocksData ?? []) as BlockRow[]

  // Determine active shift type
  const requestedShift = searchParams.shift as 'day' | 'night' | undefined
  const activeShift: 'day' | 'night' =
    requestedShift === 'day' || requestedShift === 'night'
      ? requestedShift
      : (profile.default_shift_type ?? 'day')

  // Determine active block
  const blocksForShift = allBlocks.filter(b => b.shift_type === activeShift)
  let block: BlockRow | null = null

  if (searchParams.blockId) {
    block = blocksForShift.find(b => b.id === searchParams.blockId) ?? null
  }
  if (!block) {
    block = blocksForShift[0] ?? null  // most recent
  }

  if (!block) {
    return (
      <div className="flex flex-col gap-4 p-8">
        {allBlocks.length === 0 && profile.role === 'manager' && (
          <Link
            href="/schedule/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 w-fit"
          >
            + Create First Block
          </Link>
        )}
        <p className="text-slate-500 text-sm">No schedule found for {activeShift} shift.</p>
      </div>
    )
  }

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_block_id', block.id)

  const { data: therapistsData } = await supabase
    .from('users')
    .select('*')
    .eq('department_id', profile.department_id)
    .eq('role', 'therapist')
    .order('employment_type', { ascending: true })
    .order('full_name', { ascending: true })

  const shifts = (shiftsData ?? []) as ShiftRow[]
  const therapists = (therapistsData ?? []) as UserRow[]

  return (
    <div className="flex flex-col gap-3">
      {/* Top controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <BlockPicker
          blocks={allBlocks}
          currentBlockId={block.id}
          currentShift={activeShift}
        />
        {profile.role === 'manager' && (
          <Link
            href="/schedule/new"
            className="inline-flex items-center px-3 py-1.5 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800"
          >
            + New Block
          </Link>
        )}
      </div>

      <ScheduleGrid
        block={block}
        shifts={shifts}
        therapists={therapists}
        defaultShiftType={activeShift}
        userRole={profile.role}
      />
    </div>
  )
}
