/* eslint-disable no-restricted-globals */
/**
 * Custom PWA worker chunk (imported by next-pwa into sw.js).
 * Shows system notifications for web-push payloads from lib/notifications/push.ts:
 * JSON: { title, body, href? }
 */

function parsePushPayload(event) {
  if (!event.data) {
    return { title: 'Teamwise', body: 'You have a new notification', href: '/' }
  }
  try {
    const json = event.data.json()
    return {
      title: typeof json.title === 'string' && json.title ? json.title : 'Teamwise',
      body: typeof json.body === 'string' ? json.body : '',
      href: typeof json.href === 'string' && json.href ? json.href : '/',
    }
  } catch {
    const text = event.data.text()
    return {
      title: 'Teamwise',
      body: text || 'You have a new notification',
      href: '/',
    }
  }
}

self.addEventListener('push', event => {
  const { title, body, href } = parsePushPayload(event)
  const options = {
    body,
    data: { href },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: href || 'teamwise',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

async function focusOrOpen(url) {
  const absolute = new URL(url, self.location.origin).href
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clientList) {
    if (!client.url.startsWith(self.location.origin)) continue
    if ('focus' in client) {
      await client.focus()
      if ('navigate' in client && typeof client.navigate === 'function') {
        try {
          await client.navigate(absolute)
          return
        } catch {
          /* fall through to openWindow */
        }
      }
    }
  }
  if (clients.openWindow) await clients.openWindow(absolute)
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const href = event.notification.data?.href || '/'
  event.waitUntil(focusOrOpen(href))
})
