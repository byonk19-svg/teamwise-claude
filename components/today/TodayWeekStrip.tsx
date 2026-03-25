import { STATE_COLORS } from '@/lib/schedule/cell-colors'
import { format } from 'date-fns'

interface DayEntry {
  shift_date: string
  cell_state: string | null
}

interface Props {
  days: DayEntry[]
  todayStr: string
}

export function TodayWeekStrip({ days, todayStr }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-1 overflow-x-auto">
        {days.map(day => {
          const isToday = day.shift_date === todayStr
          const colorClass = day.cell_state
            ? (STATE_COLORS[day.cell_state] ?? 'bg-slate-200')
            : 'bg-slate-100'
          const date = new Date(`${day.shift_date}T00:00:00`)

          return (
            <div
              key={day.shift_date}
              className={`flex flex-col items-center gap-1 min-w-[40px] rounded-md p-1
                ${isToday ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
            >
              <span className="text-[10px] text-slate-400 uppercase">
                {format(date, 'EEE')}
              </span>
              <span className="text-xs font-medium text-slate-700">
                {format(date, 'd')}
              </span>
              <span className={`h-2 w-2 rounded-full ${colorClass}`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
