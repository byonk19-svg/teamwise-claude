// components/schedule/CellPanel.tsx
// Placeholder — full implementation in Task 9
'use client'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  open: boolean
  onClose: () => void
  shift: Shift | undefined
  date: string
  user: UserRow | undefined
}

export function CellPanel({ open, onClose, user, date }: Props) {
  if (!open || !user || !date) return null
  return (
    <div role="dialog" aria-label="Cell details" className="fixed inset-y-0 right-0 w-80 bg-white shadow-xl border-l border-slate-200 z-50 p-6">
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-slate-500 hover:text-slate-700">✕</button>
      <p className="font-semibold text-slate-900">{user.full_name}</p>
      <p className="text-sm text-slate-500">{date}</p>
    </div>
  )
}
