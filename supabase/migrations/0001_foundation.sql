-- Mind Whiteboard — the foundation every personal table is built on.
--
-- Run order: 0001 → 0002 → 0003. Each file is idempotent, so re-running a
-- migration is safe and never destroys data.
--
-- THE PATTERN FOR EVERY FUTURE PERSONAL TABLE (Projekte, Gewohnheiten,
-- Notizen, Finanzen …). Copy it exactly; there is no second way to do this:
--
--   1. `id uuid primary key default gen_random_uuid()`
--   2. `user_id uuid not null references auth.users (id) on delete cascade`
--   3. `created_at` / `updated_at timestamptz not null default now()`
--   4. an index on `user_id` (and one on whatever the screen sorts by)
--   5. `alter table … enable row level security`
--   6. the four policies below — select / insert / update / delete, each
--      `(select auth.uid()) = user_id`
--   7. `revoke all … from anon` and grant only what `authenticated` needs
--   8. the `set_updated_at` trigger
--
-- A table without steps 5–7 is a data leak. There is no "we'll add RLS later".

-- ── Keeps updated_at honest, whatever the client sends ──────────────────────
-- Runs as the caller (no `security definer`): stamping a column the caller is
-- already updating needs no elevated rights, and a definer function is a
-- privilege to be justified, not a default. The empty search_path stops it
-- from resolving anything through a caller-controlled path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles: one row per account, created with the account ─────────────────
-- Personal data (the display name), so it lives under the same RLS rules as
-- everything else. It is deliberately thin: it exists so the app has a place
-- for per-user settings that is not auth.users, which the client cannot write.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone     text not null default 'Europe/Berlin',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_len check (
    display_name is null or char_length(display_name) between 1 and 80
  )
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The profile is created with the account, not by the client. `security
-- definer` because the trigger runs inside the signup transaction, which is
-- not the new user yet; the empty search_path keeps it from being tricked into
-- calling something else's `insert`.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already existed before this migration get their profile now.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;
