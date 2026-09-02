-- Mind Whiteboard — Google-Kalender-Integration.
--
-- Follows the pattern in 0001_foundation for every table that belongs to a
-- user, with one deliberate addition: a table the client may not touch at all.
--
-- THE SHAPE OF THIS FEATURE, in one paragraph. Google events are not a second
-- kind of event — they are rows in `public.events` carrying an external
-- identity (provider + calendar id + event id). The Google *tokens* never
-- reach a browser: they live in `google_credentials`, which has no grants for
-- `anon` or `authenticated` and no policies, so only the service role (the
-- Edge Functions) can read or write it. Everything the settings screen needs
-- to show — which account, which calendars, what state the sync is in — lives
-- in `google_connections` / `google_calendars`, which are readable by their
-- owner and writable only by the sync service.

-- ── The connection: one Google account per app account ──────────────────────
-- Readable by its owner (the settings screen renders it), written by the sync
-- service. Nothing secret is in here.
create table if not exists public.google_connections (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  google_account_email text,
  google_account_sub   text,                    -- Google's stable user id
  -- 'connected'      — tokens are good, sync runs
  -- 'needs_reauth'   — the refresh token was rejected; the user must reconnect
  -- 'error'          — the last run failed for another reason (see last_error)
  status              text not null default 'connected',
  scopes              text,
  last_error          text,
  last_sync_at        timestamptz,
  last_sync_status    text,                     -- 'ok' | 'partial' | 'failed'
  default_calendar_id text,                     -- google calendar id for new events
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint google_connections_status_known
    check (status in ('connected', 'needs_reauth', 'error'))
);

alter table public.google_connections enable row level security;

-- Select only. Every write goes through an Edge Function, which means the
-- client can never invent a connection, point one at another account, or
-- silently mark a broken sync as healthy.
drop policy if exists "google_connections_select_own" on public.google_connections;
create policy "google_connections_select_own" on public.google_connections
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.google_connections from anon;
revoke all on public.google_connections from authenticated;
grant select on public.google_connections to authenticated;

drop trigger if exists google_connections_set_updated_at on public.google_connections;
create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function public.set_updated_at();

-- ── The credentials: the one table no client may read ───────────────────────
-- RLS is on and there is not a single policy, plus every privilege is revoked
-- from both client roles. Two independent locks: even a policy added by
-- accident later would still find no grant behind it. `service_role` bypasses
-- RLS by design, and it is the only role that has business here.
create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  token_type    text,
  scopes        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_credentials enable row level security;
alter table public.google_credentials force row level security;

revoke all on public.google_credentials from anon;
revoke all on public.google_credentials from authenticated;
revoke all on public.google_credentials from public;

drop trigger if exists google_credentials_set_updated_at on public.google_credentials;
create trigger google_credentials_set_updated_at
  before update on public.google_credentials
  for each row execute function public.set_updated_at();

-- ── The calendars Google offers, and what we do with each ───────────────────
-- `access_role` is Google's word, not ours: 'owner' and 'writer' may be written
-- to, 'reader' and 'freeBusyReader' may not. A holiday calendar is read-only
-- because Google says `reader`, never because of what it is called.
create table if not exists public.google_calendars (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  google_calendar_id  text not null,
  summary             text,
  description         text,
  time_zone           text,
  background_color    text,                     -- '#rrggbb', taken from Google
  foreground_color    text,
  access_role         text,                     -- owner|writer|reader|freeBusyReader
  is_primary          boolean not null default false,
  -- 'normal' | 'birthday' | 'holiday'. Derived from Google's own ids
  -- (#contacts@group.v.calendar.google.com, #holiday@group.v.calendar.google.com),
  -- and it decides *how* a change is written back — a birthday lives in
  -- Google Contacts, not in the calendar.
  kind                text not null default 'normal',
  is_selected         boolean not null default false,
  -- Google's per-calendar default reminder, in minutes. An event that says
  -- `reminders.useDefault` carries no number of its own — this is the number
  -- it means, so "30 Minuten vorher" survives the trip in both directions.
  default_reminder_minutes integer,
  -- Google's incremental cursor. Present means the next run only asks for what
  -- changed; null forces the full window (2 years back, everything ahead).
  sync_token          text,
  is_available        boolean not null default true,   -- false: gone from Google
  last_synced_at      timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint google_calendars_kind_known check (kind in ('normal', 'birthday', 'holiday')),
  constraint google_calendars_unique unique (user_id, google_calendar_id)
);

create index if not exists google_calendars_user_idx on public.google_calendars (user_id);
create index if not exists google_calendars_user_selected_idx
  on public.google_calendars (user_id, is_selected);

alter table public.google_calendars enable row level security;

drop policy if exists "google_calendars_select_own" on public.google_calendars;
create policy "google_calendars_select_own" on public.google_calendars
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.google_calendars from anon;
revoke all on public.google_calendars from authenticated;
grant select on public.google_calendars to authenticated;

drop trigger if exists google_calendars_set_updated_at on public.google_calendars;
create trigger google_calendars_set_updated_at
  before update on public.google_calendars
  for each row execute function public.set_updated_at();

-- ── Google push channels ────────────────────────────────────────────────────
-- One per watched calendar. `token` is the shared secret Google echoes back in
-- the X-Goog-Channel-Token header, which is how the public webhook knows a
-- delivery is genuine — so this table is service-role only, like the tokens.
create table if not exists public.google_channels (
  id                 text primary key,          -- the channel id we generated
  user_id            uuid not null references auth.users (id) on delete cascade,
  google_calendar_id text not null,
  resource_id        text,                      -- Google's handle, needed to stop it
  token              text not null,
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists google_channels_user_idx on public.google_channels (user_id);

alter table public.google_channels enable row level security;
alter table public.google_channels force row level security;
revoke all on public.google_channels from anon;
revoke all on public.google_channels from authenticated;
revoke all on public.google_channels from public;

-- ── events: the same rows, now with an external identity ────────────────────
-- No second event model. A Google event is an `events` row that additionally
-- knows where it came from; an app-only event is one where these are null.
alter table public.events
  add column if not exists google_calendar_id text,
  add column if not exists google_event_id text,
  add column if not exists google_recurring_event_id text,
  -- Birthday events are generated by Google *Contacts*; editing one means
  -- writing to People API, and this is the contact it belongs to.
  add column if not exists google_contact_id text,
  add column if not exists google_etag text,
  -- Google's own `updated` timestamp for the version we hold. The conflict
  -- rule ("the most recent change wins") compares it against `updated_at`.
  add column if not exists google_updated_at timestamptz,
  add column if not exists sync_enabled boolean not null default true,
  -- 'local'   — app-only, never leaves the app
  -- 'pending' — changed here, still owed to Google
  -- 'synced'  — both sides agree
  -- 'error'   — the last push failed; last_sync_error says why
  add column if not exists sync_state text not null default 'local',
  add column if not exists sync_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_sync_state_known'
  ) then
    alter table public.events add constraint events_sync_state_known
      check (sync_state in ('local', 'pending', 'synced', 'error'));
  end if;
end
$$;

-- The duplicate guard, and the reason a reconnect or a repeated import cannot
-- produce a second copy: one Google event is one row, for this user, forever.
create unique index if not exists events_google_identity_idx
  on public.events (user_id, google_calendar_id, google_event_id)
  where google_event_id is not null;

create index if not exists events_sync_pending_idx
  on public.events (user_id, sync_state)
  where sync_state = 'pending';

-- ── Echo control: who changed the row decides what happens next ─────────────
-- The sync service writes as `service_role`; a device writes as
-- `authenticated`. Only the second kind of write owes Google anything — that
-- single distinction is what stops the loop "Google → app → Google → app".
create or replace function public.events_mark_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A write by the sync service *is* the Google state. Marking it pending
  -- would send it straight back and start the echo.
  if current_user = 'service_role' then
    return new;
  end if;

  if new.sync_enabled is not true or new.google_calendar_id is null then
    -- App-only event: it has no business in Google, now or later.
    if tg_op = 'INSERT' then new.sync_state := 'local'; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.sync_state := 'pending';
    return new;
  end if;

  -- Only a change the user can see is worth a round trip.
  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.location is distinct from old.location
     or new.start_at is distinct from old.start_at
     or new.end_at is distinct from old.end_at
     or new.all_day is distinct from old.all_day
     or new.recurrence is distinct from old.recurrence
     or new.reminder is distinct from old.reminder
     or new.is_birthday is distinct from old.is_birthday
     or new.timezone is distinct from old.timezone
     or new.google_calendar_id is distinct from old.google_calendar_id
     or (new.sync_enabled and not old.sync_enabled)
  then
    new.sync_state := 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists events_mark_pending on public.events;
create trigger events_mark_pending
  before insert or update on public.events
  for each row execute function public.events_mark_pending();

-- ── Deletes have to survive the row ─────────────────────────────────────────
-- The calendar deletes for real (there is no trash), so by the time the sync
-- service runs, the row that knew its Google id is gone. The tombstone is that
-- knowledge, kept exactly long enough to delete the event in Google too.
--
-- A delete performed by the sync service is Google's own delete arriving here;
-- pushing it back would be the echo again, so it leaves no tombstone.
create table if not exists public.google_event_tombstones (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  google_calendar_id text not null,
  google_event_id    text not null,
  attempts           integer not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  constraint google_event_tombstones_unique
    unique (user_id, google_calendar_id, google_event_id)
);

create index if not exists google_event_tombstones_user_idx
  on public.google_event_tombstones (user_id);

alter table public.google_event_tombstones enable row level security;
alter table public.google_event_tombstones force row level security;
revoke all on public.google_event_tombstones from anon;
revoke all on public.google_event_tombstones from authenticated;
revoke all on public.google_event_tombstones from public;

-- `security definer` because the client role has no rights on the tombstone
-- table — deliberately: it may cause a tombstone by deleting its own event,
-- but it may not write one directly. The empty search_path pins every name.
create or replace function public.events_leave_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return old;
  end if;
  if old.google_event_id is not null
     and old.google_calendar_id is not null
     and old.sync_enabled is true
  then
    insert into public.google_event_tombstones (user_id, google_calendar_id, google_event_id)
    values (old.user_id, old.google_calendar_id, old.google_event_id)
    on conflict (user_id, google_calendar_id, google_event_id) do nothing;
  end if;
  return old;
end;
$$;

-- ── Taking one event back out of Google ─────────────────────────────────────
-- The sync switch in the Termin-Dialog is per event, so it has to work on an
-- event that is *already* in Google: switching it off means "this appointment
-- lives only in the app from now on". Just clearing the flag would leave the
-- Google copy in place, and the next pull would import it again as a second,
-- separate event — the duplicate §14 exists to prevent.
--
-- So the Google copy is retired the same way a delete retires one: a tombstone
-- for the sync service to act on, and the row keeps every field the user ever
-- typed. Moving an event to a different calendar takes the same route — Google
-- has no "same event, other calendar" for our purposes, so it is a delete over
-- there and a create in the new one, which the cleared `google_event_id` makes
-- the push do by itself.
--
-- Runs before `events_mark_pending` (trigger order is by name, and 'd' sorts
-- before 'm'), so the pending flag is decided on the state this leaves behind.
create or replace function public.events_detach_from_google()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if old.google_event_id is null or old.google_calendar_id is null then
    return new;
  end if;

  if new.sync_enabled is not true
     or new.google_calendar_id is distinct from old.google_calendar_id
  then
    insert into public.google_event_tombstones (user_id, google_calendar_id, google_event_id)
    values (old.user_id, old.google_calendar_id, old.google_event_id)
    on conflict (user_id, google_calendar_id, google_event_id) do nothing;

    new.google_event_id := null;
    new.google_recurring_event_id := null;
    new.google_contact_id := null;
    new.google_etag := null;
    new.google_updated_at := null;
    new.sync_error := null;
    if new.sync_enabled is not true then
      new.sync_state := 'local';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists events_detach_from_google on public.events;
create trigger events_detach_from_google
  before update on public.events
  for each row execute function public.events_detach_from_google();

drop trigger if exists events_leave_tombstone on public.events;
create trigger events_leave_tombstone
  after delete on public.events
  for each row execute function public.events_leave_tombstone();

-- ── What the sync service may touch ─────────────────────────────────────────
-- `service_role` is the identity of the Edge Functions and of nothing else:
-- its key lives in the function environment, never in a bundle. This project
-- grants it no DML by default (check `has_table_privilege` — `tasks` and
-- `events` show the same), so the rights it actually needs are listed here,
-- table by table, instead of being assumed.
--
-- It bypasses RLS (`rolbypassrls`), which is the point: the sync service acts
-- for whichever user a run belongs to, and every function resolves that user
-- from a verified JWT or a signed OAuth state before it touches a row.
grant select, insert, update, delete on public.google_connections      to service_role;
grant select, insert, update, delete on public.google_credentials      to service_role;
grant select, insert, update, delete on public.google_calendars        to service_role;
grant select, insert, update, delete on public.google_channels         to service_role;
grant select, insert, update, delete on public.google_event_tombstones to service_role;
-- The events themselves: a Google change becomes a row here, and that is the
-- whole Google → App half of the sync.
grant select, insert, update, delete on public.events to service_role;
-- Read-only, and only for one column: `profiles.timezone` decides which
-- wall-clock time a Google instant is written as.
grant select on public.profiles to service_role;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- The settings screen is live for the same reason the calendar is: a sync that
-- finishes on the phone should show up on the Mac without a reload. Only the
-- two harmless tables are published — the credentials, the channels and the
-- tombstones are never broadcast anywhere.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'google_connections'
  ) then
    alter publication supabase_realtime add table public.google_connections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'google_calendars'
  ) then
    alter publication supabase_realtime add table public.google_calendars;
  end if;
end
$$;
