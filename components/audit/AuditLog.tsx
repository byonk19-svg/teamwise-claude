'use client'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']

interface Props {
  entries: OperationalEntry[]
  users: { id: string; full_name: string }[]
  blockInfo: { shift_type: string; start_date: string; end_date: string }
}

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call',
  CI: 'Called In',
  CX: 'Called Out',
  LE: 'Left Early',
}

export function AuditLog({ entries, users, blockInfo }: Props) {
  const userMap = new Map(users.map(u => [u.id, u.full_name]))

  function downloadCSV() {
    const headers = ['Date', 'Therapist', 'Code', 'Description', 'Entered By', 'Entered At', 'Backfill', 'Note', 'Removed', 'Removed At', 'Removed By']
    const rows = entries.map(e => [
      e.entry_date,
      userMap.get(e.user_id) ?? e.user_id,
      e.entry_type,
      CODE_LABELS[e.entry_type] ?? e.entry_type,
      userMap.get(e.entered_by) ?? e.entered_by,
      format(new Date(e.entered_at), 'yyyy-MM-dd HH:mm:ss'),
      e.is_backfill ? 'Yes' : 'No',
      e.note ?? '',
      e.removed_at ? 'Yes' : 'No',
      e.removed_at ? format(new Date(e.removed_at), 'yyyy-MM-dd HH:mm:ss') : '',
      e.removed_by ? (userMap.get(e.removed_by) ?? e.removed_by) : '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${blockInfo.shift_type}-${blockInfo.start_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-8 text-center">
        No operational codes were entered for this block.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={downloadCSV}
          className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-max text-xs w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th className="px-3 py-2 text-slate-500 font-medium">Date</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Therapist</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Code</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Entered By</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Entered At</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Backfill</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Note</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr
                key={e.id}
                className={`border-b border-slate-100 last:border-0 ${e.removed_at ? 'opacity-50 line-through' : ''}`}
              >
                <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                  {format(new Date(`${e.entry_date}T00:00:00`), 'EEE, MMM d')}
                </td>
                <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                  {userMap.get(e.user_id) ?? '-'}
                </td>
                <td className="px-3 py-1.5 font-mono font-semibold text-slate-800">
                  {e.entry_type}
                  <span className="ml-1 font-normal text-slate-400 font-sans">
                    {CODE_LABELS[e.entry_type]}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600">{userMap.get(e.entered_by) ?? '-'}</td>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                  {format(new Date(e.entered_at), 'MMM d, HH:mm')}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {e.is_backfill ? <span className="text-amber-600">✓</span> : null}
                </td>
                <td className="px-3 py-1.5 text-slate-500 max-w-[160px] truncate">{e.note ?? ''}</td>
                <td className="px-3 py-1.5">
                  {e.removed_at ? (
                    <span className="text-red-400">Removed</span>
                  ) : (
                    <span className="text-green-600">Active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
