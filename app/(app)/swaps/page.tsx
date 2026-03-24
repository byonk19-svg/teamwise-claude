// app/(app)/swaps/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { SwapInbox } from '@/components/swaps/SwapInbox'

export default async function SwapsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')
  if (!profile.department_id) redirect('/schedule')

  // All pending swap requests for this department's blocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swapsRaw } = await (supabase as any)
    .from('swap_requests')
    .select(`
      *,
      requester:requester_id(full_name),
      partner:partner_id(full_name),
      requester_shift:requester_shift_id(shift_date),
      partner_shift:partner_shift_id(shift_date),
      block:schedule_block_id(shift_type, start_date)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  type SwapItem = {
    id: string
    is_cross_shift: boolean
    expires_at: string
    request_note: string | null
    requester: { full_name: string }
    partner: { full_name: string }
    requester_shift: { shift_date: string }
    partner_shift: { shift_date: string }
    block: { shift_type: string; start_date: string }
  }

  const swaps = (swapsRaw ?? []) as SwapItem[]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Pending Swaps</h1>
      {swaps.length === 0 ? (
        <p className="text-sm text-slate-500">No pending swap requests.</p>
      ) : (
        <SwapInbox swaps={swaps} />
      )}
    </div>
  )
}
