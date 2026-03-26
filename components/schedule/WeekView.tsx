'use client'
import { useMemo, useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { OperationalCodeEntry } from './OperationalCodeEntry'
import { STATE_COLORS } from '@/lib/schedule/cell-colors'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

interface Props {
  block: BlockRow
  shifts: ShiftRow[]
  therapists: UserRow[]
  currentUserId: string
  userRole: 'manager' | 'therapist'
  operationalEntriesByShiftId: Map<string, OperationalEntry[]>
  isUserLead: boolean
}

export function WeekView({
  block,
  shifts,
  therapists,
  currentUserId,
  userRole,
  operationalEntriesByShiftId,
  isUserLead,
}: Props) {
  const blockStart = new Date(`${block.start_date}T00:00:00`)
  const blockEnd = new Date(`${block.end_date}T00:00:00`)
  const today = new Date()

  const initialWeekStart = today >= blockStart && today <= blockEnd
    ? startOfWeek(today, { weekStartsOn: 0 })
    : startOfWeek(blockStart, { weekStartsOn: 0 })

  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelShift, setPanelShift] = useState<ShiftRow | null>(null)
  const [panelUser, setPanelUser] = useState<UserRow | null>(null)
  const [panelDate, setPanelDate] = useState<string | null>(null)

  const weekDates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i)
        return format(d, 'yyyy-MM-dd')
      }),
    [weekStart]
  )

  const shiftMap = useMemo(() => {
    const map = new Map<string, ShiftRow>()
    for (const s of shifts) map.set(`${s.user_id}:${s.shift_date}`, s)
    return map
  }, [shifts])

  const visibleTherapists = userRole === 'therapist'
    ? therapists.filter(t => t.id === currentUserId)
    : therapists

  function openPanel(userId: string, date: string) {
    const shift = shiftMap.get(`${userId}:${date}`) ?? null
    const user = therapists.find(t => t.id === userId) ?? null
    if (!shift || !user) return
    setPanelShift(shift)
    setPanelUser(user)
    setPanelDate(date)
    setPanelOpen(true)
  }

  return (
    <div className="schedule-week-view-mobile md:hidden overflow-x-auto">
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={() => setWeekStart(w => addDays(w, -7))}
          className="px-3 py-1 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
        >
          ←
        </button>
        <span className="text-xs font-medium text-slate-600">
          {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d, yyyy')}
        </span>
        <button
          type="button"
          onClick={() => setWeekStart(w => addDays(w, 7))}
          className="px-3 py-1 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
        >
          →
        </button>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid bg-slate-50 border-b border-slate-200" style={{ gridTemplateColumns: '100px repeat(7, 1fr)' }}>
          <div className="px-2 py-1.5 text-xs text-slate-400 font-medium">Name</div>
          {weekDates.map(d => {
            const inBlock = d >= block.start_date && d <= block.end_date
            return (
              <div key={d} className={`px-1 py-1.5 text-center text-xs font-medium ${inBlock ? 'text-slate-600' : 'text-slate-300'}`}>
                <div>{format(new Date(`${d}T00:00:00`), 'EEE')}</div>
                <div>{format(new Date(`${d}T00:00:00`), 'd')}</div>
              </div>
            )
          })}
        </div>

        {visibleTherapists.map((t, ti) => (
          <div
            key={t.id}
            className={`grid border-b border-slate-100 last:border-0 ${ti % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
            style={{ gridTemplateColumns: '100px repeat(7, 1fr)' }}
          >
            <div className="px-2 py-2 text-xs text-slate-700 font-medium truncate flex items-center">
              {t.full_name.split(' ')[0]}
            </div>
            {weekDates.map(d => {
              const inBlock = d >= block.start_date && d <= block.end_date
              const shift = shiftMap.get(`${t.id}:${d}`)
              const state = shift?.cell_state ?? 'off'
              const hasEntries = shift ? (operationalEntriesByShiftId.get(shift.id) ?? []).length > 0 : false
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => inBlock && shift && openPanel(t.id, d)}
                  disabled={!inBlock || !shift}
                  className="flex items-center justify-center py-2 relative disabled:opacity-40"
                >
                  {inBlock ? (
                    <>
                      <span className={`w-3 h-3 rounded-full ${STATE_COLORS[state] ?? 'bg-slate-200'}`} />
                      {hasEntries && state === 'working' && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                      )}
                    </>
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-slate-100 opacity-30" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {panelOpen && panelShift && panelUser && panelDate && (
        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          <SheetContent side="bottom" className="max-h-[80vh]">
            <SheetHeader>
              <SheetTitle className="text-left">{panelUser.full_name}</SheetTitle>
              <p className="text-sm text-slate-500">
                {format(new Date(`${panelDate}T00:00:00`), 'EEEE, MMMM d, yyyy')}
              </p>
            </SheetHeader>
            <div className="mt-2">
              <OperationalCodeEntry
                blockId={block.id}
                shiftId={panelShift.id}
                shiftDate={panelDate}
                blockStart={block.start_date}
                blockStatus={block.status}
                userRole={userRole}
                isUserLead={isUserLead}
                currentUserId={currentUserId}
                entries={operationalEntriesByShiftId.get(panelShift.id) ?? []}
                onUpdate={() => setPanelOpen(false)}
              />
              {block.status !== 'active' && (
                <p className="text-sm text-slate-400 mt-4">
                  Operational codes are only available on active blocks.
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
