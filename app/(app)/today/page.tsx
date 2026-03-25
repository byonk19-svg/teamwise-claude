// app/(app)/today/page.tsx
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TodayShiftCard } from '@/components/today/TodayShiftCard'
import { TodayWeekStrip } from '@/components/today/TodayWeekStrip'
import { TodaySwapsCard, type TodaySwapSummary } from '@/components/today/TodaySwapsCard'
import { TodayOpCodesCard } from '@/components/today/TodayOpCodesCard'
import { TodayBlockCard } from '@/components/today/TodayBlockCard'
import { TodayOpenShiftsCard } from '@/components/today/TodayOpenShiftsCard'
import { buildWeekWindow, resolveLeadName, computeUnsignaledCount } from '@/lib/today/helpers'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type OpEntry = Database['public']['Tables']['operational_entries']['Row']

export default async function TodayPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const todayStr = new Date().toISOString().slice(0, 10)

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id, employment_type, full_name')
    .eq('id', user.id)
    .single() as {
      data: Pick<UserRow, 'role' | 'department_id' | 'employment_type' | 'full_name'> | null
      error: unknown
    }

  if (!profile) redirect('/login')
  if (profile.role === 'manager') redirect('/schedule')
  if (!profile.department_id) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Your account is not assigned to a department. Contact your manager.
      </div>
    )
  }

  const isPRN = profile.employment_type === 'prn'
  const deptId = profile.department_id

  const [
    blocksResult,
    therapistsResult,
    swapsResult,
    opCodesResult,
  ] = await Promise.all([
    supabase
      .from('schedule_blocks')
      .select('*')
      .eq('department_id', deptId)
      .in('status', ['final', 'active'])
      .order('start_date', { ascending: false })
      .limit(1),

    supabase
      .from('users')
      .select('id, full_name')
      .eq('department_id', deptId)
      .eq('role', 'therapist'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('swap_requests')
      .select(`
        id,
        requester_id,
        partner_id,
        expires_at,
        requester_shift:requester_shift_id(shift_date),
        partner_shift:partner_shift_id(shift_date)
      `)
      .or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString()),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('operational_entries')
      .select('id, entry_type, note, shift_id, user_id, entry_date, removed_at')
      .eq('user_id', user.id)
      .eq('entry_date', todayStr)
      .is('removed_at', null),
  ])

  const block = (blocksResult.data?.[0] ?? null) as BlockRow | null
  const therapists = (therapistsResult.data ?? []) as Pick<UserRow, 'id' | 'full_name'>[]
  const swapsRaw = swapsResult.data ?? []
  const opEntries = (opCodesResult.data ?? []) as OpEntry[]

  const swaps: TodaySwapSummary[] = (swapsRaw as Array<{
    id: string
    requester_id: string
    partner_id: string
    expires_at: string
    requester_shift: { shift_date: string } | null
  }>).map(s => ({
    id: s.id,
    requester_id: s.requester_id,
    partner_id: s.partner_id,
    expires_at: s.expires_at,
    requester_shift_date: s.requester_shift?.shift_date ?? '',
  }))

  if (!block) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">
            No active schedule. Check back when your manager posts the next block.
          </p>
        </div>
      </div>
    )
  }

  const [shiftsResult, leadResult, prelimResult] = await Promise.all([
    supabase
      .from('shifts')
      .select('*')
      .eq('user_id', user.id)
      .eq('schedule_block_id', block.id),

    supabase
      .from('shifts')
      .select('lead_user_id')
      .eq('schedule_block_id', block.id)
      .eq('shift_date', todayStr)
      .not('lead_user_id', 'is', null)
      .limit(1),

    isPRN
      ? supabase
          .from('schedule_blocks')
          .select('id')
          .eq('department_id', deptId)
          .in('status', ['preliminary', 'preliminary_draft'])
          .order('start_date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ])

  const shifts = (shiftsResult.data ?? []) as ShiftRow[]
  const leadRows = leadResult.data as Array<{ lead_user_id: string | null }> | null
  const leadUserId = leadRows?.[0]?.lead_user_id ?? null
  const prelimBlock = (prelimResult.data as Array<{ id: string }> | null)?.[0] ?? null

  let unsignaledCount = 0
  if (isPRN && prelimBlock) {
    const offShiftsRes = await supabase
      .from('shifts')
      .select('id')
      .eq('user_id', user.id)
      .eq('schedule_block_id', prelimBlock.id)
      .eq('cell_state', 'off')
    const offList = (offShiftsRes.data ?? []) as Pick<ShiftRow, 'id'>[]
    let interestRows: { shift_id: string }[] = []
    if (offList.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: interestData } = await (supabase as any)
        .from('prn_shift_interest')
        .select('shift_id')
        .eq('user_id', user.id)
        .in(
          'shift_id',
          offList.map(s => s.id)
        )
      interestRows = interestData ?? []
    }
    unsignaledCount = computeUnsignaledCount(offList, interestRows)
  }

  const todayShift = shifts.find(s => s.shift_date === todayStr) ?? null
  const leadName = resolveLeadName(leadUserId, therapists)
  const weekDays = buildWeekWindow(shifts, block.start_date, block.end_date, todayStr)
  const therapistNameMap = new Map(therapists.map(t => [t.id, t.full_name ?? '']))

  const dateLabel = format(new Date(`${todayStr}T00:00:00`), 'EEEE, MMMM d')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Today</h1>
        <span className="text-sm text-slate-500">{dateLabel}</span>
      </div>

      <TodayShiftCard shift={todayShift} block={block} leadName={leadName} />

      <TodayWeekStrip days={weekDays} todayStr={todayStr} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TodaySwapsCard
          swaps={swaps}
          currentUserId={user.id}
          therapistNames={therapistNameMap}
        />
        <TodayOpCodesCard entries={opEntries} />
        <TodayBlockCard block={block} />
        {isPRN && (
          <TodayOpenShiftsCard
            unsignaledCount={unsignaledCount}
            prelimBlockId={prelimBlock?.id ?? null}
          />
        )}
      </div>
    </div>
  )
}
