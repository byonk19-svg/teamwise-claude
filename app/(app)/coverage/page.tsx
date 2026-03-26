// app/(app)/coverage/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CoverageHeatmap } from '@/components/coverage/CoverageHeatmap'
import { ExportCoverageButton } from '@/components/coverage/ExportCoverageButton'
import { AlertBanner } from '@/components/coverage/AlertBanner'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']
type HeadcountRow = Database['public']['Views']['shift_planned_headcount']['Row']
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: { blockId?: string; shift?: string }
}) {
  const { blockId, shift } = searchParams
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')
  if (!profile.department_id) redirect('/schedule')

  // Fetch blocks for the department
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .in('status', ['preliminary_draft', 'preliminary', 'final', 'active', 'completed'])
    .order('start_date', { ascending: false })

  const allBlocks = (blocksData ?? []) as BlockRow[]

  const activeShift: 'day' | 'night' =
    shift === 'night' ? 'night' : 'day'

  const blocksForShift = allBlocks.filter(b => b.shift_type === activeShift)
  let block: BlockRow | null = null
  if (blockId) {
    block = blocksForShift.find(b => b.id === blockId) ?? null
  }
  if (!block) block = blocksForShift[0] ?? null

  if (!block) {
    return (
      <div className="p-8 text-sm text-slate-500">
        No block found. <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // Fetch headcount from the existing view
  const { data: headcountData } = await supabase
    .from('shift_planned_headcount')
    .select('*')
    .eq('schedule_block_id', block.id) as { data: HeadcountRow[] | null; error: unknown }

  // Fetch shifts to compute lead gaps (only need shift_date and lead_user_id)
  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('shift_date, lead_user_id, cell_state')
    .eq('schedule_block_id', block.id) as {
      data: Pick<ShiftRow, 'shift_date' | 'lead_user_id' | 'cell_state'>[] | null
      error: unknown
    }

  // Pending swap count for the header stat
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingSwapCount } = await (supabase as any)
    .from('swap_requests')
    .select('*', { count: 'exact', head: true })
    .eq('schedule_block_id', block.id)
    .eq('status', 'pending')

  const headcount = (headcountData ?? []) as HeadcountRow[]
  const shifts = (shiftsData ?? []) as Pick<ShiftRow, 'shift_date' | 'lead_user_id' | 'cell_state'>[]
  let actualHeadcount: ActualHeadcountRow[] = []
  if (block.status === 'active' || block.status === 'completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualData } = await (supabase as any)
      .from('shift_actual_headcount')
      .select('*')
      .eq('schedule_block_id', block.id) as { data: ActualHeadcountRow[] | null; error: unknown }
    actualHeadcount = (actualData ?? []) as ActualHeadcountRow[]
  }

  // Build lead-gap set (dates with working shifts but no lead)
  const leadDates = new Set(shifts.filter(s => s.lead_user_id !== null).map(s => s.shift_date))
  const workingDates = new Set(shifts.filter(s => s.cell_state === 'working').map(s => s.shift_date))
  const leadGapDates = new Set(Array.from(workingDates).filter(d => !leadDates.has(d)))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Coverage</h1>
        <div className="flex gap-4 text-sm text-slate-600">
          <span>Lead gaps: <strong className={leadGapDates.size > 0 ? 'text-pink-600' : 'text-green-600'}>{leadGapDates.size}</strong></span>
          <span>Pending swaps: <strong className={pendingSwapCount > 0 ? 'text-amber-600' : 'text-slate-600'}>{pendingSwapCount ?? 0}</strong></span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportCoverageButton blockId={block.id} />
          <Link
            href={`/coverage?blockId=${block.id}&shift=day`}
            className={`px-3 py-1 text-sm rounded-md border ${activeShift === 'day' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Day
          </Link>
          <Link
            href={`/coverage?blockId=${block.id}&shift=night`}
            className={`px-3 py-1 text-sm rounded-md border ${activeShift === 'night' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Night
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> &lt;3 understaffed</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> =3 minimum</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> 4-5 optimal</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pink-400 inline-block" /> no lead</span>
      </div>

      {block.status === 'active' && (
        <AlertBanner
          blockId={block.id}
          initialActualHeadcount={actualHeadcount}
        />
      )}

      {block.status === 'completed' && (
        <Link
          href={`/audit/${block.id}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          View Audit Log →
        </Link>
      )}

      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={leadGapDates}
        blockStartDate={block.start_date}
        actualHeadcount={actualHeadcount}
        blockStatus={block.status}
      />
    </div>
  )
}
