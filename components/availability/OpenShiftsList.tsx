// components/availability/OpenShiftsList.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { submitPrnInterest } from '@/app/actions/prn-interest'
import type { OpenShift } from '@/app/(app)/availability/open-shifts/page'

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

export function OpenShiftsList({ openShifts }: { openShifts: OpenShift[] }) {
  if (openShifts.length === 0) {
    return <p className="text-sm text-slate-500">No open shifts available for this block.</p>
  }
  return (
    <div className="space-y-2">
      {openShifts.map(s => <OpenShiftItem key={s.shiftId} shift={s} />)}
    </div>
  )
}

function OpenShiftItem({ shift }: { shift: OpenShift }) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(shift.alreadySignaled)
  const [error, setError] = useState<string | null>(null)

  function handleSignal() {
    if (shift.outsideAvailability) {
      setConfirming(true)
      return
    }
    doSubmit()
  }

  function doSubmit() {
    setConfirming(false)
    setError(null)
    startTransition(async () => {
      const result = await submitPrnInterest(shift.shiftId, shift.blockId, shift.outsideAvailability)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-3 rounded-md border border-slate-200 bg-white space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900">{fmtDate(shift.date)}</span>
        {shift.outsideAvailability && (
          <span className="text-xs text-amber-600 border border-amber-200 bg-amber-50 px-2 py-0.5 rounded">
            Outside availability
          </span>
        )}
      </div>

      {done ? (
        <p className="text-xs text-green-700">Interest signaled ✓</p>
      ) : confirming ? (
        <div className="space-y-2">
          <p className="text-xs text-amber-700">
            This date is outside your submitted availability. Signal interest anyway?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doSubmit}
              disabled={isPending}
              className="flex-1 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
            >
              Yes, signal interest
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="py-1.5 px-3 text-xs border border-slate-200 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSignal}
          disabled={isPending}
          className="w-full py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          {isPending ? 'Submitting…' : 'Signal Interest'}
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
