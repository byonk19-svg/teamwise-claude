// app/(app)/schedule/new/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { BlockCreateForm } from '@/components/schedule/BlockCreateForm'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

export default async function NewBlockPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profileData } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single()
  const profile = profileData as Pick<UserRow, 'role' | 'department_id'> | null

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  return (
    <div className="max-w-lg mx-auto p-8">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Create New Block</h1>
      <BlockCreateForm />
    </div>
  )
}
