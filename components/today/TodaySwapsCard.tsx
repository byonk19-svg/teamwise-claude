import Link from 'next/link'

export interface TodaySwapSummary {
  id: string
  requester_id: string
  partner_id: string
  expires_at: string
  requester_shift_date: string
}

interface Props {
  swaps: TodaySwapSummary[]
  currentUserId: string
  therapistNames: Map<string, string>
}

export function TodaySwapsCard({ swaps, currentUserId, therapistNames }: Props) {
  const count = swaps.length
  const first = swaps[0] ?? null
  const partnerName = first
    ? (therapistNames.get(
        first.requester_id === currentUserId
          ? first.partner_id
          : first.requester_id
      ) ?? 'Unknown')
    : null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">Swap Requests</span>
        {count > 0 && (
          <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {count} pending
          </span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-sm text-slate-400">No pending requests</p>
      ) : (
        <p className="text-sm text-slate-600">
          {partnerName} · {first!.requester_shift_date}
          {count > 1 && <span className="text-slate-400"> +{count - 1} more</span>}
        </p>
      )}
      <Link href="/swaps" className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700">
        View all swaps
      </Link>
    </div>
  )
}
