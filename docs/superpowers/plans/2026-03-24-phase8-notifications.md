# Phase 8 — Notifications Implementation Plan

> **Implementation status:** **Shipped** in this repo. The sections below are the original plan; treat them as historical detail.
>
> **Corrections vs the plan text:**
> - Post-response work uses **`runAfterResponse`** in `lib/server/deferred-work.ts`, not `unstable_after` / `experimental.after` (Next 14.2.x here does not use that pattern).
> - **PWA push:** source lives in **`worker/index.js`**; `@ducanh2912/next-pwa` emits **`public/worker-*.js`** (listed in `.gitignore`). **Middleware** must exclude `worker-*`, `workbox-*`, `swe-worker-*`, `fallback-*`, and `sw.js` from the auth matcher so `importScripts` is not redirected to login.
> - Service-role client: **`lib/supabase/service-role.ts`** — also used for `subscribeToPush` and (Phase 9) staff invite/deactivate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent in-app, push, and email notifications so therapists and managers are alerted to swap requests, schedule changes, and resolution events without having to actively check the app.

**Architecture:** Notifications are written inline in existing server actions using a service-role Supabase client (bypasses RLS), then push and email are dispatched in the background via `unstable_after` (Next.js 14 experimental). In-app inbox lives in a `NotificationPanel` client component triggered from the TopBar bell. Push uses the `web-push` package + VAPID keys stored in env vars. Email uses Resend, firing only for `block_posted` events from `schedule@teamwise.work`.

**Tech Stack:** Next.js 14 `unstable_after` · `web-push` npm package · Resend · Supabase service-role client · shadcn/ui Sheet

---

## Codebase Conventions (read before implementing)

- **`(supabase as any)`** — Any table added manually to `lib/types/database.types.ts` but not in the generated Supabase client must be accessed via this cast. Both `notifications` and `push_subscriptions` are new manual tables — always cast.
- **`// eslint-disable-next-line @typescript-eslint/no-explicit-any`** — Must appear on the line immediately **before** the `(supabase as any)` cast line, not two lines above.
- **Service-role client** — Used only in `lib/notifications/create.ts` and `lib/notifications/push.ts` (for subscription lookup). Never in client components. Pattern from `supabase/seed.ts`: `createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })`.
- **`unstable_after`** — Import as `import { unstable_after as after } from 'next/server'`. Requires `experimental: { after: true }` in `next.config.js`. Runs callback after response is sent — use for push + email dispatch.
- **Server actions** — All in `app/actions/*.ts`. Call `createClient()` from `lib/supabase/server.ts` (anon, cookie-based). Notification creation uses the separate service-role client from `lib/supabase/service-role.ts`.
- **`schedule_blocks` update** — Always `(supabase as any).from('schedule_blocks').update(...)` — self-referential type issue.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| New | `supabase/migrations/006_phase8_notifications.sql` | `notifications` + `push_subscriptions` tables + RLS |
| New | `lib/supabase/service-role.ts` | Service-role Supabase client factory |
| New | `lib/notifications/payloads.ts` | Pure functions: build `{ title, body, href }` per event type |
| New | `lib/notifications/create.ts` | `createNotification(userId, type, title, body, href)` — DB insert via service-role |
| New | `lib/notifications/push.ts` | `sendPush(userId, payload)` — web-push delivery via VAPID |
| New | `lib/notifications/email.ts` | `sendBlockPostedEmail(recipients, block)` — Resend delivery |
| New | `app/actions/notifications.ts` | `getUnreadCount`, `getNotifications`, `markRead`, `markAllRead`, `subscribeToPush` |
| New | `components/shell/NotificationBell.tsx` | Client component: bell icon + unread badge, opens panel |
| New | `components/shell/NotificationPanel.tsx` | Client component: Sheet with notification list |
| New | `tests/unit/notification-payloads.test.ts` | Unit tests for payload pure functions |
| Modified | `next.config.js` | Enable `experimental.after` |
| Modified | `lib/types/database.types.ts` | Add `notifications` + `push_subscriptions` type stubs |
| Modified | `components/shell/TopBar.tsx` | Replace placeholder dot with `<NotificationBell>` |
| Modified | `app/actions/swap-requests.ts` | Wire `createNotification` + `after(sendPush)` into `submitSwap`, `resolveSwap` |
| Modified | `app/actions/change-requests.ts` | Wire into `resolveChangeRequest` |
| Modified | `app/actions/prn-interest.ts` | Wire into `resolvePrnInterest` |
| Modified | `app/actions/schedule.ts` | Wire into `postFinal`, `postPreliminary` + `after(sendBlockPostedEmail)` |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/006_phase8_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/006_phase8_notifications.sql

-- Notifications (persistent in-app inbox)
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null,
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread
  on notifications(user_id, created_at desc)
  where read_at is null;

alter table notifications enable row level security;

-- Users can only read and update their own notifications.
-- Inserts come from server actions using the service-role client — never from the browser.
create policy "users read own notifications"
  on notifications for select
  using (user_id = auth.uid());

create policy "users update own notifications"
  on notifications for update
  using (user_id = auth.uid());

-- Push subscriptions (one row per browser/device)
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on push_subscriptions for all
  using (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration**

```bash
# Apply via Supabase dashboard SQL editor, or CLI if configured:
# supabase db push
# Verify in dashboard: Tables → notifications and push_subscriptions exist with RLS enabled
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/006_phase8_notifications.sql
git commit -m "feat(notifications): add notifications and push_subscriptions tables (migration 006)"
```

---

## Task 2: TypeScript type stubs

**Files:**
- Modify: `lib/types/database.types.ts`

These tables are not in the generated Supabase client — add manual type stubs following the same pattern as `swap_requests` and `operational_entries` already in the file.

- [ ] **Step 1: Add type stubs at the bottom of the `Tables` object in `database.types.ts`**

Find the existing manual stubs block (search for `swap_requests` or `preliminary_change_requests`) and add after the last entry:

```ts
notifications: {
  Row: {
    id: string
    user_id: string
    type: string
    title: string
    body: string
    href: string | null
    read_at: string | null
    created_at: string
  }
  Insert: {
    id?: string
    user_id: string
    type: string
    title: string
    body: string
    href?: string | null
    read_at?: string | null
    created_at?: string
  }
  Update: Partial<{
    read_at: string | null
  }>
}
push_subscriptions: {
  Row: {
    id: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
    created_at: string
  }
  Insert: {
    id?: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
    created_at?: string
  }
  Update: never
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all existing tests pass (type-only change)

- [ ] **Step 3: Commit**

```bash
git add lib/types/database.types.ts
git commit -m "feat(notifications): add database type stubs for notifications and push_subscriptions"
```

---

## Task 3: Service-role client + notification payload helpers (TDD)

**Files:**
- Create: `lib/supabase/service-role.ts`
- Create: `lib/notifications/payloads.ts`
- Create: `tests/unit/notification-payloads.test.ts`

### 3a — Service-role client

- [ ] **Step 1: Create the service-role client factory**

```ts
// lib/supabase/service-role.ts
// NOTE: Only import this in server-only files (server actions, lib/notifications/*).
// Never import in client components or middleware.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

### 3b — Payload pure functions (TDD)

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/notification-payloads.test.ts
import { describe, it, expect } from 'vitest'
import {
  swapRequestedPayload,
  swapResolvedPayload,
  changeRequestResolvedPayload,
  prnInterestResolvedPayload,
  blockPostedPayload,
} from '@/lib/notifications/payloads'

describe('swapRequestedPayload', () => {
  it('builds title, body and href', () => {
    const p = swapRequestedPayload('Jane Smith', '2026-04-01')
    expect(p.title).toBe('New Swap Request')
    expect(p.body).toContain('Jane Smith')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/swaps')
  })
})

describe('swapResolvedPayload', () => {
  it('approved variant', () => {
    const p = swapResolvedPayload('approved', 'Jane Smith', '2026-04-01')
    expect(p.title).toBe('Swap Approved')
    expect(p.body).toContain('Jane Smith')
    expect(p.href).toBe('/swaps')
  })

  it('rejected variant', () => {
    const p = swapResolvedPayload('rejected', 'Jane Smith', '2026-04-01')
    expect(p.title).toBe('Swap Rejected')
  })
})

describe('changeRequestResolvedPayload', () => {
  it('approved variant', () => {
    const p = changeRequestResolvedPayload('approved', '2026-04-01')
    expect(p.title).toBe('Change Request Approved')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/schedule')
  })

  it('rejected variant', () => {
    const p = changeRequestResolvedPayload('rejected', '2026-04-01')
    expect(p.title).toBe('Change Request Rejected')
  })
})

describe('prnInterestResolvedPayload', () => {
  it('confirmed variant', () => {
    const p = prnInterestResolvedPayload('confirmed', '2026-04-01')
    expect(p.title).toBe('Shift Interest Confirmed')
    expect(p.href).toContain('/availability')
  })

  it('declined variant', () => {
    const p = prnInterestResolvedPayload('declined', '2026-04-01')
    expect(p.title).toBe('Shift Interest Declined')
  })
})

describe('blockPostedPayload', () => {
  it('final day shift', () => {
    const p = blockPostedPayload('day', '2026-04-01', '2026-05-12', 'final')
    expect(p.title).toBe('Final Schedule Posted')
    expect(p.body).toContain('Day')
    expect(p.body).toContain('2026-04-01')
    expect(p.href).toBe('/schedule')
  })

  it('preliminary night shift', () => {
    const p = blockPostedPayload('night', '2026-04-01', '2026-05-12', 'preliminary')
    expect(p.title).toBe('Preliminary Schedule Posted')
    expect(p.body).toContain('Night')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/unit/notification-payloads.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/notifications/payloads'`

- [ ] **Step 4: Implement the payload helpers**

```ts
// lib/notifications/payloads.ts

interface NotificationPayload {
  title: string
  body: string
  href: string
}

export function swapRequestedPayload(partnerName: string, shiftDate: string): NotificationPayload {
  return {
    title: 'New Swap Request',
    body: `${partnerName} has requested a shift swap with you on ${shiftDate}`,
    href: '/swaps',
  }
}

export function swapResolvedPayload(
  decision: 'approved' | 'rejected',
  partnerName: string,
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'approved' ? 'Swap Approved' : 'Swap Rejected',
    body: `Your swap with ${partnerName} on ${shiftDate} was ${decision}`,
    href: '/swaps',
  }
}

export function changeRequestResolvedPayload(
  decision: 'approved' | 'rejected',
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'approved' ? 'Change Request Approved' : 'Change Request Rejected',
    body: `Your change request for ${shiftDate} was ${decision}`,
    href: '/schedule',
  }
}

export function prnInterestResolvedPayload(
  decision: 'confirmed' | 'declined',
  shiftDate: string
): NotificationPayload {
  return {
    title: decision === 'confirmed' ? 'Shift Interest Confirmed' : 'Shift Interest Declined',
    body: `Your interest in the shift on ${shiftDate} was ${decision}`,
    href: '/availability/open-shifts',
  }
}

export function blockPostedPayload(
  shiftType: 'day' | 'night',
  startDate: string,
  endDate: string,
  status: 'final' | 'preliminary'
): NotificationPayload {
  const statusLabel = status === 'final' ? 'Final' : 'Preliminary'
  const typeLabel = shiftType === 'day' ? 'Day' : 'Night'
  return {
    title: `${statusLabel} Schedule Posted`,
    body: `${typeLabel} shift schedule for ${startDate}–${endDate} is now available`,
    href: '/schedule',
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/unit/notification-payloads.test.ts
```
Expected: all 9 tests PASS

- [ ] **Step 6: Run full suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/service-role.ts lib/notifications/payloads.ts tests/unit/notification-payloads.test.ts
git commit -m "feat(notifications): service-role client + payload helpers with tests"
```

---

## Task 4: Notification creation + push + email helpers

**Files:**
- Create: `lib/notifications/create.ts`
- Create: `lib/notifications/push.ts`
- Create: `lib/notifications/email.ts`

Install dependencies first:

- [ ] **Step 1: Install npm packages**

```bash
npm install web-push resend
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys
```

Copy the output into `.env.local`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<paste public key>
VAPID_PRIVATE_KEY=<paste private key>
VAPID_SUBJECT=mailto:schedule@teamwise.work
RESEND_API_KEY=<paste from Resend dashboard>
```

Also add these to the Supabase/Vercel environment (production).

- [ ] **Step 3: Create notification creation helper**

```ts
// lib/notifications/create.ts
import { createServiceRoleClient } from '@/lib/supabase/service-role'

/**
 * Inserts a notification row for one user.
 * Uses the service-role client to bypass RLS — this runs server-side only.
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
 * Errors are logged individually — one failure does not abort others.
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
  const { error } = await (supabase as any)
    .from('notifications')
    .insert(rows)
  if (error) {
    console.error('[createNotificationForMany] failed', { count: userIds.length, type, error })
  }
}
```

- [ ] **Step 4: Create push delivery helper**

```ts
// lib/notifications/push.ts
import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

interface PushPayload {
  title: string
  body: string
  href?: string
}

/**
 * Sends a push notification to all registered devices for a user.
 * Expired subscriptions (410 Gone) are deleted automatically.
 * All errors are caught and logged — push failure never throws.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await (supabase as any)
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId) as { data: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> | null }

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
          // Subscription expired — clean it up
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('[sendPush] delivery failed', { userId, endpoint: sub.endpoint, err })
        }
      }
    })
  )
}

/**
 * Sends push to multiple users in parallel.
 */
export async function sendPushToMany(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map(uid => sendPush(uid, payload)))
}
```

- [ ] **Step 5: Create email delivery helper**

```ts
// lib/notifications/email.ts
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

interface BlockEmailRecipient {
  email: string
  full_name: string | null
}

interface BlockInfo {
  shift_type: 'day' | 'night'
  start_date: string
  end_date: string
  status: string
}

/**
 * Sends a plain-text email to all dept members when a block is posted.
 * Fires for both 'final' and 'preliminary' block_posted events.
 * Errors are caught and logged — email failure never throws.
 */
export async function sendBlockPostedEmail(
  recipients: BlockEmailRecipient[],
  block: BlockInfo
): Promise<void> {
  if (!recipients.length) return

  const statusLabel = block.status === 'final' ? 'Final' : 'Preliminary'
  const typeLabel = block.shift_type === 'day' ? 'Day' : 'Night'
  const subject = `${statusLabel} ${typeLabel} Schedule Posted — ${block.start_date} to ${block.end_date}`
  const text = [
    `Your ${typeLabel.toLowerCase()} shift schedule (${block.start_date} to ${block.end_date}) has been posted as ${statusLabel.toLowerCase()}.`,
    '',
    'Log in to Teamwise to view your schedule:',
    'https://teamwise.work/schedule',
  ].join('\n')

  try {
    await resend.emails.send({
      from: 'Teamwise Schedule <schedule@teamwise.work>',
      to: recipients.map(r => r.email),
      subject,
      text,
    })
  } catch (err) {
    console.error('[sendBlockPostedEmail] failed', { count: recipients.length, err })
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npm test
```
Expected: all tests pass (new helpers have no unit tests — covered by payload tests in Task 3)

- [ ] **Step 7: Commit**

```bash
git add lib/notifications/create.ts lib/notifications/push.ts lib/notifications/email.ts
git commit -m "feat(notifications): add createNotification, sendPush, sendBlockPostedEmail helpers"
```

---

## Task 5: Enable `after()` + notification server actions

**Files:**
- Modify: `next.config.js`
- Create: `app/actions/notifications.ts`

- [ ] **Step 1: Enable experimental after in next.config.js**

Open `next.config.js` and add `after: true` to the `experimental` object. If no `experimental` key exists, add it:

```js
// next.config.js  (CommonJS — no ESM)
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing config ...
  experimental: {
    after: true,
  },
}

module.exports = nextConfig
```

- [ ] **Step 2: Create notification server actions**

```ts
// app/actions/notifications.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getServerUser } from '@/lib/auth'

/** Returns count of unread notifications for the current user. */
export async function getUnreadCount(): Promise<number> {
  const user = await getServerUser()
  if (!user) return 0
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null) as { count: number | null }
  return count ?? 0
}

/** Returns the 20 most recent notifications for the current user, newest first. */
export async function getNotifications(): Promise<Array<{
  id: string; type: string; title: string; body: string; href: string | null; read_at: string | null; created_at: string
}>> {
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
  return data ?? []
}

/** Marks a single notification as read. */
export async function markRead(notificationId: string): Promise<void> {
  const user = await getServerUser()
  if (!user) return
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id)  // RLS guard — only own rows
}

/** Marks all unread notifications as read for the current user. */
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

/** Saves a browser push subscription for the current user. */
export async function subscribeToPush(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<void> {
  const user = await getServerUser()
  if (!user) return
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      { onConflict: 'endpoint' }
    )
}
```

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add next.config.js app/actions/notifications.ts
git commit -m "feat(notifications): enable after(), add notification server actions"
```

---

## Task 6: In-app inbox UI

**Files:**
- Create: `components/shell/NotificationBell.tsx`
- Create: `components/shell/NotificationPanel.tsx`
- Modify: `components/shell/TopBar.tsx`

- [ ] **Step 1: Create NotificationPanel**

```tsx
// components/shell/NotificationPanel.tsx
'use client'
import { useState, useEffect, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'
import { getNotifications, markRead, markAllRead } from '@/app/actions/notifications'

type Notification = {
  id: string
  type: string
  title: string
  body: string
  href: string | null
  read_at: string | null
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  onRead: () => void   // callback to refresh unread count in bell
}

export function NotificationPanel({ open, onClose, onRead }: Props) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
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

  async function handleClick(n: Notification) {
    if (!n.read_at) {
      await markRead(n.id)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      onRead()
    }
    if (n.href) {
      startTransition(() => { router.push(n.href!) })
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
          {loading && (
            <p className="p-4 text-sm text-slate-400">Loading…</p>
          )}
          {!loading && notifications.length === 0 && (
            <p className="p-4 text-sm text-slate-400">No notifications yet</p>
          )}
          {!loading && notifications.map(n => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors
                ${!n.read_at ? 'bg-slate-50' : 'bg-white'}`}
            >
              <div className="flex items-start gap-2">
                {!n.read_at && (
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                )}
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
```

- [ ] **Step 2: Create NotificationBell**

```tsx
// components/shell/NotificationBell.tsx
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
```

- [ ] **Step 3: Wire NotificationBell into TopBar**

Replace the placeholder notification dot in `components/shell/TopBar.tsx`:

```tsx
// Add import at top:
import { NotificationBell } from './NotificationBell'

// Replace this line:
{/* Notification dot — wired in Phase 3 */}
<div className="w-2 h-2 rounded-full bg-transparent" aria-hidden />

// With:
<NotificationBell />
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add components/shell/NotificationBell.tsx components/shell/NotificationPanel.tsx components/shell/TopBar.tsx
git commit -m "feat(notifications): add NotificationBell and NotificationPanel UI"
```

---

## Task 7: Push permission UI

**Files:**
- Create: `components/notifications/PushPermissionToggle.tsx`
- Modify: `app/(app)/today/page.tsx` — render toggle for therapists

The push permission toggle is opt-in only. It lives on the `/today` page for therapists. Managers can be given a similar toggle later.

- [ ] **Step 1: Create PushPermissionToggle**

```tsx
// components/notifications/PushPermissionToggle.tsx
'use client'
import { useState, useEffect } from 'react'
import { subscribeToPush } from '@/app/actions/notifications'

export function PushPermissionToggle() {
  const [status, setStatus] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('unsupported')
    } else {
      setStatus(Notification.permission as 'default' | 'granted' | 'denied')
    }
  }, [])

  async function handleEnable() {
    const permission = await Notification.requestPermission()
    setStatus(permission)
    if (permission !== 'granted') return

    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    })
    await subscribeToPush({
      endpoint: sub.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))),
      },
    })
  }

  if (status === 'unsupported') return null
  if (status === 'denied') {
    return (
      <p className="text-xs text-slate-400">
        Push notifications blocked in browser settings
      </p>
    )
  }
  if (status === 'granted') {
    return (
      <p className="text-xs text-green-600">Push notifications enabled</p>
    )
  }

  return (
    <button
      onClick={handleEnable}
      className="text-xs text-blue-600 underline hover:text-blue-800"
    >
      Enable push notifications
    </button>
  )
}
```

- [ ] **Step 2: Add toggle to /today page**

At the bottom of the layout div in `app/(app)/today/page.tsx`, import and add the toggle:

```tsx
// Add import at top:
import { PushPermissionToggle } from '@/components/notifications/PushPermissionToggle'

// Add at the bottom of the return, after the grid:
<div className="pt-2">
  <PushPermissionToggle />
</div>
```

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add components/notifications/PushPermissionToggle.tsx app/\(app\)/today/page.tsx
git commit -m "feat(notifications): add opt-in push permission toggle on /today"
```

---

## Task 8: Wire notification triggers into existing server actions

This task modifies five existing server action files. Each gets two additions:
1. `createNotification(...)` call after the primary mutation succeeds
2. `after(() => sendPush(...))` for background push delivery

**Pattern to follow in each file:**

```ts
// At top of file, add imports:
import { unstable_after as after } from 'next/server'
import { createNotification } from '@/lib/notifications/create'
import { sendPush } from '@/lib/notifications/push'
import { swapRequestedPayload } from '@/lib/notifications/payloads'
// (import the relevant payload function for this action)
```

### 8a — submitSwap (notify partner)

**File:** `app/actions/swap-requests.ts` — `submitSwap` function

After the swap row is successfully inserted (after the `.insert(...)` call that creates the swap request):

```ts
// After successful swap insert:
const payload = swapRequestedPayload(
  reqShift.user_name ?? 'A colleague',   // requester's name — fetch from profile or pass as param
  reqShift.shift_date
)
await createNotification(partnerUserId, 'swap_requested', payload.title, payload.body, payload.href)
after(() => sendPush(partnerUserId, payload))
```

**Note:** `partnerUserId` is derived from `partnerShift.user_id` — already fetched in the action. The requester's name requires fetching the requester's `full_name` from `users`. Add this query alongside the existing shift validations:

```ts
const { data: requesterProfile } = await supabase
  .from('users')
  .select('full_name')
  .eq('id', user.id)
  .single() as { data: { full_name: string | null } | null; error: unknown }
const requesterName = requesterProfile?.full_name ?? 'A colleague'
```

### 8b — resolveSwap (notify requester)

**File:** `app/actions/swap-requests.ts` — `resolveSwap` function

`swap_requests` has no `shift_date` column (codebase gotcha #16). The shift date must be fetched separately via `requester_shift_id → shifts.shift_date`. This fetch must happen **before** the `if (decision === 'approved')` branch so it is available for both approved and rejected paths.

Add this query early in `resolveSwap`, alongside the existing `profile` fetch and before any branching:

```ts
// Fetch the shift date for the notification (swap_requests has no shift_date column)
const { data: reqShiftForNotif } = await supabase
  .from('shifts')
  .select('shift_date')
  .eq('id', swapRow.requester_shift_id)
  .single() as { data: { shift_date: string } | null; error: unknown }
const notifShiftDate = reqShiftForNotif?.shift_date ?? 'your shift'
```

Then after the swap `status` is updated to `approved` or `rejected` (at the end of the function, after the mutation):

```ts
const payload = swapResolvedPayload(decision, profile?.full_name ?? 'Manager', notifShiftDate)
await createNotification(swapRow.requester_id, 'swap_resolved', payload.title, payload.body, payload.href)
after(() => sendPush(swapRow.requester_id, payload))
```

**Note:** `profile?.full_name` is the manager's name from the existing `profile` fetch in this action.

### 8c — resolveChangeRequest (notify therapist)

**File:** `app/actions/change-requests.ts` — `resolveChangeRequest` function

After the change request is resolved:

```ts
const payload = changeRequestResolvedPayload(decision, changeRequest.shift_date)
await createNotification(changeRequest.user_id, 'change_request_resolved', payload.title, payload.body, payload.href)
after(() => sendPush(changeRequest.user_id, payload))
```

### 8d — resolvePrnInterest (notify PRN therapist)

**File:** `app/actions/prn-interest.ts` — `resolvePrnInterest` function

After the interest is resolved:

```ts
const payload = prnInterestResolvedPayload(decision, interest.shift_date)
await createNotification(interest.user_id, 'prn_interest_resolved', payload.title, payload.body, payload.href)
after(() => sendPush(interest.user_id, payload))
```

### 8e — postFinal + postPreliminary (notify all dept members + email)

**File:** `app/actions/schedule.ts` — `postFinal` and `postPreliminary` functions

Both functions already know `department_id` and have access to the block. After the block status is updated:

```ts
// Fetch all dept users (therapists + managers) for fan-out
const { data: deptUsers } = await supabase
  .from('users')
  .select('id, email, full_name')
  .eq('department_id', deptId) as { data: Array<{ id: string; email: string; full_name: string | null }> | null }

const userIds = Array.from(new Set((deptUsers ?? []).map(u => u.id)))
const statusValue = (block.status === 'final' ? 'final' : 'preliminary') as 'final' | 'preliminary'
const payload = blockPostedPayload(block.shift_type as 'day' | 'night', block.start_date, block.end_date, statusValue)

await createNotificationForMany(userIds, 'block_posted', payload.title, payload.body, payload.href)
after(async () => {
  await sendPushToMany(userIds, payload)
  await sendBlockPostedEmail(deptUsers ?? [], { ...block, status: block.status })
})
```

**Note:** `deptId` is already fetched in both actions. Add the `deptUsers` query alongside existing queries. Import `createNotificationForMany` from `lib/notifications/create` and `sendPushToMany` + `sendBlockPostedEmail` from their respective files.

- [ ] **Step 1: Add imports to all 3 action files**

Add to `app/actions/swap-requests.ts`, `app/actions/change-requests.ts`, `app/actions/prn-interest.ts`, `app/actions/schedule.ts`:

```ts
import { unstable_after as after } from 'next/server'
import { createNotification, createNotificationForMany } from '@/lib/notifications/create'
import { sendPush, sendPushToMany } from '@/lib/notifications/push'
import { sendBlockPostedEmail } from '@/lib/notifications/email'
import {
  swapRequestedPayload,
  swapResolvedPayload,
  changeRequestResolvedPayload,
  prnInterestResolvedPayload,
  blockPostedPayload,
} from '@/lib/notifications/payloads'
```
(Each file only needs the payload functions it uses — trim the import list per file.)

- [ ] **Step 2: Wire into submitSwap**

Find the `submitSwap` success path (after the swap row is inserted) and add notification + push per section 8a above.

- [ ] **Step 3: Wire into resolveSwap**

Find the `resolveSwap` success path and add per section 8b.

- [ ] **Step 4: Wire into resolveChangeRequest**

Find the `resolveChangeRequest` success path and add per section 8c.

- [ ] **Step 5: Wire into resolvePrnInterest**

Find the `resolvePrnInterest` success path and add per section 8d.

- [ ] **Step 6: Wire into postFinal and postPreliminary**

Find both functions in `app/actions/schedule.ts` and add per section 8e.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```
Expected: all tests pass. If TypeScript errors appear, run:
```bash
npm run build
```
and fix any type errors before proceeding.

- [ ] **Step 8: Commit**

```bash
git add app/actions/swap-requests.ts app/actions/change-requests.ts app/actions/prn-interest.ts app/actions/schedule.ts
git commit -m "feat(notifications): wire notification + push triggers into all 5 server actions"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all tests pass (previous count + 9 new payload tests)

- [ ] **Step 2: Lint check**

```bash
npm run lint
```
Expected: no errors. Common issues to watch for:
- `eslint-disable-next-line` comment not on the immediately preceding line of the `(supabase as any)` cast
- Missing `unstable_after` import in action files

- [ ] **Step 3: Build check**

```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Smoke-test manually (dev server)**

```bash
npm run dev
```

As therapist (`jsmith@teamwise.dev`):
1. Log in → `/today` shows push toggle
2. Click "Enable push notifications" → browser asks permission → toggle shows "enabled"
3. TopBar bell is visible with no badge initially

As manager (`manager@teamwise.dev`):
4. TopBar bell is visible
5. Post a preliminary or final block → therapists receive in-app notification (check DB: `select * from notifications`)
6. Bell badge count updates when therapist visits any page
7. Click bell → panel opens with the block_posted notification
8. Click notification → navigates to `/schedule`, notification marked read
9. Badge count drops to 0

- [ ] **Step 5: Final commit (cleanup if needed)**

```bash
git add -p
git commit -m "fix(notifications): address any build/lint feedback"
```

---

## Edge Cases Summary

| Scenario | Handled In |
|----------|-----------|
| Push permission denied | `PushPermissionToggle` shows "Blocked" message |
| Push subscription expired (410) | `sendPush` deletes the row, continues silently |
| User has multiple devices | `sendPushToMany` pushes to all `push_subscriptions` rows |
| Email delivery fails | `sendBlockPostedEmail` catches error, logs, does not throw |
| `block_posted` fan-out (15–20 users) | `createNotificationForMany` batch insert + `sendPushToMany` in `after()` |
| Notification for self (e.g. manager who is also listed as dept member) | Included in fan-out — acceptable |
| No VAPID env vars in dev | `web-push` will throw on `setVapidDetails` — set dummy values in `.env.local` |
| `RESEND_API_KEY` missing | Resend client creation fails silently at send time — log error, app continues |

---

## New Environment Variables

Add to `.env.local` and production environment:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=   # from: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=              # from: npx web-push generate-vapid-keys
VAPID_SUBJECT=mailto:schedule@teamwise.work
RESEND_API_KEY=                 # from: Resend dashboard → API Keys
```
