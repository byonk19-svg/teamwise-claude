// components/coverage/CoverageHeatmap.tsx
'use client'
import { useMemo } from 'react'
import { format, addDays } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type HeadcountRow = Database['public']['Views']['shift_planned_headcount']['Row']

interface Props {
  headcount: HeadcountRow[]
  leadGapDates: Set<string>
  blockStartDate: string
}

function cellBg(total: number): string {
  if (total < 3) return 'bg-red-100 text-red-800'
  if (total === 3) return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}

export function CoverageHeatmap({ headcount, leadGapDates, blockStartDate }: Props) {
  const dates = useMemo(() => {
    const start = new Date(blockStartDate + 'T00:00:00')
    return Array.from({ length: 42 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
  }, [blockStartDate])

  const byDate = useMemo(() => {
    const m = new Map<string, HeadcountRow>()
    for (const row of headcount) m.set(row.shift_date, row)
    return m
  }, [headcount])

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-max text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-2 text-left text-slate-500 font-medium w-16">Date</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">FT</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">PRN</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">Total</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">Lead</th>
          </tr>
        </thead>
        <tbody>
          {dates.map(date => {
            const row = byDate.get(date)
            const total = row?.total_count ?? 0
            const hasLeadGap = leadGapDates.has(date)
            const hasWorking = total > 0

            return (
              <tr key={date} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  {format(new Date(date + 'T00:00:00'), 'EEE d MMM')}
                </td>
                <td className="px-2 py-1.5 text-center text-slate-600">{row?.ft_count ?? 0}</td>
                <td className="px-2 py-1.5 text-center text-slate-600">{row?.prn_count ?? 0}</td>
                <td className={`px-2 py-1.5 text-center font-semibold rounded ${hasWorking ? cellBg(total) : 'text-slate-400'}`}>
                  {total}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {hasWorking ? (
                    hasLeadGap ? (
                      <span className="w-2 h-2 rounded-full bg-pink-400 inline-block" title="No lead assigned" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" title="Lead assigned" />
                    )
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
