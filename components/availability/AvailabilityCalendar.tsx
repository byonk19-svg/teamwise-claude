'use client'
import { useState, useTransition } from 'react'
import { format, addDays } from 'date-fns'
import { submitAvailability, type EntryInput } from '@/app/actions/availability'

type EntryType = EntryInput['entry_type']

function getEntryOptions(employmentType: 'full_time' | 'prn'): Array<{ value: EntryType; label: string }> {
  if (employmentType === 'full_time') {
    return [
      { value: 'cannot_work', label: 'Cannot Work' },
      { value: 'requesting_to_work', label: 'Requesting' },
    ]
  }
  return [
    { value: 'available_day', label: 'Day' },
    { value: 'available_night', label: 'Night' },
    { value: 'available_either', label: 'Either' },
  ]
}

export { getEntryOptions }

interface Props {
  blockId: string
  startDate: string          // yyyy-MM-dd
  employmentType: 'full_time' | 'prn'
  existing: Record<string, EntryType>  // date → entry_type
  windowClosed: boolean
}

export function AvailabilityCalendar({ blockId, startDate, employmentType, existing, windowClosed }: Props) {
  const options = getEntryOptions(employmentType)
  const dates = Array.from({ length: 42 }, (_, i) =>
    format(addDays(new Date(startDate + 'T00:00:00'), i), 'yyyy-MM-dd')
  )

  const [selections, setSelections] = useState<Record<string, EntryType>>(existing)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(date: string, value: EntryType) {
    setSelections(prev => {
      const next = { ...prev }
      if (next[date] === value) {
        delete next[date]  // deselect
      } else {
        next[date] = value
      }
      return next
    })
    setSaved(false)
  }

  function handleSubmit() {
    setError(null)
    const entries: EntryInput[] = Object.entries(selections).map(([date, type]) => ({
      entry_date: date,
      entry_type: type,
    }))
    startTransition(async () => {
      const result = await submitAvailability(blockId, entries)
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
      }
    })
  }

  // Group dates into 6 weeks
  const weeks = Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))

  const cellBase = 'w-full text-xs py-1 rounded transition-colors border text-center'
  const cellSelected = 'bg-slate-900 text-white border-slate-900'
  const cellUnselected = 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
  const cellDisabled = 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'

  return (
    <div className="space-y-4">
      {windowClosed && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
          The availability window is closed. Your submission is read-only.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-slate-500 pb-2 pr-3 w-20">Option</th>
              {weeks.map((week, wi) => (
                <th key={wi} colSpan={7} className="text-center text-xs text-slate-500 pb-1 border-l border-slate-100 px-1">
                  {format(new Date(week[0] + 'T00:00:00'), 'MMM d')} –{' '}
                  {format(new Date(week[6] + 'T00:00:00'), 'MMM d')}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {dates.map(d => (
                <th key={d} className="text-center text-[10px] text-slate-400 pb-1 w-9">
                  {format(new Date(d + 'T00:00:00'), 'EEEEE')}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {dates.map(d => (
                <th key={d} className="text-center text-[10px] text-slate-400 pb-2">
                  {format(new Date(d + 'T00:00:00'), 'd')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.map(opt => (
              <tr key={opt.value}>
                <td className="text-xs font-medium text-slate-600 pr-3 py-0.5 whitespace-nowrap">
                  {opt.label}
                </td>
                {dates.map(date => {
                  const isSelected = selections[date] === opt.value
                  const disabled = windowClosed
                  return (
                    <td key={date} className="px-0.5 py-0.5">
                      <button
                        onClick={() => !disabled && toggle(date, opt.value)}
                        disabled={disabled}
                        className={[
                          cellBase,
                          disabled ? cellDisabled : isSelected ? cellSelected : cellUnselected
                        ].join(' ')}
                        aria-pressed={isSelected}
                        aria-label={`${opt.label} on ${date}`}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!windowClosed && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Submit Availability'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}
    </div>
  )
}
