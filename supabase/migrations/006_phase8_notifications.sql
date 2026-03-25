-- Phase 8: notifications + push subscriptions

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
