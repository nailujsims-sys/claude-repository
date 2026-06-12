-- Mind Whiteboard — tasks table + Row Level Security.
-- Run this in your Supabase project (SQL Editor, or `supabase db push`).
-- Safe to run more than once.

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  category      text not null default 'Privat',   -- 'Privat' | 'Uni' | 'Arbeit'
  subcategory   text,                             -- for future use, nullable
  details       text,                             -- optional description
  due_date      date,                             -- nullable
  due_time      time,                             -- nullable
  due_type      text default 'day',               -- 'day' | 'week' | 'month'
  is_favorite   boolean not null default false,
  is_completed  boolean not null default false,
  is_deleted    boolean not null default false,
  completed_at  timestamptz,
  deleted_at    timestamptz,
  sort_order    integer not null default 0,       -- drag-and-drop ordering within group
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_user_sort_idx on public.tasks (user_id, sort_order);

-- ── Row Level Security: a user may only touch their own tasks ───────────────
alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
  for insert with check (auth.uid() = user_id);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() = user_id);

-- ── Keep updated_at fresh ───────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
