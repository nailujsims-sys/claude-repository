-- Mind Whiteboard — calendar events. Follows the pattern in 0001_foundation.

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  location      text,
  -- Local wall-clock 'YYYY-MM-DDTHH:MM'; `timezone` carries the zone it was
  -- entered in. Text rather than timestamptz on purpose: a 09:00 lecture is
  -- 09:00 wherever the phone happens to be, and the fixed-width format sorts
  -- and compares chronologically as a string.
  start_at      text,
  end_at        text,
  all_day       boolean not null default false,
  recurrence    text,                              -- RRULE-style string | null
  reminder      integer,                           -- minutes before start
  is_birthday   boolean not null default false,
  timezone      text not null default 'Europe/Berlin',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_title_not_blank check (char_length(btrim(title)) > 0),
  -- The format is what makes the two comparisons below meaningful, so it is
  -- enforced rather than assumed.
  constraint events_start_format check (
    start_at is null or start_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
  ),
  constraint events_end_format check (
    end_at is null or end_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
  ),
  constraint events_end_after_start check (
    end_at is null or start_at is null or end_at >= start_at
  ),
  constraint events_reminder_positive check (reminder is null or reminder >= 0)
);

create index if not exists events_user_id_idx on public.events (user_id);
create index if not exists events_user_start_idx on public.events (user_id, start_at);

alter table public.events enable row level security;

drop policy if exists "events_select_own" on public.events;
create policy "events_select_own" on public.events
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own" on public.events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own" on public.events
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();
