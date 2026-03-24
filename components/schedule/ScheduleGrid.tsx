// components/schedule/ScheduleGrid.tsx
'use client'
import { useState, useMemo, useCallback } from 'react'
import { format, addDays } from 'date-fns'
import { GridCell } from './GridCell'
import { ShiftToggle } from './ShiftToggle'
import { CellPanel } from './CellPanel'
import { applyOptimisticUpdate } from '@/lib/schedule/optimistic'
import { BulkLeadModal } from './BulkLeadModal'
import { getLeadGapDates } from '@/lib/schedule/lead-assignment'
import { canEditCell } from '@/lib/schedule/block-status'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  block: Database['public']['Tables']['schedule_blocks']['Row']
  shifts: Shift[]
  therapists: UserRow[]
  defaultShiftType: 'day' | 'night'
  userRole: 'manager' | 'therapist'
  conflictedCells?: Set<string>
  blockStatus: Database['public']['Tables']['schedule_blocks']['Row']['status']
  blockId: string
  currentUserId: string
}

function buildDates(startDate: string): string[] {
  const start = new Date(startDate + 'T00:00:00')
  return Array.from({ length: 42 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

function buildWeeks(dates: string[]): string[][] {
  return Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))
}

export function ScheduleGrid({ block, shifts: initialShifts, therapists, defaultShiftType, userRole, conflictedCells, blockStatus, blockId, currentUserId }: Props) {
  const [activeShift, setActiveShift] = useState<'day' | 'night'>(defaultShiftType)
  const [shifts, setShifts] = useState<Shift[]>(initialShifts)
  const [panelShift, setPanelShift] = useState<Shift | undefined>()
  const [panelDate, setPanelDate] = useState<string | null>(null)
  const [panelUser, setPanelUser] = useState<UserRow | undefined>()
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelLeadCandidates, setPanelLeadCandidates] = useState<UserRow[]>([])
  const [panelCurrentLeadUserId, setPanelCurrentLeadUserId] = useState<string | null>(null)
  const [showBulkModal, setShowBulkModal] = useState(false)

  const dates = useMemo(() => buildDates(block.start_date), [block.start_date])
  const weeks = useMemo(() => buildWeeks(dates), [dates])

  const ftTherapists = useMemo(
    () => therapists.filter(t => t.employment_type === 'full_time'),
    [therapists]
  )
  const prnTherapists = useMemo(
    () => therapists.filter(t => t.employment_type === 'prn'),
    [therapists]
  )

  const shiftIndex = useMemo(() => {
    const index = new Map<string, Shift>()
    for (const s of shifts) {
      index.set(`${s.user_id}:${s.shift_date}`, s)
    }
    return index
  }, [shifts])

  // Dates where at least one shift has lead_user_id set
  const leadDates = useMemo(() => {
    const s = new Set<string>()
    for (const sh of shifts) {
      if (sh.lead_user_id !== null) s.add(sh.shift_date)
    }
    return s
  }, [shifts])

  const leadGapDates = useMemo(
    () => getLeadGapDates(shifts),
    [shifts]
  )

  const leadQualifiedTherapists = useMemo(
    () => therapists.filter(t => t.is_lead_qualified),
    [therapists]
  )

  // Current lead user_id per date
  const currentLeadByDate = useMemo(() => {
    const m = new Map<string, string>()
    for (const sh of shifts) {
      if (sh.lead_user_id !== null) m.set(sh.shift_date, sh.lead_user_id)
    }
    return m
  }, [shifts])

  function getShift(userId: string, date: string): Shift | undefined {
    return shiftIndex.get(`${userId}:${date}`)
  }

  const handleCellStateUpdate = useCallback((shiftId: string, newState: Shift['cell_state'], revert: Shift) => {
    setShifts(prev => applyOptimisticUpdate(prev, shiftId, newState))
    setPanelShift(prev => prev?.id === shiftId ? { ...prev, cell_state: newState } : prev)

    return () => {
      setShifts(prev => prev.map(s => s.id === shiftId ? revert : s))
      setPanelShift(prev => prev?.id === shiftId ? revert : prev)
    }
  }, [])

  const handleLeadUpdate = useCallback((date: string, newLeadUserId: string | null) => {
    setShifts(prev => prev.map(s => {
      if (s.shift_date !== date) return s
      if (newLeadUserId === null) return { ...s, lead_user_id: null }
      return { ...s, lead_user_id: s.user_id === newLeadUserId ? newLeadUserId : null }
    }))
    setPanelCurrentLeadUserId(newLeadUserId)
  }, [])

  function handleCellClick(shift: Shift | undefined, date: string, user: UserRow) {
    const currentShift = shift ? shifts.find(s => s.id === shift.id) ?? shift : undefined
    setPanelShift(currentShift)
    setPanelDate(date)
    setPanelUser(user)
    setPanelOpen(true)
    // Compute lead candidates: lead-qualified AND working on this date
    const candidates = therapists.filter(t =>
      t.is_lead_qualified &&
      shiftIndex.get(`${t.id}:${date}`)?.cell_state === 'working'
    )
    setPanelLeadCandidates(candidates)
    setPanelCurrentLeadUserId(currentLeadByDate.get(date) ?? null)
  }

  const headcounts = useMemo(() => {
    return dates.map(date => ({
      date,
      ft: ftTherapists.filter(t => shiftIndex.get(`${t.id}:${date}`)?.cell_state === 'working').length,
      prn: prnTherapists.filter(t => shiftIndex.get(`${t.id}:${date}`)?.cell_state === 'working').length,
    }))
  }, [dates, ftTherapists, prnTherapists, shiftIndex])

  const ftCountByDate = useMemo(() => {
    const m = new Map<string, number>()
    headcounts.forEach(({ date, ft }) => m.set(date, ft))
    return m
  }, [headcounts])

  const prnCountByDate = useMemo(() => {
    const m = new Map<string, number>()
    headcounts.forEach(({ date, prn }) => m.set(date, prn))
    return m
  }, [headcounts])

  function ftCount(date: string): number {
    return ftCountByDate.get(date) ?? 0
  }
  function prnCount(date: string): number {
    return prnCountByDate.get(date) ?? 0
  }
  function headcountClass(n: number): string {
    if (n < 3) return 'text-red-600 font-bold'
    if (n === 3) return 'text-yellow-600 font-semibold'
    return 'text-green-600 font-semibold'
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <ShiftToggle defaultShift={defaultShiftType} onToggle={setActiveShift} />
        {userRole === 'manager' && canEditCell(blockStatus, userRole) && (
          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="px-3 py-1 text-xs border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
          >
            Bulk Assign Lead {leadGapDates.length > 0 && `(${leadGapDates.length} gaps)`}
          </button>
        )}
        <span className="text-sm text-slate-500">
          {format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} –{' '}
          {format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
          {block.status.replace('_', ' ')}
        </span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div
          className="schedule-grid min-w-max"
          data-shift={activeShift}
          style={{ '--shift-color': activeShift === 'day' ? '#3b82f6' : '#8b5cf6' } as React.CSSProperties}
        >
          {/* Week header row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Staff
            </div>
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="col-span-7 text-center text-xs text-slate-500 py-1 border-l border-slate-200 first:border-l-0"
              >
                {format(new Date(week[0] + 'T00:00:00'), 'MMM d')} –{' '}
                {format(new Date(week[6] + 'T00:00:00'), 'MMM d')}
              </div>
            ))}
          </div>

          {/* Day letter row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name" />
            {dates.map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-0.5">
                {format(new Date(d + 'T00:00:00'), 'EEEEE')}
              </div>
            ))}
          </div>

          {/* Date number row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name" />
            {dates.map(d => (
              <div key={d} className="text-center text-[10px] text-slate-500 pb-1">
                {format(new Date(d + 'T00:00:00'), 'd')}
              </div>
            ))}
          </div>

          {/* FT section label */}
          <div className="grid-row bg-blue-50/30">
            <div className="grid-cell-name px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide col-span-full">
              Full-Time
            </div>
          </div>

          {ftTherapists.map(therapist => (
            <div key={therapist.id} className="grid-row hover:bg-slate-50/50 group">
              <div className="grid-cell-name px-2 py-1 flex items-center gap-1 border-r border-slate-200">
                <span className="text-xs text-slate-700 truncate">{therapist.full_name}</span>
                {therapist.is_lead_qualified && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" title="Lead-qualified" />
                )}
              </div>
              {dates.map(date => (
                <GridCell
                  key={date}
                  shift={getShift(therapist.id, date)}
                  date={date}
                  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
                  isConflicted={conflictedCells?.has(`${therapist.id}:${date}`) ?? false}
                  dateHasLead={leadDates.has(date)}
                />
              ))}
            </div>
          ))}

          {/* FT Count row */}
          <div className="grid-row bg-slate-50 border-y border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-semibold text-slate-500 border-r border-slate-200">
              FT Count
            </div>
            {dates.map(date => {
              const n = ftCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>

          {/* PRN section label */}
          <div className="grid-row bg-violet-50/30">
            <div className="grid-cell-name px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide col-span-full">
              PRN
            </div>
          </div>

          {prnTherapists.map(therapist => (
            <div key={therapist.id} className="grid-row hover:bg-slate-50/50">
              <div className="grid-cell-name px-2 py-1 flex items-center border-r border-slate-200">
                <span className="text-xs text-slate-700 truncate">{therapist.full_name}</span>
              </div>
              {dates.map(date => (
                <GridCell
                  key={date}
                  shift={getShift(therapist.id, date)}
                  date={date}
                  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
                  isConflicted={conflictedCells?.has(`${therapist.id}:${date}`) ?? false}
                  dateHasLead={leadDates.has(date)}
                />
              ))}
            </div>
          ))}

          {/* PRN Count row */}
          <div className="grid-row bg-slate-50 border-y border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-semibold text-slate-500 border-r border-slate-200">
              PRN Count
            </div>
            {dates.map(date => {
              const n = prnCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>

          {/* Total row */}
          <div className="grid-row bg-slate-100 border-b border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-bold text-slate-600 border-r border-slate-200">
              Total
            </div>
            {dates.map(date => {
              const n = ftCount(date) + prnCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 font-bold ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Cell panel */}
      <CellPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        shift={panelShift}
        date={panelDate ?? ''}
        user={panelUser}
        userRole={userRole}
        onCellStateUpdate={handleCellStateUpdate}
        blockStatus={blockStatus}
        blockId={blockId}
        currentUserId={currentUserId}
        leadCandidates={panelLeadCandidates}
        currentLeadUserId={panelCurrentLeadUserId}
        onLeadUpdate={handleLeadUpdate}
      />

      {showBulkModal && (
        <BulkLeadModal
          blockId={block.id}
          gapDates={leadGapDates}
          leadQualified={leadQualifiedTherapists}
          onClose={() => setShowBulkModal(false)}
          onComplete={() => setShifts(prev => [...prev])}
        />
      )}
    </div>
  )
}
