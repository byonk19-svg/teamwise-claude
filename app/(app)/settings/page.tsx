// app/(app)/settings/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CoverageThresholdsForm } from '@/components/settings/CoverageThresholdsForm'

const DEFAULT_THRESHOLDS = { minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 }

export default async function SettingsPage() {
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
        Your account is not assigned to a department.
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thresholds } = await (supabase as any)
    .from('coverage_thresholds')
    .select('shift_type, minimum_staff, ideal_staff, maximum_staff')
    .eq('department_id', profile.department_id) as {
      data: Array<{
        shift_type: 'day' | 'night'
        minimum_staff: number
        ideal_staff: number
        maximum_staff: number
      }> | null
    }

  const dayRow = thresholds?.find(t => t.shift_type === 'day') ?? DEFAULT_THRESHOLDS
  const nightRow = thresholds?.find(t => t.shift_type === 'night') ?? DEFAULT_THRESHOLDS

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Settings</h1>
      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-4">Coverage Thresholds</h2>
        <CoverageThresholdsForm day={dayRow} night={nightRow} />
      </section>
    </div>
  )
}
