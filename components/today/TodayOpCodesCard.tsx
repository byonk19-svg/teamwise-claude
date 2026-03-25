import type { Database } from '@/lib/types/database.types'

type OpEntry = Database['public']['Tables']['operational_entries']['Row']

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call',
  CI: 'Called In',
  CX: 'Cancelled',
  LE: 'Left Early',
}

interface Props {
  entries: OpEntry[]
}

export function TodayOpCodesCard({ entries }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <span className="text-sm font-medium text-slate-700">Today&apos;s Codes</span>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No codes entered for today</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {entries.map(entry => (
            <li key={entry.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                {entry.entry_type}
              </span>
              <span className="text-slate-500">{CODE_LABELS[entry.entry_type] ?? entry.entry_type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
