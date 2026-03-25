import { format, formatDistanceToNow } from 'date-fns'

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

export type TherapistSwapItem = {
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

export function TherapistSwapQueue({ swaps }: { swaps: TherapistSwapItem[] }) {
  return (
    <div className="space-y-3">
      {swaps.map(swap => {
        const expiresIn = formatDistanceToNow(new Date(swap.expires_at), { addSuffix: true })
        return (
          <div key={swap.id} className="p-4 rounded-md border border-slate-200 bg-white space-y-2">
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
            <p className="text-xs text-slate-500">Awaiting manager approval.</p>
          </div>
        )
      })}
    </div>
  )
}
