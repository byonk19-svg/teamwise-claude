'use client'

import { useMemo, useState } from 'react'
import type { BlockHealthRow } from '@/lib/ops/block-health'

type SortKey = keyof Pick<
  BlockHealthRow,
  | 'shiftType'
  | 'startDate'
  | 'status'
  | 'leadGapDates'
  | 'pendingSwaps'
  | 'pendingChangeRequests'
  | 'pendingPrnInterest'
  | 'lowCoverageDates'
  | 'riskScore'
>

interface Props {
  rows: BlockHealthRow[]
  /** Current ops filters (shift/from/to) without `blockId`, for “Focus” links */
  opsFocusQueryStr: string
}

function cellClass(n: number, danger: boolean): string {
  if (n === 0) return 'text-slate-400'
  return danger ? 'font-semibold text-red-700' : 'font-medium text-slate-800'
}

export function OpsBlockHealthTable({ rows, opsFocusQueryStr }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('riskScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'riskScore' ? 'desc' : 'asc')
    }
  }

  const th = (key: SortKey, label: string) => (
    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">
      <button
        type="button"
        className="hover:text-slate-800 inline-flex items-center gap-0.5"
        onClick={() => toggle(key)}
      >
        {label}
        {sortKey === key ? (sortDir === 'asc' ? ' ^' : ' v') : ''}
      </button>
    </th>
  )

  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-800">Block health</h2>
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Block</th>
              {th('shiftType', 'Shift')}
              {th('status', 'Status')}
              {th('leadGapDates', 'Lead gaps')}
              {th('pendingSwaps', 'Swaps')}
              {th('pendingChangeRequests', 'Chg req')}
              {th('pendingPrnInterest', 'PRN')}
              {th('lowCoverageDates', 'Low cov')}
              {th('riskScore', 'Risk')}
              <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Open</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const label = `${r.shiftType} ${r.startDate} – ${r.endDate}`
              const focusHref = opsFocusQueryStr
                ? `/ops?${opsFocusQueryStr}&blockId=${r.blockId}`
                : `/ops?blockId=${r.blockId}`
              return (
                <tr key={r.blockId} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{label}</td>
                  <td className="px-3 py-2 capitalize text-slate-700">{r.shiftType}</td>
                  <td className="px-3 py-2 text-slate-600">{r.status}</td>
                  <td className={`px-3 py-2 tabular-nums ${cellClass(r.leadGapDates, r.leadGapDates > 0)}`}>
                    {r.leadGapDates}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${cellClass(r.pendingSwaps, r.pendingSwaps > 0)}`}>
                    {r.pendingSwaps}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${cellClass(r.pendingChangeRequests, r.pendingChangeRequests > 0)}`}>
                    {r.pendingChangeRequests}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${cellClass(r.pendingPrnInterest, r.pendingPrnInterest > 0)}`}>
                    {r.pendingPrnInterest}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${cellClass(r.lowCoverageDates, r.lowCoverageDates > 0)}`}>
                    {r.lowCoverageDates}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{r.riskScore}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a className="text-sky-700 hover:underline mr-2" href={`/schedule?blockId=${r.blockId}`}>
                      Schedule
                    </a>
                    <a className="text-sky-700 hover:underline" href={focusHref}>
                      Focus
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
