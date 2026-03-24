// components/swaps/SwapInbox.tsx
'use client'
import { useState, useTransition } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { resolveSwap } from '@/app/actions/swap-requests'

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

type SwapItem = {
  id: string
  is_cross_shift: boolean
  expires_at: string
  request_note: string | null
  requester: { full_name: string }
  partner: { full_name: string }
  requester_shift: { shift_date: string }
  partner_shift: { shift_date: string }
  block: { shift_type: string; start_date: string }
}

export function SwapInbox({ swaps }: { swaps: SwapItem[] }) {
  return (
    <div className="space-y-3">
      {swaps.map(s => <SwapCard key={s.id} swap={s} />)}
    </div>
  )
}

function SwapCard({ swap }: { swap: SwapItem }) {
  const [isPending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handle(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const result = await resolveSwap(swap.id, decision, note || null)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  const expiresIn = formatDistanceToNow(new Date(swap.expires_at), { addSuffix: true })

  if (done) {
    return (
      <div className="p-3 rounded-md border border-slate-200 bg-slate-50">
        <p className="text-xs text-slate-500">Resolved.</p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {swap.requester.full_name} ↔ {swap.partner.full_name}
          </p>
          <p className="text-xs text-slate-500">
            {fmtDate(swap.requester_shift.shift_date)} ↔ {fmtDate(swap.partner_shift.shift_date)}
            {' '}· {swap.block.shift_type} shift
          </p>
        </div>
        <div className="text-right shrink-0">
          {swap.is_cross_shift && (
            <span className="text-xs text-amber-700 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded">
              Cross-shift
            </span>
          )}
          <p className="text-xs text-slate-400 mt-1">Expires {expiresIn}</p>
        </div>
      </div>

      {swap.request_note && (
        <p className="text-xs text-slate-600 italic">&ldquo;{swap.request_note}&rdquo;</p>
      )}

      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional response note…"
        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handle('approved')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => handle('rejected')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
