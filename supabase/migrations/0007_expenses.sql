-- Mind Whiteboard — Ausgaben (der Ausgabentracker für das Auslandssemester).
-- Follows the pattern documented in 0001_foundation exactly: own id, owner,
-- timestamps, indexes, RLS, grants, updated_at trigger, Realtime.
--
-- ONE TABLE, because an expense has no children. Deliberately no categories, no
-- budgets and no recurrence — the module is meant to stay a fast capture
-- surface, and every one of those would be a column nobody fills in.
--
-- WHY THE EXCHANGE RATE IS A COLUMN ON EVERY ROW
-- A coffee bought in March was bought at March's rate. Storing the rate that
-- was actually used turns each row into a self-contained fact: the AUD/EUR
-- switch in the overview converts every expense with its own rate and never
-- rewrites history when today's rate moves. It is also the module's fallback
-- source — the newest row carries the last rate this account successfully
-- loaded, so a failed rate request has something honest to fall back on
-- without a second store (see src/lib/exchangeRate.js).

create table if not exists public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  -- Titel/Beschreibung in one field: "Kaffee", "Miete September", "Zug nach
  -- Melbourne". A second free-text column would be a form field nobody fills
  -- in while standing at a till.
  title                 text not null,
  -- What the user actually paid, in the currency they paid in. Never converted
  -- on the way in — the conversion is a view, the original is the fact.
  original_amount       numeric(12, 2) not null,
  -- The two currencies of this semester. Constrained rather than free text: an
  -- unknown code would be a row the overview cannot convert or add up. A third
  -- currency is a one-line migration — deliberately a decision, not an accident.
  original_currency     text not null,
  transaction_date      date not null default current_date,
  -- EUR for 1 AUD, i.e. 0.58 means 1 AUD = 0,58 €. Six decimals is more than
  -- the source publishes (four to five), so nothing is lost on the way in.
  exchange_rate_aud_eur numeric(12, 6) not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- An expense without a name is a row nobody can recognise again.
  constraint expenses_title_not_blank check (char_length(btrim(title)) > 0),
  constraint expenses_title_len check (char_length(title) <= 200),
  -- Zero is not an expense and a negative one is an income — neither is a state
  -- the UI can produce, and neither would display sensibly in a total.
  constraint expenses_amount_positive check (original_amount > 0),
  constraint expenses_currency_known check (original_currency in ('AUD', 'EUR')),
  -- A zero or negative rate would divide the AUD view by zero.
  constraint expenses_rate_positive check (exchange_rate_aud_eur > 0)
);

create index if not exists expenses_user_id_idx on public.expenses (user_id);
-- The overview reads one user's expenses newest-first, and that is the only
-- order any screen asks for. `created_at` breaks ties inside a day, so two
-- expenses entered on the same date keep the order they were entered in.
create index if not exists expenses_user_date_idx
  on public.expenses (user_id, transaction_date desc, created_at desc);

alter table public.expenses enable row level security;

drop policy if exists "expenses_select_own" on public.expenses;
create policy "expenses_select_own" on public.expenses
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "expenses_insert_own" on public.expenses;
create policy "expenses_insert_own" on public.expenses
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Both halves matter: `using` decides which rows may be touched, `with check`
-- stops a row from being handed to somebody else on the way out.
drop policy if exists "expenses_update_own" on public.expenses;
create policy "expenses_update_own" on public.expenses
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "expenses_delete_own" on public.expenses;
create policy "expenses_delete_own" on public.expenses
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.expenses from anon;
grant select, insert, update, delete on public.expenses to authenticated;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Same second step 0004 documents: creating a table and letting Realtime see it
-- are separate, and a table outside the publication produces no change events
-- at all. RLS is re-checked per subscriber, so this weakens nothing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;
end
$$;
