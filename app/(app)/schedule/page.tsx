// app/(app)/schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ScheduleGrid } from '@/components/schedule/ScheduleGrid'
import { BlockPicker } from '@/components/schedule/BlockPicker'
import { AvailabilityWindowControl } from '@/components/schedule/AvailabilityWindowControl'
import { SubmissionTracker } from '@/components/availability/SubmissionTracker'
import { ConstraintDiff, type DiffItem } from '@/components/schedule/ConstraintDiff'
import { BlockStatusActions } from '@/components/schedule/BlockStatusActions'
import { PrintButton } from '@/components/schedule/PrintButton'
import { WeekView } from '@/components/schedule/WeekView'
import { getLeadGapDates } from '@/lib/schedule/lead-assignment'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']
type SubmissionRow = Database['public']['Tables']['availability_submissions']['Row']
type AvailabilityEntryRow = Database['public']['Tables']['availability_entries']['Row']
type OperationalEntryRow = Database['public']['Tables']['operational_entries']['Row']

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
  const leadGapDates = getLeadGapDates(shifts)
  const therapists = (therapistsData ?? []) as UserRow[]

  const { data: submissionsForMap } = await supabase
    .from('availability_submissions')
    .select('id, user_id')
    .eq('schedule_block_id', block.id)

  const submissionsLite = (submissionsForMap ?? []) as Pick<SubmissionRow, 'id' | 'user_id'>[]
  const submissionUserMap = new Map(submissionsLite.map((s) => [s.id, s.user_id]))
  const submissionIds = Array.from(submissionUserMap.keys())
  const availabilityMap: Record<string, string> = {}
  if (submissionIds.length > 0) {
    const { data: entriesData } = await supabase
      .from('availability_entries')
      .select('submission_id, entry_date, entry_type')
      .in('submission_id', submissionIds)

    const entriesLite = (entriesData ?? []) as Pick<
      AvailabilityEntryRow,
      'submission_id' | 'entry_date' | 'entry_type'
    >[]
    for (const entry of entriesLite) {
      const uid = submissionUserMap.get(entry.submission_id)
      if (uid) {
        availabilityMap[`${uid}:${entry.entry_date}`] = entry.entry_type
      }
    }
  }

  let operationalEntries: OperationalEntryRow[] = []
  if (block.status === 'active') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entriesQuery = (supabase as any)
      .from('operational_entries')
      .select('*')
      .eq('schedule_block_id', block.id)
      .is('removed_at', null)

    if (profile.role === 'therapist') {
      entriesQuery = entriesQuery.eq('user_id', user.id)
    }

    const { data: entriesData } = await entriesQuery as { data: OperationalEntryRow[] | null; error: unknown }
    operationalEntries = (entriesData ?? []) as OperationalEntryRow[]
  }

  // Fetch availability submissions for current block (manager view)
  let submissions: SubmissionRow[] = []
  if (profile.role === 'manager') {
    const { data: subData } = await supabase
      .from('availability_submissions')
      .select('*')
      .eq('schedule_block_id', block.id)
    submissions = (subData ?? []) as SubmissionRow[]
  }

  // Fetch constraint diff if this is a copied block (manager only)
  let diff: DiffItem[] = []
  if (profile.role === 'manager' && block.copied_from_block_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diffData } = await (supabase as any)
      .rpc('get_constraint_diff', { p_new_block_id: block.id })
    diff = (diffData ?? []) as DiffItem[]
  }

  // Build a Set of "userId:date" keys for O(1) lookup in GridCell
  const conflictedCells = new Set(diff.map(d => `${d.user_id}:${d.shift_date}`))
  const operationalEntriesByShiftId = new Map<string, OperationalEntryRow[]>()
  for (const e of operationalEntries) {
    const arr = operationalEntriesByShiftId.get(e.shift_id) ?? []
    arr.push(e)
    operationalEntriesByShiftId.set(e.shift_id, arr)
  }
  const isUserLead = profile.role === 'manager'
    ? false
    : shifts.some(s => s.lead_user_id === user.id)

  return (
    <div className="flex flex-col gap-3">
      {/* Top controls */}
      <div className="flex items-center justify-between flex-wrap gap-2" data-no-print>
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
        <BlockStatusActions block={block} userRole={profile.role as 'manager' | 'therapist'} leadGapDates={leadGapDates} />
        <PrintButton />
      </div>

      <div id="print-header">
        {block.shift_type} schedule — {block.start_date} to {block.end_date}
      </div>

      {profile.role === 'therapist' && block.status === 'preliminary' && profile.employment_type === 'full_time' && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-no-print>
          This schedule is Preliminary. Open any of your cells to request a change.
        </p>
      )}
      {profile.role === 'therapist' && block.status === 'preliminary' && profile.employment_type === 'prn' && (
        <div className="flex items-center gap-2" data-no-print>
          <Link
            href={`/availability/open-shifts?blockId=${block.id}&shift=${activeShift}`}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            View Open Shifts
          </Link>
        </div>
      )}

      {diff.length > 0 && (
        <div data-no-print>
          <ConstraintDiff diff={diff} />
        </div>
      )}

      <div className="hidden md:block schedule-print-desktop-grid">
        <ScheduleGrid
          block={block}
          shifts={shifts}
          therapists={therapists}
          defaultShiftType={activeShift}
          userRole={profile.role as 'manager' | 'therapist'}
          conflictedCells={conflictedCells}
          currentUserId={user.id}
          blockStatus={block.status}
          blockId={block.id}
          operationalEntriesByShiftId={operationalEntriesByShiftId}
          blockStart={block.start_date}
          availabilityMap={availabilityMap}
        />
      </div>

      <WeekView
        block={block}
        shifts={shifts}
        therapists={therapists}
        currentUserId={user.id}
        userRole={profile.role as 'manager' | 'therapist'}
        operationalEntriesByShiftId={operationalEntriesByShiftId}
        isUserLead={isUserLead}
      />

      {/* Manager availability panel */}
      {profile.role === 'manager' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2" data-no-print>
          <AvailabilityWindowControl block={block} />
          <SubmissionTracker therapists={therapists} submissions={submissions} />
        </div>
      )}
    </div>
  )
}
