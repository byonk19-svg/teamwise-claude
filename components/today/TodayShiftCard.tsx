import { STATE_COLORS } from '@/lib/schedule/cell-colors'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATE_LABELS: Record<string, string> = {
  working: 'Working',
  off: 'Off',
  cannot_work: 'Cannot Work',
  fmla: 'FMLA',
}

interface Props {
  shift: ShiftRow | null
  block: BlockRow
  leadName: string | null
}

export function TodayShiftCard({ shift, block, leadName }: Props) {
  const state = shift?.cell_state ?? null
  const colorClass = state ? (STATE_COLORS[state] ?? 'bg-slate-300') : 'bg-slate-200'
  const label = state ? (STATE_LABELS[state] ?? state) : '—'
  const shiftType = block.shift_type === 'day' ? 'Day Shift' : 'Night Shift'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${colorClass} shrink-0`} />
        <span className="text-lg font-semibold text-slate-900">{label}</span>
        <span className="ml-auto text-sm text-slate-500">{shiftType}</span>
      </div>
      <div className="mt-3 text-sm text-slate-500">
        {state === 'working' ? (
          leadName
            ? <span>Lead: <span className="text-slate-700 font-medium">{leadName}</span></span>
            : <span className="text-slate-400">No lead assigned</span>
        ) : null}
      </div>
    </div>
  )
}
