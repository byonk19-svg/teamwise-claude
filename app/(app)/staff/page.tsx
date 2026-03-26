// app/(app)/staff/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { StaffTable } from '@/components/staff/StaffTable'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

export default async function StaffPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/today')
  if (!profile.department_id) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Your account is not assigned to a department. Contact your administrator.
      </div>
    )
  }

  const { data: therapists } = await supabase
    .from('users')
    .select('id, full_name, employment_type, is_lead_qualified, default_shift_type')
    .eq('department_id', profile.department_id)
    .eq('role', 'therapist')
    .order('full_name') as {
      data: Pick<
        UserRow,
        'id' | 'full_name' | 'employment_type' | 'is_lead_qualified' | 'default_shift_type'
      >[] | null
      error: unknown
    }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Staff</h1>
      <StaffTable therapists={therapists ?? []} />
    </div>
  )
}
