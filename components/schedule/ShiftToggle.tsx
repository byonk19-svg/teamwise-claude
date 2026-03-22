// components/schedule/ShiftToggle.tsx
'use client'
import { useState } from 'react'

interface Props {
  defaultShift: 'day' | 'night'
  onToggle: (shift: 'day' | 'night') => void
}

export function ShiftToggle({ defaultShift, onToggle }: Props) {
  const [active, setActive] = useState<'day' | 'night'>(defaultShift)

  function toggle(shift: 'day' | 'night') {
    setActive(shift)
    onToggle(shift)
  }

  return (
    <div className="flex rounded-lg border border-slate-200 p-0.5 bg-white w-fit">
      {(['day', 'night'] as const).map(s => (
        <button
          key={s}
          onClick={() => toggle(s)}
          className={
            active === s
              ? 'px-4 py-1.5 text-sm font-medium rounded-md bg-slate-900 text-white'
              : 'px-4 py-1.5 text-sm text-slate-600 hover:text-slate-900'
          }
        >
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  )
}
