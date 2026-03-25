'use client'

import { useState, useEffect, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'
import { getNotifications, markRead, markAllRead, type NotificationRow } from '@/app/actions/notifications'

interface Props {
  open: boolean
  onClose: () => void
  onRead: () => void
}

export function NotificationPanel({ open, onClose, onRead }: Props) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getNotifications().then(data => {
      setNotifications(data)
      setLoading(false)
    })
  }, [open])

  async function handleMarkAll() {
    await markAllRead()
    setNotifications(prev => prev.map(n => ({ ...n, read_at: new Date().toISOString() })))
    onRead()
  }

  async function handleClick(n: NotificationRow) {
    if (!n.read_at) {
      await markRead(n.id)
      setNotifications(prev =>
        prev.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      )
      onRead()
    }
    if (n.href) {
      startTransition(() => {
        router.push(n.href!)
      })
      onClose()
    }
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-sm p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Notifications</SheetTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAll} className="text-xs text-slate-500">
                Mark all read
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-sm text-slate-400">Loading…</p>}
          {!loading && notifications.length === 0 && (
            <p className="p-4 text-sm text-slate-400">No notifications yet</p>
          )}
          {!loading &&
            notifications.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors
                ${!n.read_at ? 'bg-slate-50' : 'bg-white'}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                  <div className={!n.read_at ? '' : 'pl-4'}>
                    <p className="text-sm font-medium text-slate-800">{n.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </button>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
