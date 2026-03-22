// app/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import type { Database } from '@/lib/types/database.types'

type UserProfile = Pick<Database['public']['Tables']['users']['Row'], 'full_name' | 'role'>

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role')
    .eq('id', user.id)
    .single() as { data: UserProfile | null; error: unknown }

  if (!profile) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar role={profile.role} />
      <div className="flex flex-col flex-1 min-w-0 lg:pl-14 xl:pl-56">
        <TopBar user={profile} />
        <main className="flex-1 overflow-auto p-4">
          {children}
        </main>
      </div>
    </div>
  )
}
