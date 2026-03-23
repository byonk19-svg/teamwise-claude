// app/(app)/availability/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export default async function AvailabilityPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()
  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')
  if (!profile.department_id) {
    return <p className="p-8 text-slate-500 text-sm">Not assigned to a department.</p>
  }

  // Fetch blocks with open availability windows
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .not('availability_window_open', 'is', null)
    .order('start_date', { ascending: false })

  const blocks = (blocksData ?? []) as BlockRow[]
  const now = new Date()

  const openBlocks = blocks.filter(b =>
    b.availability_window_close && new Date(b.availability_window_close) > now
  )
  const closedBlocks = blocks.filter(b =>
    b.availability_window_close && new Date(b.availability_window_close) <= now
  )

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Availability Submission</h1>

      {openBlocks.length === 0 && closedBlocks.length === 0 && (
        <p className="text-slate-500 text-sm">No availability windows open at this time.</p>
      )}

      {openBlocks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Open Windows</h2>
          <ul className="space-y-2">
            {openBlocks.map(b => (
              <li key={b.id}>
                <Link
                  href={`/availability/${b.id}`}
                  className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-400 bg-white"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800 capitalize">
                      {b.shift_type} Shift —{' '}
                      {format(new Date(b.start_date + 'T00:00:00'), 'MMM d')} to{' '}
                      {format(new Date(b.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deadline: {b.availability_window_close
                        ? new Date(b.availability_window_close).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                    Open →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closedBlocks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 mb-3">Past Windows</h2>
          <ul className="space-y-2">
            {closedBlocks.map(b => (
              <li key={b.id}>
                <Link
                  href={`/availability/${b.id}`}
                  className="flex items-center justify-between p-4 border border-slate-100 rounded-lg bg-slate-50 hover:bg-white"
                >
                  <p className="text-sm text-slate-500 capitalize">
                    {b.shift_type} Shift —{' '}
                    {format(new Date(b.start_date + 'T00:00:00'), 'MMM d')} to{' '}
                    {format(new Date(b.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                  </p>
                  <span className="text-xs text-slate-400">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
