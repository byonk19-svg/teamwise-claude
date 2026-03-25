// components/shell/Sidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/types/database.types'

type UserRole = Database['public']['Tables']['users']['Row']['role']

interface NavItem {
  href: string
  label: string
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/today',           label: 'Today',            roles: ['therapist'] },
  { href: '/schedule',        label: 'Schedule',         roles: ['manager', 'therapist'] },
  { href: '/availability',    label: 'Availability',     roles: ['manager', 'therapist'] },
  { href: '/swaps',           label: 'Swaps',            roles: ['manager', 'therapist'] },
  { href: '/coverage',        label: 'Coverage',         roles: ['manager'] },
  { href: '/ops',             label: 'Ops',              roles: ['manager'] },
  { href: '/staff',           label: 'Staff',            roles: ['manager'] },
  { href: '/settings',        label: 'Settings',         roles: ['manager'] },
  { href: '/open-shifts',     label: 'Open Shifts',      roles: ['therapist'] },
  { href: '/change-requests', label: 'Change Requests',  roles: ['therapist'] },
]

interface Props {
  role: UserRole
}

export function Sidebar({ role }: Props) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter(item => item.roles.includes(role))

  return (
    <aside className="
      hidden lg:flex fixed top-0 left-0 h-full z-20 bg-white border-r border-slate-200
      w-56 xl:w-56 lg:w-14 flex-col
    ">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-slate-200 shrink-0">
        <span className="font-bold text-slate-900 xl:block lg:hidden">Teamwise</span>
        <span className="font-bold text-slate-900 hidden lg:block xl:hidden">TW</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {items.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center h-10 px-4 text-sm gap-3 rounded-md mx-2 transition-colors',
                active
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <span className="xl:inline lg:hidden">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
