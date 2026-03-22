// lib/schedule/cell-state.ts
import type { Database } from '@/lib/types/database.types'

type CellState = Database['public']['Tables']['shifts']['Row']['cell_state']

export function cellStateClass(state: CellState): string {
  switch (state) {
    case 'working':      return 'bg-[var(--shift-color)] text-white font-medium'
    case 'cannot_work':  return 'bg-slate-100 text-slate-400'
    case 'off':          return 'bg-transparent text-transparent'
    case 'fmla':         return 'bg-amber-50 text-amber-700 text-[10px] font-semibold'
    default: {
      const exhaustive: never = state
      throw new Error(`Unhandled cell state: ${exhaustive}`)
    }
  }
}

export function cellStateLabel(state: CellState): string {
  switch (state) {
    case 'working':     return '1'
    case 'cannot_work': return '*'
    case 'fmla':        return 'FMLA'
    case 'off':         return ''
    default: {
      const exhaustive: never = state
      throw new Error(`Unhandled cell state: ${exhaustive}`)
    }
  }
}
