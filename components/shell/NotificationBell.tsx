'use client'

import { useState, useEffect, useCallback } from 'react'
import { BellIcon } from 'lucide-react'
import { NotificationPanel } from './NotificationPanel'
import { getUnreadCount } from '@/app/actions/notifications'

export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)

  const refreshCount = useCallback(async () => {
    const count = await getUnreadCount()
    setUnread(count)
  }, [])

  useEffect(() => {
    refreshCount()
  }, [refreshCount])

  return (
    <>
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="relative p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <NotificationPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onRead={refreshCount}
      />
    </>
  )
}
