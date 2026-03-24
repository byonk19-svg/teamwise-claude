// components/schedule/ConstraintDiff.tsx
'use client'
import { useState } from 'react'
import { format } from 'date-fns'

export type DiffItem = {
  user_id: string
  full_name: string
  shift_date: string
  prior_cell_state: string
  avail_entry_type: string
}

export function groupDiffByUser(
  items: DiffItem[]
): Record<string, { name: string; dates: string[] }> {
  const result: Record<string, { name: string; dates: string[] }> = {}
  for (const item of items) {
    if (!result[item.user_id]) {
      result[item.user_id] = { name: item.full_name, dates: [] }
    }
    result[item.user_id].dates.push(item.shift_date)
  }
  return result
}

interface Props {
  diff: DiffItem[]
}

export function ConstraintDiff({ diff }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || diff.length === 0) return null

  const grouped = groupDiffByUser(diff)
  const users = Object.entries(grouped)

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-800">
            Availability Conflicts ({users.length} {users.length === 1 ? 'therapist' : 'therapists'})
          </h3>
          <p className="text-xs text-amber-700 mt-0.5">
            These FT therapists marked Cannot Work on dates they were scheduled as Working in the prior block.
            Review and adjust their rows.
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-700 text-xs font-medium shrink-0"
          aria-label="Dismiss conflict list"
        >
          Dismiss
        </button>
      </div>

      <ul className="space-y-2">
        {users.map(([userId, { name, dates }]) => (
          <li key={userId} className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
            <div>
              <span className="text-sm font-medium text-amber-900">{name}</span>
              <span className="text-xs text-amber-700 ml-2">
                {dates.length} conflict{dates.length > 1 ? 's' : ''}:
              </span>
              <span className="text-xs text-amber-600 ml-1">
                {dates
                  .sort()
                  .map(d => format(new Date(d + 'T00:00:00'), 'MMM d'))
                  .join(', ')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
