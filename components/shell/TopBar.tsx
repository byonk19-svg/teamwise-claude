// components/shell/TopBar.tsx
'use client'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { signOut } from '@/lib/auth'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  user: Pick<UserRow, 'full_name' | 'role'>
}

export function TopBar({ user }: Props) {
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
      <div className="flex-1" />
      <span className="text-sm font-medium text-slate-700">{user.full_name}</span>
      <Badge variant={user.role === 'manager' ? 'default' : 'secondary'}>
        {user.role === 'manager' ? 'Manager' : 'Therapist'}
      </Badge>
      {/* Notification dot — wired in Phase 3 */}
      <div className="w-2 h-2 rounded-full bg-transparent" aria-hidden />
      <button
        onClick={handleSignOut}
        className="text-sm text-slate-500 hover:text-slate-700 ml-2"
      >
        Sign out
      </button>
    </header>
  )
}
