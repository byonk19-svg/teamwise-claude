'use client'
import { useState, useTransition } from 'react'
import { enterCode, removeCode } from '@/app/actions/operational-entries'
import { isOperationalEntryAllowed } from '@/lib/schedule/operational-codes'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call',
  CI: 'Called In',
  CX: 'Called Out',
  LE: 'Left Early',
}
const CODES = ['OC', 'CI', 'CX', 'LE'] as const

interface Props {
  blockId: string
  shiftId: string
  shiftDate: string
  blockStart: string
  blockStatus: BlockStatus
  userRole: 'manager' | 'therapist'
  isUserLead: boolean
  currentUserId: string
  entries: OperationalEntry[]
  onUpdate: () => void
}

export function OperationalCodeEntry({
  blockId,
  shiftId,
  shiftDate,
  blockStart,
  blockStatus,
  userRole,
  isUserLead,
  currentUserId,
  entries,
  onUpdate,
}: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const canEnter = (userRole === 'manager' || isUserLead) &&
    isOperationalEntryAllowed(blockStatus, userRole, shiftDate, blockStart, today)

  if (!canEnter && entries.length === 0) return null

  function handleEnter(code: typeof CODES[number]) {
    setError(null)
    startTransition(async () => {
      const result = await enterCode(blockId, shiftId, code, note || null)
      if (result.error) {
        setError(result.error)
        return
      }

      setSuccess(true)
      setNote('')
      setTimeout(() => setSuccess(false), 2000)
      onUpdate()
    })
  }

  function handleRemove(entryId: string) {
    setError(null)
    startTransition(async () => {
      const result = await removeCode(entryId)
      if (result.error) {
        setError(result.error)
        return
      }
      onUpdate()
    })
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
      <span className="block text-sm font-medium text-slate-700">Operational Codes</span>

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((e) => {
            const canRemove = userRole === 'manager' || e.entered_by === currentUserId
            return (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="font-mono font-semibold text-slate-800">{e.entry_type}</span>
                <span className="text-slate-500 text-xs flex-1 mx-2 truncate">
                  {CODE_LABELS[e.entry_type]}{e.is_backfill ? ' (backfill)' : ''}{e.note ? ` - ${e.note}` : ''}
                </span>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemove(e.id)}
                    disabled={isPending}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0"
                    aria-label="Remove entry"
                  >
                    x
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEnter && (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note..."
            rows={2}
            disabled={isPending}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          />

          <div className="grid grid-cols-2 gap-2">
            {CODES.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => handleEnter(code)}
                disabled={isPending}
                style={{ minHeight: '44px' }}
                className="flex flex-col items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors px-2 py-1"
              >
                <span className="font-mono font-bold text-base leading-none">{code}</span>
                <span className="text-xs text-slate-500 leading-tight mt-0.5">{CODE_LABELS[code]}</span>
              </button>
            ))}
          </div>

          {success && <p className="text-xs text-green-700">Code entered.</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}
