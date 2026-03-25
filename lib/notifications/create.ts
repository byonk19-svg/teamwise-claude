// lib/notifications/create.ts
import { createServiceRoleClient } from '@/lib/supabase/service-role'

/**
 * Inserts a notification row for one user.
 * Uses the service-role client to bypass RLS — server-side only.
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  href: string | null = null
): Promise<void> {
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('notifications')
    .insert({ user_id: userId, type, title, body, href })
  if (error) {
    console.error('[createNotification] failed', { userId, type, error })
  }
}

/**
 * Fan-out: inserts one notification per user in the array.
 */
export async function createNotificationForMany(
  userIds: string[],
  type: string,
  title: string,
  body: string,
  href: string | null = null
): Promise<void> {
  const supabase = createServiceRoleClient()
  const rows = userIds.map(uid => ({ user_id: uid, type, title, body, href }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('notifications').insert(rows)
  if (error) {
    console.error('[createNotificationForMany] failed', { count: userIds.length, type, error })
  }
}
