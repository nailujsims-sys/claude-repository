-- Mind Whiteboard — Listen. Follows the pattern documented in 0001_foundation
-- exactly: own id, owner, timestamps, indexes, RLS, grants, updated_at trigger.
--
-- Two tables, because a list and its entries have different lifetimes: a list
-- is renamed, pinned and archived, an entry is ticked off and reordered many
-- times in between. `list_items.list_id` cascades, so deleting a list takes its
-- entries with it and never leaves orphans behind.
--
-- WHY THE TEMPLATE-SPECIFIC FIELDS ARE COLUMNS AND NOT JSON
-- There are three templates and between them four optional fields. Columns give
-- the database something to check (`list_items_amount_positive`), the client one
-- shape to read, and `pickWritable` one whitelist to enforce — all of which a
-- `jsonb` blob would move into hand-written client validation for no gain at
-- this size. A fourth template adds a column or reuses one; it does not need a
-- different storage model. See src/data/listDefaults.js for the writable set.

-- ── lists ───────────────────────────────────────────────────────────────────
create table if not exists public.lists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  -- The three templates the app knows. Constrained rather than free text: the
  -- template decides which fields a row shows and how a new entry is read, so
  -- an unknown value would render a list nobody can use. Adding a fourth is a
  -- one-line migration — deliberately a decision, not an accident.
  template     text not null default 'standard',
  -- A key into the curated set in src/config/listIcons.js, not a component
  -- name and not an image. An unknown key falls back to the template's own
  -- icon, so a removed icon never renders an empty box.
  icon         text not null default 'clipboard-list',
  is_pinned    boolean not null default false,
  -- Archiving is what "Liste abschließen" does: reversible, and the reason a
  -- finished list does not have to be deleted.
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A list without a name is a row nobody can find again.
  constraint lists_name_not_blank check (char_length(btrim(name)) > 0),
  constraint lists_name_len check (char_length(name) <= 120),
  constraint lists_template_known check (template in ('standard', 'shopping', 'money')),
  constraint lists_icon_len check (char_length(btrim(icon)) between 1 and 40)
);

create index if not exists lists_user_id_idx on public.lists (user_id);
-- The overview reads pinned-first, then by sort order; the archive reads the
-- same rows with the flag flipped.
create index if not exists lists_user_sort_idx
  on public.lists (user_id, is_archived, is_pinned, sort_order);

alter table public.lists enable row level security;

drop policy if exists "lists_select_own" on public.lists;
create policy "lists_select_own" on public.lists
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "lists_insert_own" on public.lists;
create policy "lists_insert_own" on public.lists
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Both halves matter: `using` decides which rows may be touched, `with check`
-- stops a row from being handed to somebody else on the way out.
drop policy if exists "lists_update_own" on public.lists;
create policy "lists_update_own" on public.lists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "lists_delete_own" on public.lists;
create policy "lists_delete_own" on public.lists
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.lists from anon;
grant select, insert, update, delete on public.lists to authenticated;

drop trigger if exists lists_set_updated_at on public.lists;
create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

-- ── list_items ──────────────────────────────────────────────────────────────
create table if not exists public.list_items (
  id           uuid primary key default gen_random_uuid(),
  -- Denormalised on purpose, and it is not a convenience: RLS evaluates one
  -- comparison instead of a sub-select against `lists`, and Realtime can filter
  -- server-side on `user_id=eq.…` the way it already does for tasks and events
  -- (a filter can only name a column of the row it is filtering).
  user_id      uuid not null references auth.users (id) on delete cascade,
  list_id      uuid not null references public.lists (id) on delete cascade,
  title        text not null,
  is_done      boolean not null default false,
  done_at      timestamptz,
  sort_order   integer not null default 0,
  -- Template-specific and all optional. `quantity`/`unit` are the Einkauf
  -- fields ("6 Stück", "500 g"), `amount` the Geld one, `category` the optional
  -- Einkauf grouping. A standard list writes none of them.
  quantity     numeric(12, 3),
  unit         text,
  amount       numeric(12, 2),
  category     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint list_items_title_not_blank check (char_length(btrim(title)) > 0),
  constraint list_items_title_len check (char_length(title) <= 200),
  constraint list_items_unit_len check (unit is null or char_length(unit) <= 20),
  constraint list_items_category_len check (category is null or char_length(category) <= 40),
  -- A negative quantity or a negative open amount is not a state the UI can
  -- produce and not one it could display sensibly.
  constraint list_items_quantity_positive check (quantity is null or quantity >= 0),
  constraint list_items_amount_positive check (amount is null or amount >= 0)
);

create index if not exists list_items_user_id_idx on public.list_items (user_id);
-- Every screen reads one list at a time, open entries first, in order.
create index if not exists list_items_list_sort_idx
  on public.list_items (list_id, is_done, sort_order);

alter table public.list_items enable row level security;

drop policy if exists "list_items_select_own" on public.list_items;
create policy "list_items_select_own" on public.list_items
  for select to authenticated using ((select auth.uid()) = user_id);

-- The insert check names both halves: the row must belong to the caller *and*
-- hang under a list that also belongs to them. Without the second half a
-- correctly-owned entry could be parked inside somebody else's list.
drop policy if exists "list_items_insert_own" on public.list_items;
create policy "list_items_insert_own" on public.list_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "list_items_update_own" on public.list_items;
create policy "list_items_update_own" on public.list_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "list_items_delete_own" on public.list_items;
create policy "list_items_delete_own" on public.list_items
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.list_items from anon;
grant select, insert, update, delete on public.list_items to authenticated;

drop trigger if exists list_items_set_updated_at on public.list_items;
create trigger list_items_set_updated_at
  before update on public.list_items
  for each row execute function public.set_updated_at();

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Same second step 0004 documents: creating a table and letting Realtime see it
-- are separate, and a table outside the publication produces no change events
-- at all. RLS is re-checked per subscriber, so this weakens nothing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lists'
  ) then
    alter publication supabase_realtime add table public.lists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'list_items'
  ) then
    alter publication supabase_realtime add table public.list_items;
  end if;
end
$$;
