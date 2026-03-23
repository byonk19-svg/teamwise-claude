// components/availability/SubmissionTracker.tsx
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type SubmissionRow = Database['public']['Tables']['availability_submissions']['Row']

interface Props {
  therapists: UserRow[]
  submissions: SubmissionRow[]
}

export function SubmissionTracker({ therapists, submissions }: Props) {
  const submittedIds = new Set(submissions.map(s => s.user_id))

  const submitted = therapists.filter(t => submittedIds.has(t.id))
  const notSubmitted = therapists.filter(t => !submittedIds.has(t.id))

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Availability Submissions</h3>
        <span className="text-xs text-slate-500">
          {submitted.length} / {therapists.length}
        </span>
      </div>

      {notSubmitted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-600 mb-1">Not yet submitted</p>
          <ul className="space-y-0.5">
            {notSubmitted.map(t => (
              <li key={t.id} className="text-xs text-slate-600">
                {t.full_name}{' '}
                <span className="text-slate-400 capitalize">
                  ({t.employment_type.replace('_', '-')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-green-600 mb-1">Submitted</p>
          <ul className="space-y-0.5">
            {submitted.map(t => (
              <li key={t.id} className="text-xs text-slate-500">{t.full_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
