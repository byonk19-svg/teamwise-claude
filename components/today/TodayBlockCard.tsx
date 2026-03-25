import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATUS_STYLES: Record<string, string> = {
  final: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  preliminary: 'bg-amber-100 text-amber-700',
  preliminary_draft: 'bg-amber-50 text-amber-800',
  completed: 'bg-slate-100 text-slate-600',
}

interface Props {
  block: BlockRow
}

export function TodayBlockCard({ block }: Props) {
  const badgeClass = STATUS_STYLES[block.status] ?? 'bg-slate-100 text-slate-600'
  const label = block.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-slate-700">Current Block</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {label}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        {block.start_date} – {block.end_date}
      </p>
      <Link href="/schedule" className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700">
        View schedule
      </Link>
    </div>
  )
}
