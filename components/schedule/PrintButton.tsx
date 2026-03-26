'use client'

interface Props {
  label?: string
}

export function PrintButton({ label = 'Print Schedule' }: Props) {
  return (
    <button
      type="button"
      data-no-print
      onClick={() => window.print()}
      className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}
