-- Mind Whiteboard — calendar events table + Row Level Security.
-- Run this in your Supabase project (SQL Editor, or `supabase db push`).
-- Safe to run more than once.

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,                              -- optional notes
  location      text,                              -- optional place
  -- Local wall-clock 'YYYY-MM-DDTHH:MM' strings; `timezone` carries the zone.
  start_at      text,
  end_at        text,
  all_day       boolean not null default false,
  recurrence    text,                              -- RRULE-style string | null
  reminder      integer,                           -- minutes before start | null
  is_birthday   boolean not null default false,
  timezone      text not null default 'Europe/Berlin',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists events_user_id_idx on public.events (user_id);
create index if not exists events_user_start_idx on public.events (user_id, start_at);

-- ── Row Level Security: a user may only touch their own events ───────────────
alter table public.events enable row level security;

drop policy if exists "events_select_own" on public.events;
create policy "events_select_own" on public.events
  for select using (auth.uid() = user_id);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert with check (auth.uid() = user_id);

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own" on public.events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own" on public.events
  for delete using (auth.uid() = user_id);

-- ── Keep updated_at fresh (reuses the trigger fn from the tasks migration) ───
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();
