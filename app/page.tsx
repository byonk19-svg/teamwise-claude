// app/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }

  if (profile?.role === 'manager') redirect('/schedule')
  redirect('/today')
}
