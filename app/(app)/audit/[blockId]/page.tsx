import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AuditLog } from '@/components/audit/AuditLog'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface PageProps {
  params: { blockId: string }
}

export default async function AuditPage({ params }: PageProps) {
  const { blockId } = params
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .eq('id', blockId)
    .single() as {
      data: { id: string; shift_type: string; start_date: string; end_date: string; status: string } | null
      error: unknown
    }

  if (!blockData) redirect('/coverage')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entriesData } = await (supabase as any)
    .from('operational_entries')
    .select('*')
    .eq('schedule_block_id', blockId)
    .order('entry_date', { ascending: true })
    .order('entered_at', { ascending: true }) as { data: OperationalEntry[] | null; error: unknown }

  const entries = (entriesData ?? []) as OperationalEntry[]

  const { data: usersData } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('department_id', profile.department_id ?? '')
  const users = (usersData ?? []) as Pick<UserRow, 'id' | 'full_name'>[]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 capitalize">
            {blockData.shift_type} shift · {blockData.start_date} to {blockData.end_date}
          </p>
        </div>
        <Link
          href="/coverage"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          ← Coverage
        </Link>
      </div>

      <AuditLog entries={entries} users={users} blockInfo={blockData} />
    </div>
  )
}
