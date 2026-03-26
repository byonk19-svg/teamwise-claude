'use client'

import { useState } from 'react'
import { exportStaffCSV } from '@/app/actions/staff'
import { downloadCSV } from '@/lib/exports/download-csv'

export function ExportStaffButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    const result = await exportStaffCSV()
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(`staff-roster-${date}.csv`, result.data)
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleExport}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
