import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface ChangeRequest {
  id: string
  schedule_block_id: string
  requester_id: string
  shift_id: string
  request_type: 'move_shift' | 'mark_off' | 'other'
  note: string | null
  status: 'pending' | 'accepted' | 'rejected'
  response_note: string | null
  created_at: string
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  move_shift: 'Move Shift',
  mark_off: 'Mark Off',
  other: 'Other',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  accepted: 'default',
  rejected: 'destructive',
}

export default async function ChangeRequestsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const profile = profileData as Pick<UserRow, 'role'> | null
  if (!profile) redirect('/login')
  if (profile.role === 'manager') redirect('/schedule')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: requestsData } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*')
    .eq('requester_id', user.id)
    .order('created_at', { ascending: false })

  const requests = (requestsData ?? []) as ChangeRequest[]

  if (requests.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">Change Requests</h1>
        <p className="text-slate-500 text-sm">No change requests yet.</p>
      </div>
    )
  }

  const blockIds = Array.from(new Set(requests.map((r) => r.schedule_block_id)))
  const shiftIds = Array.from(new Set(requests.map((r) => r.shift_id)))

  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date')
    .in('id', blockIds)

  const { data: shiftsData } = await supabase.from('shifts').select('id, shift_date').in('id', shiftIds)

  const blocks = (blocksData ?? []) as Pick<BlockRow, 'id' | 'shift_type' | 'start_date' | 'end_date'>[]
  const shifts = (shiftsData ?? []) as Pick<ShiftRow, 'id' | 'shift_date'>[]
  const blockMap = new Map(blocks.map((b) => [b.id, b]))
  const shiftMap = new Map(shifts.map((s) => [s.id, s]))

  const byBlock = new Map<string, ChangeRequest[]>()
  for (const req of requests) {
    const group = byBlock.get(req.schedule_block_id) ?? []
    group.push(req)
    byBlock.set(req.schedule_block_id, group)
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Change Requests</h1>

      <div className="space-y-8">
        {Array.from(byBlock.entries()).map(([blockId, blockRequests]) => {
          const block = blockMap.get(blockId)
          const blockLabel = block
            ? `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`
            : 'Unknown Block'

          return (
            <div key={blockId}>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">{blockLabel}</h2>
              <div className="space-y-3">
                {blockRequests.map((req) => {
                  const shift = shiftMap.get(req.shift_id)
                  const shiftDate = shift
                    ? format(new Date(shift.shift_date + 'T00:00:00'), 'EEEE, MMMM d')
                    : 'Unknown date'

                  return (
                    <div key={req.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{shiftDate}</span>
                        <Badge variant={STATUS_VARIANTS[req.status] ?? 'secondary'}>
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500">
                        Type: {REQUEST_TYPE_LABELS[req.request_type] ?? req.request_type}
                      </p>
                      {req.note && (
                        <p className="text-sm text-slate-700">
                          <span className="font-medium">Your note:</span> {req.note}
                        </p>
                      )}
                      {req.response_note && (
                        <p className="text-sm text-slate-700">
                          <span className="font-medium">Manager response:</span> {req.response_note}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
