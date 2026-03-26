export interface CoverageCSVRow {
  date: string
  shift_type: string
  planned_headcount: number
  actual_headcount: number | null
}

export function buildCoverageCSV(rows: CoverageCSVRow[], threshold: number): string {
  const header = 'date,shift_type,planned_headcount,actual_headcount,threshold,status'
  const lines = rows.map((r) => {
    const actual = r.actual_headcount
    const status = actual === null ? 'n/a' : actual >= threshold ? 'ok' : 'critical'
    return [r.date, r.shift_type, r.planned_headcount, actual ?? '', threshold, status].join(',')
  })
  return [header, ...lines].join('\n')
}
