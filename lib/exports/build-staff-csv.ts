export interface StaffCSVRow {
  full_name: string | null
  email: string
  role: string
  employment_type: string | null
  is_lead_qualified: boolean
  is_active: boolean
  created_at: string
}

export function buildStaffCSV(users: StaffCSVRow[]): string {
  const header = 'full_name,email,role,employment_type,is_lead_qualified,is_active,created_at'
  const lines = users.map((u) =>
    [
      u.full_name ?? '',
      u.email,
      u.role,
      u.employment_type ?? '',
      u.is_lead_qualified,
      u.is_active,
      u.created_at,
    ].join(',')
  )
  return [header, ...lines].join('\n')
}
