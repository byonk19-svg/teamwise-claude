// components/schedule/CellPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { updateCellState } from '@/app/actions/schedule'
import { assignLead } from '@/app/actions/lead-assignment'
import type { Database } from '@/lib/types/database.types'
import { canEditCell } from '@/lib/schedule/block-status'
import { isChangeRequestAllowed } from '@/lib/schedule/change-requests'
import { submitChangeRequest } from '@/app/actions/change-requests'
import { submitSwap } from '@/app/actions/swap-requests'
import { isSwapAllowed } from '@/lib/schedule/swap-requests'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type CellState = Shift['cell_state']
type ChangeReqType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']

const STATE_LABELS: Record<CellState, string> = {
  working:      'Working',
  cannot_work:  'Cannot Work',
  off:          'Off',
  fmla:         'FMLA',
}

const ALL_STATES: CellState[] = ['working', 'cannot_work', 'off', 'fmla']

interface Props {
  open: boolean
  onClose: () => void
  shift: Shift | undefined
  date: string
  user: UserRow | undefined
  userRole: 'manager' | 'therapist'
  onCellStateUpdate: (shiftId: string, newState: CellState, revert: Shift) => () => void
  blockStatus: Database['public']['Tables']['schedule_blocks']['Row']['status']
  blockId: string
  currentUserId: string
  leadCandidates: UserRow[]
  currentLeadUserId: string | null
  onLeadUpdate: (date: string, newLeadUserId: string | null) => void
  workingShiftsByUser: Map<string, Array<{ shiftId: string; date: string }>>
  allTherapists: UserRow[]
}

export function CellPanel({ open, onClose, shift, date, user, userRole, onCellStateUpdate, blockStatus, blockId, currentUserId, leadCandidates, currentLeadUserId, onLeadUpdate, workingShiftsByUser, allTherapists }: Props) {
  const [isPending, startTransition] = useTransition()
  const [editError, setEditError] = useState<string | null>(null)
  const [showChangeReqForm, setShowChangeReqForm] = useState(false)
  const [reqType, setReqType] = useState<ChangeReqType>('move_shift')
  const [reqNote, setReqNote] = useState('')
  const [reqError, setReqError] = useState<string | null>(null)
  const [reqSuccess, setReqSuccess] = useState(false)
  const [showSwapForm, setShowSwapForm] = useState(false)
  const [swapPartnerId, setSwapPartnerId] = useState('')
  const [swapPartnerShiftId, setSwapPartnerShiftId] = useState('')
  const [swapNote, setSwapNote] = useState('')
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapSuccess, setSwapSuccess] = useState(false)

  if (!user || !date) return null

  const state = shift?.cell_state ?? 'off'

  const formattedDate = format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')

  function handleChangeReqSubmit() {
    if (!shift) return
    setReqError(null)
    startTransition(async () => {
      const result = await submitChangeRequest(blockId, shift.id, reqType, reqNote || null)
      if (result.error) {
        setReqError(result.error)
      } else {
        setReqSuccess(true)
        setShowChangeReqForm(false)
        setReqNote('')
      }
    })
  }

  function handleStateChange(newState: CellState) {
    if (!shift) return
    setEditError(null)
    const revertFn = onCellStateUpdate(shift.id, newState, shift)
    startTransition(async () => {
      const result = await updateCellState(shift.id, newState)
      if (result.error) {
        revertFn()
        setEditError(result.error)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-80 sm:w-96" aria-label="Cell details">
        <SheetHeader>
          <SheetTitle className="text-left">{user.full_name}</SheetTitle>
          <p className="text-sm text-slate-500">{formattedDate}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Cell state — editable for managers */}
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">Status</span>
            {userRole === 'manager' && shift && canEditCell(blockStatus, userRole) ? (
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_STATES.map(s => (
                  <button
                    key={s}
                    onClick={() => handleStateChange(s)}
                    disabled={isPending || state === s}
                    className={[
                      'py-2 px-3 text-xs rounded-md border transition-colors',
                      state === s
                        ? 'bg-slate-900 text-white border-slate-900 font-medium'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                      isPending ? 'opacity-50 cursor-not-allowed' : ''
                    ].join(' ')}
                  >
                    {STATE_LABELS[s]}
                  </button>
                ))}
              </div>
            ) : (
              <Badge variant={state === 'working' ? 'default' : state === 'off' ? 'outline' : 'secondary'}>
                {STATE_LABELS[state]}
              </Badge>
            )}
            {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
          </div>

          {/* Lead / Charge — interactive for managers on editable blocks */}
          {state === 'working' && (
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-2">Lead / Charge</span>
              {userRole === 'manager' && canEditCell(blockStatus, userRole) ? (
                <select
                  value={currentLeadUserId ?? ''}
                  disabled={isPending}
                  onChange={e => {
                    const newId = e.target.value || null
                    onLeadUpdate(date, newId)
                    startTransition(async () => {
                      const result = await assignLead(blockId, date, newId)
                      if (result.error) {
                        // revert optimistic update
                        onLeadUpdate(date, currentLeadUserId)
                        setEditError(result.error)
                      }
                    })
                  }}
                  className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                >
                  <option value="">— None —</option>
                  {leadCandidates.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              ) : (
                currentLeadUserId ? (
                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Assigned ✓</Badge>
                ) : (
                  <span className="text-sm text-slate-400">Not assigned</span>
                )
              )}
            </div>
          )}

          {/* Employment type */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Type</span>
            <span className="text-sm text-slate-500 capitalize">
              {user.employment_type.replace('_', '-')}
            </span>
          </div>

          {/* Lead-qualified badge */}
          {user.is_lead_qualified && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead-qualified</span>
              <Badge variant="outline" className="text-blue-600 border-blue-200">Yes</Badge>
            </div>
          )}
        </div>

        {/* FT Change Request — only on Preliminary blocks, therapist's own cell */}
        {shift &&
          isChangeRequestAllowed(blockStatus, userRole, user.employment_type as 'full_time' | 'prn') &&
          user.id === currentUserId && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              {reqSuccess ? (
                <p className="text-sm text-green-700">Change request submitted.</p>
              ) : showChangeReqForm ? (
                <div className="space-y-3">
                  <span className="block text-sm font-medium text-slate-700">Request Change</span>
                  <div className="space-y-1.5">
                    {(['move_shift', 'mark_off', 'other'] as const).map(t => (
                      <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="reqType"
                          value={t}
                          checked={reqType === t}
                          onChange={() => setReqType(t)}
                          className="accent-slate-900"
                        />
                        {t === 'move_shift' ? 'Move shift' : t === 'mark_off' ? 'Mark off' : 'Other'}
                      </label>
                    ))}
                  </div>
                  <textarea
                    value={reqNote}
                    onChange={e => setReqNote(e.target.value)}
                    placeholder="Optional note…"
                    rows={2}
                    className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                  {reqError && <p className="text-xs text-red-600">{reqError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleChangeReqSubmit}
                      disabled={isPending}
                      className="flex-1 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
                    >
                      {isPending ? 'Submitting…' : 'Submit Request'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowChangeReqForm(false); setReqNote('') }}
                      className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowChangeReqForm(true)}
                  className="w-full py-2 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
                >
                  Request Change
                </button>
              )}
            </div>
          )}

        {/* Swap Request — own Working cell, on allowed block statuses */}
        {shift &&
          state === 'working' &&
          user.id === currentUserId &&
          isSwapAllowed(blockStatus) && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              {swapSuccess ? (
                <p className="text-sm text-green-700">Swap request submitted.</p>
              ) : showSwapForm ? (
                <div className="space-y-3">
                  <span className="block text-sm font-medium text-slate-700">Request Swap</span>

                  {/* Partner selector */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Swap with</label>
                    <select
                      value={swapPartnerId}
                      onChange={e => { setSwapPartnerId(e.target.value); setSwapPartnerShiftId('') }}
                      className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      <option value="">— Select therapist —</option>
                      {Array.from(workingShiftsByUser.entries())
                        .filter(([uid]) => uid !== currentUserId && (workingShiftsByUser.get(uid)?.length ?? 0) > 0)
                        .map(([uid]) => {
                          const t = allTherapists.find(th => th.id === uid)
                          return (
                            <option key={uid} value={uid}>{t?.full_name ?? uid}</option>
                          )
                        })
                      }
                    </select>
                  </div>

                  {/* Partner's working dates */}
                  {swapPartnerId && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Take their date</label>
                      <select
                        value={swapPartnerShiftId}
                        onChange={e => setSwapPartnerShiftId(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      >
                        <option value="">— Select date —</option>
                        {(workingShiftsByUser.get(swapPartnerId) ?? []).map(ws => (
                          <option key={ws.shiftId} value={ws.shiftId}>
                            {format(new Date(ws.date + 'T00:00:00'), 'EEE, MMM d')}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <textarea
                    value={swapNote}
                    onChange={e => setSwapNote(e.target.value)}
                    placeholder="Optional note…"
                    rows={2}
                    className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />

                  {swapError && <p className="text-xs text-red-600">{swapError}</p>}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!shift || !swapPartnerShiftId) return
                        setSwapError(null)
                        startTransition(async () => {
                          const result = await submitSwap(blockId, shift.id, swapPartnerShiftId, swapNote || null)
                          if (result.error) setSwapError(result.error)
                          else { setSwapSuccess(true); setShowSwapForm(false) }
                        })
                      }}
                      disabled={isPending || !swapPartnerShiftId}
                      className="flex-1 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
                    >
                      {isPending ? 'Submitting…' : 'Submit Swap Request'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowSwapForm(false); setSwapNote(''); setSwapPartnerId(''); setSwapPartnerShiftId('') }}
                      className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSwapForm(true)}
                  className="w-full py-2 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
                >
                  Request Swap
                </button>
              )}
            </div>
          )}
      </SheetContent>
    </Sheet>
  )
}
