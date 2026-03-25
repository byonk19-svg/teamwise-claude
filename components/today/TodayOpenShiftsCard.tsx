import Link from 'next/link'

interface Props {
  unsignaledCount: number
  prelimBlockId: string | null
}

export function TodayOpenShiftsCard({ unsignaledCount, prelimBlockId }: Props) {
  const href = prelimBlockId
    ? `/availability/open-shifts?blockId=${prelimBlockId}`
    : '/schedule'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">Open Shifts</span>
        {unsignaledCount > 0 && (
          <span className="text-xs font-semibold bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
            {unsignaledCount} available
          </span>
        )}
      </div>
      {unsignaledCount === 0 ? (
        <p className="text-sm text-slate-400">No open shifts right now</p>
      ) : (
        <p className="text-sm text-slate-600">
          {unsignaledCount} shift{unsignaledCount !== 1 ? 's' : ''} available to signal interest
        </p>
      )}
      <Link
        href={href}
        className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700"
      >
        View open shifts
      </Link>
    </div>
  )
}
