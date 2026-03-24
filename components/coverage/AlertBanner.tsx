'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/types/database.types'

type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

interface Props {
  blockId: string
  initialActualHeadcount: ActualHeadcountRow[]
  coverageThreshold?: number
}

export function AlertBanner({
  blockId,
  initialActualHeadcount,
  coverageThreshold = 3,
}: Props) {
  const [alertDate, setAlertDate] = useState<string | null>(null)

  useEffect(() => {
    const initialBelow = initialActualHeadcount.find(row => row.total_actual < coverageThreshold)
    if (initialBelow) setAlertDate(initialBelow.shift_date)
  }, [initialActualHeadcount, coverageThreshold])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`operational-entries-${blockId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'operational_entries',
          filter: `schedule_block_id=eq.${blockId}`,
        },
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (supabase as any)
            .from('shift_actual_headcount')
            .select('shift_date,total_actual')
            .eq('schedule_block_id', blockId) as {
              data: { shift_date: string; total_actual: number }[] | null
            }

          if (!data) return
          for (const row of data) {
            if (row.total_actual < coverageThreshold) {
              setAlertDate(row.shift_date)
              break
            }
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [blockId, coverageThreshold])

  if (!alertDate) return null

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
    >
      <span>
        Coverage alert: <strong>{alertDate}</strong> is below minimum ({coverageThreshold} therapists).
      </span>
      <button
        type="button"
        onClick={() => setAlertDate(null)}
        className="text-red-500 hover:text-red-700 shrink-0"
        aria-label="Dismiss alert"
      >
        x
      </button>
    </div>
  )
}
