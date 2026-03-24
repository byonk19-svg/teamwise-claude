// app/(app)/availability/[blockId]/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AvailabilityCalendar } from '@/components/availability/AvailabilityCalendar'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type EntryType = Database['public']['Tables']['availability_entries']['Row']['entry_type']

interface PageProps {
  params: { blockId: string }
}

export default async function AvailabilitySubmitPage({ params }: PageProps) {
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

  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('id', params.blockId)
    .single()
  const block = blockData as BlockRow | null
  if (!block) redirect('/availability')

  // Check if window is still open
  const now = new Date()
  const windowClosed = !block.availability_window_close ||
    new Date(block.availability_window_close) <= now

  // Load existing submission if any
  const { data: submissionData } = await supabase
    .from('availability_submissions')
    .select('id')
    .eq('schedule_block_id', block.id)
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null; error: unknown }

  const existing: Record<string, EntryType> = {}
  if (submissionData) {
    const { data: entriesData } = await supabase
      .from('availability_entries')
      .select('entry_date, entry_type')
      .eq('submission_id', submissionData.id) as { data: { entry_date: string; entry_type: string }[] | null; error: unknown }
    for (const e of (entriesData ?? [])) {
      existing[e.entry_date] = e.entry_type as EntryType
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {block.shift_type.charAt(0).toUpperCase() + block.shift_type.slice(1)} Shift Availability
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {format(new Date(block.start_date + 'T00:00:00'), 'MMMM d')} –{' '}
          {format(new Date(block.end_date + 'T00:00:00'), 'MMMM d, yyyy')}
        </p>
        {!windowClosed && block.availability_window_close && (
          <p className="text-xs text-slate-500 mt-0.5">
            Deadline: {new Date(block.availability_window_close).toLocaleString()}
          </p>
        )}
      </div>

      <AvailabilityCalendar
        blockId={block.id}
        startDate={block.start_date}
        employmentType={profile.employment_type}
        existing={existing}
        windowClosed={windowClosed}
      />
    </div>
  )
}
