import { cn } from '@/lib/utils'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'
import type { ConflictType } from '@/lib/schedule/conflict-detection'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']

interface Props {
  shift: Shift | undefined
  onClick: (shift: Shift | undefined, date: string) => void
  date: string
  isConflicted?: boolean
  dateHasLead?: boolean
  availConflict?: ConflictType
}

export function GridCell({
  shift,
  onClick,
  date,
  isConflicted = false,
  dateHasLead = true,
  availConflict = null,
}: Props) {
  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id
  const showLeadGap = state === 'working' && !dateHasLead

  const availConflictTitle =
    availConflict === 'cannot_work'
      ? 'Availability conflict: cannot work'
      : availConflict === 'wrong_shift_type'
        ? 'Availability conflict: wrong shift type'
        : undefined

  return (
    <button
      type="button"
      onClick={() => onClick(shift, date)}
      className={cn(
        'relative h-9 text-xs flex items-center justify-center border border-white/20',
        'transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-slate-400',
        cellStateClass(state),
        isConflicted && 'ring-2 ring-inset ring-amber-400',
        availConflict && 'border-yellow-400 border-2'
      )}
      aria-label={`${date}: ${state}${showLeadGap ? ' (no lead)' : ''}${isConflicted ? ' (constraint conflict)' : ''}${availConflict ? ` (${availConflict})` : ''}`}
    >
      {cellStateLabel(state)}
      {isLead && state === 'working' && (
        <span
          className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400"
          title="Lead/charge"
        />
      )}
      {showLeadGap && (
        <span
          className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-pink-400"
          title="No lead assigned for this date"
        />
      )}
      {isConflicted && (
        <span
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400"
          title="Constraint conflict"
        />
      )}
      {availConflict && !isConflicted && (
        <span
          className="absolute top-0.5 right-0.5 text-yellow-600 leading-none text-[8px]"
          title={availConflictTitle}
        >
          ⚠
        </span>
      )}
      {availConflict && isConflicted && (
        <span
          className="absolute top-0.5 left-0.5 text-yellow-600 leading-none text-[8px]"
          title={availConflictTitle}
        >
          ⚠
        </span>
      )}
    </button>
  )
}
