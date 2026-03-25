// lib/notifications/push.ts
import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

let vapidConfigured = false

function ensureVapid(): boolean {
  if (vapidConfigured) return true
  const subject = process.env.VAPID_SUBJECT
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!subject || !pub || !priv) {
    console.warn('[sendPush] Missing VAPID env — push skipped')
    return false
  }
  webpush.setVapidDetails(subject, pub, priv)
  vapidConfigured = true
  return true
}

export interface PushPayload {
  title: string
  body: string
  href?: string
}

/**
 * Sends a push notification to all registered devices for a user.
 * Expired subscriptions (410 Gone) are deleted.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return

  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await (supabase as any)
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId) as {
    data: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> | null
  }

  if (!subs?.length) return

  const json = JSON.stringify(payload)
  await Promise.all(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json
        )
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('[sendPush] delivery failed', { userId, endpoint: sub.endpoint, err })
        }
      }
    })
  )
}

export async function sendPushToMany(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map(uid => sendPush(uid, payload)))
}
