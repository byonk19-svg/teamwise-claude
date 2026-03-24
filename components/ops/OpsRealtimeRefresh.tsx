'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Max UUIDs per `in.(...)` filter to stay within realtime filter length limits */
const PRN_SHIFT_ID_CHUNK = 45

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size))
  }
  return out
}

interface Props {
  blockIds: string[]
  /** Shift ids for the current ops query (date-filtered); drives PRN subscriptions */
  shiftIds: string[]
}

/**
 * Subscribes to Postgres changes for ops-relevant tables and debounced `router.refresh()`.
 * Block-scoped tables use `schedule_block_id=eq.${blockId}`. PRN interest uses batched
 * `shift_id=in.(...)` filters aligned with the shifts currently loaded on the page.
 */
export function OpsRealtimeRefresh({ blockIds, shiftIds }: Props) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idsKey = [...blockIds].sort().join(',')
  const shiftIdsKey = [...shiftIds].sort().join(',')

  useEffect(() => {
    if (!idsKey) return

    const supabase = createClient()
    const scheduleRefresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        router.refresh()
      }, 350)
    }

    const shiftCount = shiftIdsKey ? shiftIdsKey.split(',').length : 0
    const channelName = `ops-refresh-${idsKey.slice(0, 60)}-s${shiftCount}`
    const channel = supabase.channel(channelName)

    const tables = [
      'operational_entries',
      'swap_requests',
      'preliminary_change_requests',
      'shifts',
    ] as const

    for (const blockId of idsKey.split(',')) {
      const filter = `schedule_block_id=eq.${blockId}`
      for (const table of tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter },
          scheduleRefresh
        )
      }
    }

    if (shiftIdsKey) {
      const prnShiftIds = shiftIdsKey.split(',')
      for (const chunk of chunkIds(prnShiftIds, PRN_SHIFT_ID_CHUNK)) {
        if (chunk.length === 0) continue
        const filter = `shift_id=in.(${chunk.join(',')})`
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'prn_shift_interest', filter },
          scheduleRefresh
        )
      }
    }

    channel.subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void supabase.removeChannel(channel)
    }
  }, [idsKey, shiftIdsKey, router])

  return null
}
