// components/schedule/CellPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { updateCellState } from '@/app/actions/schedule'
import type { Database } from '@/lib/types/database.types'
import { canEditCell } from '@/lib/schedule/block-status'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type CellState = Shift['cell_state']

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
}

export function CellPanel({ open, onClose, shift, date, user, userRole, onCellStateUpdate, blockStatus, blockId, currentUserId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [editError, setEditError] = useState<string | null>(null)

  if (!user || !date) return null

  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  const formattedDate = format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')

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

          {/* Lead assignment */}
          {state === 'working' && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead / Charge</span>
              {isLead ? (
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                  Assigned ✓
                </Badge>
              ) : (
                <span className="text-sm text-slate-400">Not assigned</span>
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
      </SheetContent>
    </Sheet>
  )
}
