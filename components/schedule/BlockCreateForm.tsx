// components/schedule/BlockCreateForm.tsx
'use client'
import { useState, useTransition } from 'react'
import { createBlock } from '@/app/actions/schedule'
import { format, addDays, nextSunday, isSunday, getDay } from 'date-fns'

function getNextSunday(): string {
  const today = new Date()
  const candidate = isSunday(today) ? today : nextSunday(today)
  return format(candidate, 'yyyy-MM-dd')
}

// Exported for testing
export function computeEndDate(startDate: string): string {
  return format(addDays(new Date(startDate + 'T00:00:00'), 41), 'yyyy-MM-dd')
}

export function isStartDateSunday(dateStr: string): boolean {
  return getDay(new Date(dateStr + 'T00:00:00')) === 0
}

export function BlockCreateForm() {
  const [startDate, setStartDate] = useState(getNextSunday())
  const [shiftType, setShiftType] = useState<'day' | 'night'>('day')
  const [copyPrior, setCopyPrior] = useState(true)
  const [isPending, startTransition] = useTransition()

  const endDate = computeEndDate(startDate)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await createBlock(formData)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Shift type */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Shift Type</label>
        <div className="flex gap-3">
          {(['day', 'night'] as const).map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="shift_type"
                value={s}
                checked={shiftType === s}
                onChange={() => setShiftType(s)}
                className="accent-slate-900"
              />
              <span className="text-sm capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Start date */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Start Date <span className="text-slate-400 font-normal">(must be a Sunday)</span>
        </label>
        <input
          type="date"
          name="start_date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          required
        />
        {endDate && (
          <p className="mt-1 text-xs text-slate-500">
            End date: {format(new Date(endDate + 'T00:00:00'), 'MMMM d, yyyy')} (42 days)
          </p>
        )}
      </div>

      {/* Copy from prior */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="copy_prior"
            value="true"
            checked={copyPrior}
            onChange={e => setCopyPrior(e.target.checked)}
            className="accent-slate-900"
          />
          <span className="text-sm text-slate-700">Copy FT schedule from prior block</span>
        </label>
        <p className="mt-1 text-xs text-slate-400 ml-6">
          PRN rows will be empty. Operational codes are never copied.
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? 'Creating...' : 'Create Block'}
      </button>
    </form>
  )
}
