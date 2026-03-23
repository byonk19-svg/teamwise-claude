// components/schedule/BlockPicker.tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

export function blockLabel(startDate: string, endDate: string, status: string): string {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const statusLabel = status.replace(/_/g, ' ')
  return `${fmt(start)} – ${fmt(end)} (${statusLabel})`
}

interface Props {
  blocks: BlockRow[]
  currentBlockId: string
  currentShift: 'day' | 'night'
}

export function BlockPicker({ blocks, currentBlockId, currentShift }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleBlockChange(blockId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('blockId', blockId)
    router.push(`/schedule?${params.toString()}`)
  }

  function handleShiftChange(shift: 'day' | 'night') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('shift', shift)
    // Find first block of this shift type
    const match = blocks.find(b => b.shift_type === shift)
    if (match) params.set('blockId', match.id)
    router.push(`/schedule?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Shift toggle */}
      <div className="flex rounded-md border border-slate-200 overflow-hidden">
        {(['day', 'night'] as const).map(s => (
          <button
            key={s}
            onClick={() => handleShiftChange(s)}
            className={[
              'px-3 py-1.5 text-sm font-medium transition-colors',
              currentShift === s
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            ].join(' ')}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Block selector */}
      <select
        value={currentBlockId}
        onChange={e => handleBlockChange(e.target.value)}
        className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        {blocks
          .filter(b => b.shift_type === currentShift)
          .map(b => (
            <option key={b.id} value={b.id}>
              {blockLabel(b.start_date, b.end_date, b.status)}
            </option>
          ))
        }
      </select>
    </div>
  )
}
