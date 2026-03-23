// components/schedule/AvailabilityWindowControl.tsx
'use client'
import { useState, useTransition } from 'react'
import { openAvailabilityWindow } from '@/app/actions/schedule'
import { format, addDays } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

export function isWindowOpen(
  windowOpen: string | null,
  windowClose: string | null
): boolean {
  if (!windowOpen || !windowClose) return false
  const now = Date.now()
  return now >= new Date(windowOpen).getTime() && now <= new Date(windowClose).getTime()
}

interface Props {
  block: BlockRow
}

export function AvailabilityWindowControl({ block }: Props) {
  // Default deadline: 1 week from today
  const defaultDeadline = format(addDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm")
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const windowOpen = isWindowOpen(block.availability_window_open, block.availability_window_close)

  function handleOpen(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await openAvailabilityWindow(block.id, new Date(deadline).toISOString())
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Availability Window</h3>

      {windowOpen ? (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Open
          </span>
          <p className="text-xs text-slate-500">
            Closes: {block.availability_window_close
              ? new Date(block.availability_window_close).toLocaleString()
              : '—'}
          </p>
        </div>
      ) : block.availability_window_close ? (
        <p className="text-xs text-slate-500">
          Window closed: {new Date(block.availability_window_close).toLocaleString()}
        </p>
      ) : (
        <form onSubmit={handleOpen} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">Submission deadline</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-1 bg-slate-900 text-white text-xs rounded hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            {isPending ? 'Opening...' : 'Open Window'}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
