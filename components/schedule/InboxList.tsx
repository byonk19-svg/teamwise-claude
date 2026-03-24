// components/schedule/InboxList.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { resolveChangeRequest } from '@/app/actions/change-requests'
import { resolvePrnInterest } from '@/app/actions/prn-interest'
import type { ChangeReqWithContext, PrnInterestWithContext } from '@/app/(app)/schedule/inbox/page'
import type { Database } from '@/lib/types/database.types'

type ChangeReqType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']

const REQ_TYPE_LABELS: Record<ChangeReqType, string> = {
  move_shift: 'Move shift',
  mark_off:   'Mark off',
  other:      'Other',
}

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

interface Props {
  changeReqs: ChangeReqWithContext[]
  prnInterest: PrnInterestWithContext[]
}

export function InboxList({ changeReqs, prnInterest }: Props) {
  if (changeReqs.length === 0 && prnInterest.length === 0) {
    return <p className="text-sm text-slate-500">No pending requests.</p>
  }
  return (
    <div className="space-y-6">
      {changeReqs.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Change Requests ({changeReqs.length})
          </h2>
          <div className="space-y-2">
            {changeReqs.map(req => <ChangeReqItem key={req.id} req={req} />)}
          </div>
        </section>
      )}
      {prnInterest.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            PRN Interest ({prnInterest.length})
          </h2>
          <div className="space-y-2">
            {prnInterest.map(item => <PrnInterestItem key={item.id} item={item} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function ChangeReqItem({ req }: { req: ChangeReqWithContext }) {
  const [isPending, startTransition] = useTransition()
  const [responseNote, setResponseNote] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-500">Resolved.</div>
  )

  function handleResolve(decision: 'accepted' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const result = await resolveChangeRequest(req.id, decision, responseNote || null)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{req.requester.full_name}</p>
        <p className="text-xs text-slate-500">
          {fmtDate(req.shift.shift_date)} · {REQ_TYPE_LABELS[req.request_type]}
        </p>
        {req.note && (
          <p className="text-xs text-slate-600 mt-1 italic">&ldquo;{req.note}&rdquo;</p>
        )}
      </div>
      <input
        type="text"
        placeholder="Optional response note…"
        value={responseNote}
        onChange={e => setResponseNote(e.target.value)}
        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleResolve('accepted')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => handleResolve('rejected')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function PrnInterestItem({ item }: { item: PrnInterestWithContext }) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-500">Resolved.</div>
  )

  function handleResolve(decision: 'confirmed' | 'declined') {
    setError(null)
    startTransition(async () => {
      const result = await resolvePrnInterest(item.id, decision)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900">
          {item.user.full_name} <span className="font-normal text-slate-500">(PRN)</span>
        </p>
        <p className="text-xs text-slate-500">
          {fmtDate(item.shift.shift_date)} · Interested in working
          {item.outside_availability && (
            <span className="ml-1 text-amber-600">· Outside submitted availability</span>
          )}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleResolve('confirmed')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => handleResolve('declined')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
