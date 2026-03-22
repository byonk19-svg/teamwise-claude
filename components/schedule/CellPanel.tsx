// components/schedule/CellPanel.tsx
'use client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

const STATE_LABELS: Record<string, string> = {
  working:      'Working',
  cannot_work:  'Cannot Work',
  off:          'Off',
  fmla:         'FMLA',
}

const STATE_COLORS: Record<string, 'default' | 'secondary' | 'outline'> = {
  working:      'default',
  cannot_work:  'secondary',
  off:          'outline',
  fmla:         'secondary',
}

interface Props {
  open: boolean
  onClose: () => void
  shift: Shift | undefined
  date: string
  user: UserRow | undefined
}

export function CellPanel({ open, onClose, shift, date, user }: Props) {
  if (!user || !date) return null

  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  const formattedDate = date
    ? format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')
    : ''

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent
        side="right"
        className="w-80 sm:w-96"
        aria-label="Cell details"
      >
        <SheetHeader>
          <SheetTitle className="text-left">{user.full_name}</SheetTitle>
          <p className="text-sm text-slate-500">{formattedDate}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Cell state */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <Badge variant={STATE_COLORS[state]}>
              {STATE_LABELS[state]}
            </Badge>
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

          {/* Phase 1 note */}
          <p className="text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
            Actions available in Phase 2 (cell editing) and beyond.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
