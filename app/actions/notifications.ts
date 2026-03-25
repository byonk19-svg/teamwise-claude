'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getServerUser } from '@/lib/auth'

/** Count of unread notifications for the current user. */
export async function getUnreadCount(): Promise<number> {
  const user = await getServerUser()
  if (!user) return 0
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
  return count ?? 0
}

export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  href: string | null
  read_at: string | null
  created_at: string
}

/** The 20 most recent notifications, newest first. */
export async function getNotifications(): Promise<NotificationRow[]> {
  const user = await getServerUser()
  if (!user) return []
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('notifications')
    .select('id, type, title, body, href, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data ?? []) as NotificationRow[]
}

export async function markRead(notificationId: string): Promise<void> {
  const user = await getServerUser()
  if (!user) return
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id)
}

export async function markAllRead(): Promise<void> {
  const user = await getServerUser()
  if (!user) return
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}

export async function subscribeToPush(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<void> {
  const user = await getServerUser()
  if (!user) return
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: 'endpoint' }
  )
}
