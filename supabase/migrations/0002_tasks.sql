-- Mind Whiteboard — tasks. Follows the pattern documented in 0001_foundation.

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  category      text not null default 'Privat',   -- 'Privat' | 'Uni' | 'Arbeit'
  subcategory   text,                             -- free label under a category
  details       text,
  due_date      date,
  due_time      time,
  due_type      text not null default 'day',      -- 'day' | 'week' | 'month'
  is_favorite   boolean not null default false,
  is_completed  boolean not null default false,
  is_deleted    boolean not null default false,   -- Papierkorb: reversible
  completed_at  timestamptz,
  deleted_at    timestamptz,
  sort_order    integer not null default 0,       -- drag-and-drop order
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- An empty title is a row nobody can find again.
  constraint tasks_title_not_blank check (char_length(btrim(title)) > 0),
  -- `due_type` decides how the app reads `due_date` (that day / its week / its
  -- month), so an unknown value would silently land the task in the wrong
  -- section. `category` stays free text on purpose — new categories are a
  -- product decision, not a migration.
  constraint tasks_due_type_known check (due_type in ('day', 'week', 'month'))
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_user_sort_idx on public.tasks (user_id, sort_order);
-- The list groups by due date on every screen; the calendar asks per day.
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);

alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Both halves matter: `using` decides which rows may be touched, `with check`
-- stops a row from being handed to somebody else on the way out.
drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
