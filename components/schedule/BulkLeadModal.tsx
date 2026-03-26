// components/schedule/BulkLeadModal.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { assignLead } from '@/app/actions/lead-assignment'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  blockId: string
  gapDates: string[]         // dates missing a lead
  leadQualified: UserRow[]   // all lead-qualified therapists
  onClose: () => void
  onComplete: () => void     // trigger revalidation in parent
}

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE MMM d')
}

export function BulkLeadModal({ blockId, gapDates, leadQualified, onClose, onComplete }: Props) {
  const [selectedLead, setSelectedLead] = useState<string>('')
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set(gapDates))
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggleDate(date: string) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function handleSubmit() {
    if (!selectedLead || selectedDates.size === 0) return
    setError(null)
    startTransition(async () => {
      const dates = Array.from(selectedDates)
      const results = await Promise.all(
        dates.map(d => assignLead(blockId, d, selectedLead))
      )
      const firstError = results.find(r => r.error)
      if (firstError?.error) {
        setError(firstError.error)
      } else {
        onComplete()
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-no-print>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Bulk Assign Lead</h2>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Lead to assign</label>
          <select
            value={selectedLead}
            onChange={e => setSelectedLead(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">— Select therapist —</option>
            {leadQualified.map(t => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">
            Dates to assign ({selectedDates.size} selected)
          </span>
          <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-200 rounded-md p-2">
            {gapDates.length === 0 ? (
              <p className="text-xs text-slate-400">No gap dates — all dates have a lead.</p>
            ) : (
              gapDates.map(d => (
                <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDates.has(d)}
                    onChange={() => toggleDate(d)}
                    className="accent-slate-900"
                  />
                  {fmtDate(d)}
                </label>
              ))
            )}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !selectedLead || selectedDates.size === 0}
            className="py-1.5 px-4 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Assigning…' : `Assign to ${selectedDates.size} date${selectedDates.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
