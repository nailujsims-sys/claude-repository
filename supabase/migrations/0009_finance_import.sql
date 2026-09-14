-- 0009_finance_import — persisting a reconciliation plan.
--
-- 0008 brought the model: accounts, categories, merchants, patterns, rules,
-- imports, bookings, overrides. The DKB pipeline that followed it (parser,
-- cross-import reconciliation) ends in a PLAN — a list of decisions about what
-- a second export means for what is already stored. Until now that plan was
-- ephemeral: computed in the browser, shown, and forgotten.
--
-- This migration gives it a place to land, under four rules that the previous
-- stage established on real data and that the tables below turn into structure
-- rather than convention:
--
--   1. THE ORIGINAL IS NEVER REWRITTEN. A later export that describes the same
--      booking better does not touch `raw_description` — the freeze trigger of
--      0008 would refuse it anyway. The better text becomes an OBSERVATION: a
--      row of its own, appended, never updated.
--
--   2. A SUPERSESSION IS NOT A COLUMN. The real export produced two provisional
--      −60,65 € bookings and two settled ones that replace them, with nothing
--      in either document saying which settles which. A
--      `superseded_by_transaction_id` column can only express a guess. So the
--      link is a RELATION with members and roles: 1↔1, 1↔n and n↔n all fit, and
--      the ambiguous pair is stored as what it is — two predecessors, two
--      replacements, no individual assignment.
--
--   3. A CONFLICT IS NOT A LOG LINE. Everything the plan could not decide —
--      unresolved cardinalities, matches blocked by a manual decision — becomes
--      a REVIEW ITEM carrying the full incoming booking, so nothing a human has
--      to decide is thrown away when the browser tab closes.
--
--   4. ONE IMPORT IS ONE ACT. The whole plan is applied by one function, inside
--      one transaction. Half an import is not a state this schema can be left
--      in, and an import already applied is never applied twice.
--
-- WHAT THIS MIGRATION STILL DOES NOT BRING: no screen, no route, no realtime
-- publication. It is the storage layer for a pipeline whose UI comes later.

-- ── A helper the policies need ──────────────────────────────────────────────
-- `finance_owns_transaction` of 0008 answers the question for one id. A review
-- item names a SET of bookings, and a set with one foreign member in it is
-- exactly the leak the per-row policies cannot see. Same shape as its
-- siblings: `stable`, invoker rights, null and empty pass.
create or replace function public.finance_owns_transactions(p_ids uuid[])
returns boolean language sql stable set search_path = '' as $$
  select p_ids is null
      or cardinality(p_ids) = 0
      or not exists (
        select 1
        from unnest(p_ids) as t(id)
        where t.id is null
           or not exists (
             select 1 from public.finance_transactions x
             where x.id = t.id and x.user_id = (select auth.uid())
           )
      );
$$;

-- One sorted, comparable text for a set of ids. Used to group the decisions of
-- one ambiguous group together and to build the idempotency key of a relation.
-- Sorting is what makes it order-independent: the same set of bookings produces
-- the same key however the plan happened to list them.
create or replace function public.finance_uuid_key(p_ids uuid[])
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    (select string_agg(x::text, ',' order by x) from unnest(p_ids) as t(x)),
    ''
  );
$$;

-- Is this booking one a human has already decided about?
--
-- Two sources, both of which 0008 treats as "manual beats automatic":
-- `manual_lock` on the booking and the existence of an override row. The
-- importer asks this question about every booking it is about to deactivate,
-- and the answer is read from the database — never from the plan, which is
-- computed in a browser and may be stale by the time it arrives.
create or replace function public.finance_transaction_protected(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.finance_transactions t
    where t.id = p_id and t.user_id = (select auth.uid()) and t.manual_lock
  ) or exists (
    select 1 from public.finance_transaction_overrides o
    where o.transaction_id = p_id and o.user_id = (select auth.uid())
  );
$$;

-- ── finance_imports gains the result of its own application ────────────────
-- `status = 'imported'` already says that an import was applied. What it does
-- not say is WHAT the application did, and that is the answer a replay has to
-- return instead of doing the work a second time.
alter table public.finance_imports
  add column if not exists apply_result jsonb;

-- ── finance_transaction_observations: later evidence, appended ──────────────
-- WHY A TABLE AND NOT A COLUMN. A second export says the −14,38 € booking of
-- 10.09. is not "REWE" but "REWE.Mohamed.Boufo/Frankfurt". That is new
-- knowledge about an old fact, and the old fact is frozen. Writing it into the
-- booking would destroy the very thing the freeze trigger protects; writing it
-- nowhere would lose the only place the reference of the −50,05 € booking ever
-- appears. So it is appended next to the booking, with the import that saw it.
--
-- APPEND-ONLY, AND NOT ONLY BY CONVENTION: the trigger below refuses every
-- UPDATE. Deletes are left to the cascade, so removing a booking or a user
-- still removes its evidence.
create table if not exists public.finance_transaction_observations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  transaction_id      uuid not null references public.finance_transactions (id) on delete cascade,
  -- The import that contributed this evidence. `set null` for the same reason
  -- as on the booking: deleting import metadata must not delete what was
  -- learned from it.
  import_id           uuid references public.finance_imports (id) on delete set null,
  observed_description text not null,
  observed_reference   text,
  -- The card's own transaction date, ISO, when the observed text states one.
  observed_card_date   date,
  -- The ISO timestamp of the provisional form, verbatim. Kept as text: it is a
  -- substring of a bank statement, not a moment this app computed.
  observed_card_timestamp text,
  source_variant       text not null default 'standard',
  -- Whatever else the import derived about this booking — the parser's
  -- source_metadata, the matching evidence. Diagnostics, never a second copy
  -- of the amount.
  evidence             jsonb,
  -- The identity of the evidence itself, stamped by the trigger below from the
  -- observed content — deliberately WITHOUT the import id. Two imports that
  -- observe exactly the same thing about the same booking are one observation,
  -- which is what makes re-applying an equivalent export add nothing. The
  -- import recorded is therefore the first one that saw it.
  observation_key      text not null default '',
  created_at           timestamptz not null default now(),
  constraint finance_observations_description_len
    check (char_length(observed_description) <= 2000),
  constraint finance_observations_reference_len
    check (observed_reference is null or char_length(observed_reference) <= 255),
  constraint finance_observations_timestamp_len
    check (observed_card_timestamp is null or char_length(observed_card_timestamp) <= 64),
  constraint finance_observations_variant_known
    check (source_variant in ('standard', 'timestamped_card'))
);

create or replace function public.finance_stamp_observation_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.observation_key := md5(
    new.transaction_id::text || E'\n' ||
    new.observed_description || E'\n' ||
    coalesce(new.observed_reference, '') || E'\n' ||
    coalesce(new.observed_card_date::text, '') || E'\n' ||
    coalesce(new.observed_card_timestamp, '') || E'\n' ||
    new.source_variant
  );
  return new;
end;
$$;

drop trigger if exists finance_observations_stamp_key on public.finance_transaction_observations;
create trigger finance_observations_stamp_key
  before insert on public.finance_transaction_observations
  for each row execute function public.finance_stamp_observation_key();

create or replace function public.finance_observations_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'finance: Beobachtungen sind unveraenderlich (id %)', old.id
    using errcode = '23514';
end;
$$;

drop trigger if exists finance_observations_no_update on public.finance_transaction_observations;
create trigger finance_observations_no_update
  before update on public.finance_transaction_observations
  for each row execute function public.finance_observations_append_only();

create unique index if not exists finance_observations_key_idx
  on public.finance_transaction_observations (user_id, observation_key);
create index if not exists finance_observations_tx_idx
  on public.finance_transaction_observations (transaction_id, created_at desc);
create index if not exists finance_observations_import_idx
  on public.finance_transaction_observations (import_id);

-- ── finance_transaction_relations: what one booking is to another ───────────
-- Two kinds so far, and they are kept apart because they mean different things:
--
--   supersession    — the provisional booking and the settled booking are THE
--                     SAME payment seen twice. Exactly one side may count.
--   refund_candidate— a purchase and its refund are TWO real payments that
--                     happen to share a reference. Both count; the relation is
--                     only a proposal, because typing a booking as a refund is
--                     a human decision (0008 ties `refunds_transaction_id` to
--                     `transaction_type = 'refund'` for that reason).
--
-- `status` separates what the importer may assert from what a human confirms.
-- An automatic supersession is written as `confirmed` only when nothing manual
-- stands in its way; otherwise it stays `proposed` and a review item is raised.
create table if not exists public.finance_transaction_relations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  import_id     uuid references public.finance_imports (id) on delete set null,
  relation_type text not null,
  status        text not null default 'proposed',
  -- How many bookings the relation covers on its larger side. Stored so that a
  -- reader can see "two replace two" without counting members.
  cardinality   integer not null default 1,
  reason        text,
  evidence      jsonb,
  -- md5 over the type and the member sets. Re-proposing a relation that already
  -- exists writes nothing.
  relation_key  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  resolved_at   timestamptz,
  constraint finance_relations_type_known
    check (relation_type in ('supersession', 'refund_candidate', 'refund')),
  constraint finance_relations_status_known
    check (status in ('proposed', 'confirmed', 'rejected')),
  constraint finance_relations_cardinality_positive check (cardinality >= 1),
  constraint finance_relations_reason_len check (reason is null or char_length(reason) <= 1000),
  constraint finance_relations_key_len check (char_length(relation_key) between 1 and 128),
  constraint finance_relations_confirmed_has_time
    check (status <> 'confirmed' or confirmed_at is not null)
);

create unique index if not exists finance_relations_key_idx
  on public.finance_transaction_relations (user_id, relation_key);
create index if not exists finance_relations_user_type_idx
  on public.finance_transaction_relations (user_id, relation_type, status);
create index if not exists finance_relations_import_idx
  on public.finance_transaction_relations (import_id);

-- The composite key the member table points at, so that "a role that does not
-- exist for this relation type" is refused by the database rather than by a
-- trigger somebody can forget to write.
create unique index if not exists finance_relations_id_type_idx
  on public.finance_transaction_relations (id, relation_type);

create table if not exists public.finance_transaction_relation_members (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  relation_id    uuid not null,
  -- Denormalised on purpose: it is what carries the composite foreign key
  -- below, which is what makes the role check declarative.
  relation_type  text not null,
  transaction_id uuid not null references public.finance_transactions (id) on delete cascade,
  role           text not null,
  created_at     timestamptz not null default now(),
  constraint finance_relation_members_relation_fk
    foreign key (relation_id, relation_type)
    references public.finance_transaction_relations (id, relation_type)
    on delete cascade,
  constraint finance_relation_members_role_fits_type check (
    (relation_type = 'supersession' and role in ('predecessor', 'replacement'))
    or (relation_type in ('refund_candidate', 'refund') and role in ('purchase', 'refund'))
  )
);

-- One booking appears at most once per relation and role.
create unique index if not exists finance_relation_members_unique_idx
  on public.finance_transaction_relation_members (relation_id, transaction_id, role);
create index if not exists finance_relation_members_tx_idx
  on public.finance_transaction_relation_members (transaction_id);
create index if not exists finance_relation_members_user_idx
  on public.finance_transaction_relation_members (user_id);

-- A booking is superseded at most once, and replaces at most once.
--
-- TWO SEPARATE INDEXES, NOT ONE OVER BOTH ROLES. A provisional booking A that
-- is replaced by B, and B that is later itself replaced by C, is a real chain:
-- B is a `replacement` in the first relation and a `predecessor` in the second.
-- A single index over both roles would forbid exactly that, and A → B → C is a
-- sequence two overlapping exports can genuinely produce.
create unique index if not exists finance_relation_members_one_predecessor_idx
  on public.finance_transaction_relation_members (transaction_id)
  where role = 'predecessor';
create unique index if not exists finance_relation_members_one_replacement_idx
  on public.finance_transaction_relation_members (transaction_id)
  where role = 'replacement';

-- ── finance_import_review_items: the queue of what nobody could decide ──────
-- Every outcome the reconciliation refused to act on lands here, with the full
-- incoming booking in `payload`. That is the difference between "we did not
-- import it" and "we lost it": a human can still read exactly what arrived,
-- what it seemed to match, and why the importer stopped.
create table if not exists public.finance_import_review_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  import_id       uuid references public.finance_imports (id) on delete set null,
  account_id      uuid not null references public.finance_accounts (id) on delete cascade,
  item_type       text not null,
  status          text not null default 'open',
  reason          text not null,
  -- The bookings the item is about. A uuid[] rather than a member table: a
  -- review item is read as a whole, never joined against. Ownership of every
  -- member is enforced by the policy, not by a foreign key — see
  -- finance_owns_transactions.
  transaction_ids uuid[] not null default '{}',
  payload         jsonb,
  resolution      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  -- md5 over type and content. Unique among the OPEN items only: the same
  -- conflict is not raised twice while it is still waiting, and a conflict that
  -- genuinely recurs after being resolved can be raised again.
  item_key        text not null,
  constraint finance_review_items_type_known check (
    item_type in (
      'unresolved_match',      -- the cardinalities did not line up
      'manual_review',         -- a match blocked by a manual decision
      'manual_lock_conflict',  -- an automatic supersession stood down
      'ambiguous_group'        -- richer texts that cannot be attributed row by row
    )
  ),
  constraint finance_review_items_status_known
    check (status in ('open', 'resolved', 'dismissed')),
  constraint finance_review_items_reason_len check (char_length(reason) between 1 and 1000),
  constraint finance_review_items_resolution_len
    check (resolution is null or char_length(resolution) <= 1000),
  constraint finance_review_items_key_len check (char_length(item_key) between 1 and 128),
  constraint finance_review_items_open_unresolved
    check (status = 'open' or resolved_at is not null)
);

create unique index if not exists finance_review_items_open_key_idx
  on public.finance_import_review_items (user_id, item_key)
  where status = 'open';
create index if not exists finance_review_items_open_idx
  on public.finance_import_review_items (user_id, created_at desc)
  where status = 'open';
create index if not exists finance_review_items_import_idx
  on public.finance_import_review_items (import_id);
create index if not exists finance_review_items_account_idx
  on public.finance_import_review_items (account_id);

-- ── What counts in the analytics, stated once ───────────────────────────────
-- THE QUESTION THIS VIEW ANSWERS. After a confirmed supersession, the
-- provisional booking and the settled booking both exist — that is the point of
-- keeping the relation auditable. Exactly one of them may be added up, and it
-- is the replacement: it is the booking the bank finally settled, and it is the
-- one that carries the full text.
--
-- TWO MECHANISMS, DELIBERATELY. `finance_apply_reconciliation_plan` sets
-- `include_in_analytics = false` on every predecessor it confirms — that is the
-- fast path any query can use. This view states the rule independently, over
-- the relations themselves. They agree by construction, and where they ever
-- disagreed the view is the stricter of the two: a predecessor whose flag was
-- turned back on by hand is still excluded here. Double counting is the failure
-- this module exists to prevent, so the redundant check points that way.
--
-- `security_invoker` — the view is read under the caller's own RLS, not the
-- owner's. Without it a view over eight RLS-protected tables would be a hole
-- straight through them.
create or replace view public.finance_analytics_transactions
with (security_invoker = true) as
select t.*
from public.finance_transactions t
where t.include_in_analytics
  and not exists (
    select 1
    from public.finance_transaction_relation_members m
    join public.finance_transaction_relations r on r.id = m.relation_id
    where m.transaction_id = t.id
      and m.role = 'predecessor'
      and r.relation_type = 'supersession'
      and r.status = 'confirmed'
  );

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.finance_transaction_observations enable row level security;

drop policy if exists "finance_observations_select_own" on public.finance_transaction_observations;
create policy "finance_observations_select_own" on public.finance_transaction_observations
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_observations_insert_own" on public.finance_transaction_observations;
create policy "finance_observations_insert_own" on public.finance_transaction_observations
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_transaction(transaction_id)
    and public.finance_owns_import(import_id)
  );

-- No update policy at all. The trigger refuses updates anyway; leaving the
-- policy out means the attempt is denied before it ever reaches the trigger.
drop policy if exists "finance_observations_delete_own" on public.finance_transaction_observations;
create policy "finance_observations_delete_own" on public.finance_transaction_observations
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_transaction_relations enable row level security;

drop policy if exists "finance_relations_select_own" on public.finance_transaction_relations;
create policy "finance_relations_select_own" on public.finance_transaction_relations
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_relations_insert_own" on public.finance_transaction_relations;
create policy "finance_relations_insert_own" on public.finance_transaction_relations
  for insert to authenticated with check (
    (select auth.uid()) = user_id and public.finance_owns_import(import_id)
  );

drop policy if exists "finance_relations_update_own" on public.finance_transaction_relations;
create policy "finance_relations_update_own" on public.finance_transaction_relations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and public.finance_owns_import(import_id)
  );

drop policy if exists "finance_relations_delete_own" on public.finance_transaction_relations;
create policy "finance_relations_delete_own" on public.finance_transaction_relations
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_transaction_relation_members enable row level security;

drop policy if exists "finance_relation_members_select_own" on public.finance_transaction_relation_members;
create policy "finance_relation_members_select_own" on public.finance_transaction_relation_members
  for select to authenticated using ((select auth.uid()) = user_id);

-- The relation and the booking both have to be the caller's own. Without the
-- first check a member row could hang a foreign relation off an own booking.
drop policy if exists "finance_relation_members_insert_own" on public.finance_transaction_relation_members;
create policy "finance_relation_members_insert_own" on public.finance_transaction_relation_members
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_transaction(transaction_id)
    and exists (
      select 1 from public.finance_transaction_relations r
      where r.id = relation_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "finance_relation_members_delete_own" on public.finance_transaction_relation_members;
create policy "finance_relation_members_delete_own" on public.finance_transaction_relation_members
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_import_review_items enable row level security;

drop policy if exists "finance_review_items_select_own" on public.finance_import_review_items;
create policy "finance_review_items_select_own" on public.finance_import_review_items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_review_items_insert_own" on public.finance_import_review_items;
create policy "finance_review_items_insert_own" on public.finance_import_review_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_account(account_id)
    and public.finance_owns_import(import_id)
    and public.finance_owns_transactions(transaction_ids)
  );

drop policy if exists "finance_review_items_update_own" on public.finance_import_review_items;
create policy "finance_review_items_update_own" on public.finance_import_review_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.finance_owns_account(account_id)
    and public.finance_owns_import(import_id)
    and public.finance_owns_transactions(transaction_ids)
  );

drop policy if exists "finance_review_items_delete_own" on public.finance_import_review_items;
create policy "finance_review_items_delete_own" on public.finance_import_review_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on public.finance_transaction_observations      from anon;
revoke all on public.finance_transaction_relations         from anon;
revoke all on public.finance_transaction_relation_members  from anon;
revoke all on public.finance_import_review_items           from anon;
revoke all on public.finance_analytics_transactions        from anon;

grant select, insert, delete on public.finance_transaction_observations to authenticated;
grant select, insert, update, delete on public.finance_transaction_relations to authenticated;
grant select, insert, delete on public.finance_transaction_relation_members to authenticated;
grant select, insert, update, delete on public.finance_import_review_items to authenticated;
grant select on public.finance_analytics_transactions to authenticated;

-- ── updated_at ──────────────────────────────────────────────────────────────
drop trigger if exists finance_relations_set_updated_at on public.finance_transaction_relations;
create trigger finance_relations_set_updated_at
  before update on public.finance_transaction_relations
  for each row execute function public.set_updated_at();

drop trigger if exists finance_review_items_set_updated_at on public.finance_import_review_items;
create trigger finance_review_items_set_updated_at
  before update on public.finance_import_review_items
  for each row execute function public.set_updated_at();

-- ── The one operation that may not be split: applying a plan ────────────────
-- WHAT THE CALLER SENDS. Exactly what the browser computed and a human
-- confirmed: the parsed bookings of the export (`p_bookings`), one decision per
-- booking (`p_decisions`, as `reconcileImport` produces them) and the refund
-- proposals. Nothing is inferred here that the plan does not state.
--
-- WHAT THE DATABASE TAKES ON TRUST: nothing that matters.
--   • every booking the plan names has to belong to the caller AND to the
--     account being imported — a plan reaching across accounts is refused
--     outright, not quietly filtered;
--   • whether a booking is protected by a manual decision is read from the
--     database, not from the plan, because the plan was computed in a browser
--     and may be minutes old;
--   • a plan that would supersede an already-superseded booking is refused
--     rather than repaired: it is stale, and the honest answer is to recompute
--     it.
--
-- ALL OR NOTHING. PostgREST runs this as one statement in one transaction. Any
-- raise below undoes everything — the new bookings, the observations, the
-- relations, the review items and the status of the import alike. There is no
-- state in which half an export has arrived.
--
-- APPLIED ONCE. The import row is locked at the start. An import already in
-- `imported` returns its stored result and writes nothing, so a retry after a
-- lost response, a double-clicked button and a second call from another tab all
-- end in the same place. The other half of the same promise lives in 0008: the
-- unique index on (user_id, source_hash) makes the same file the same import.
--
-- INVOKER RIGHTS, like finance_learn_merchant_rule. No `security definer`, no
-- service-role key: every statement runs as the signed-in user, under the
-- policies above. The function makes the writes atomic; it does not widen what
-- the caller may reach.
create or replace function public.finance_apply_reconciliation_plan(
  p_import_id         uuid,
  p_account_id        uuid,
  p_bookings          jsonb,
  p_decisions         jsonb,
  p_refund_candidates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user            uuid := (select auth.uid());
  v_import          public.finance_imports%rowtype;
  v_booking_count   integer;
  v_count           integer;
  v_all_existing    uuid[];
  v_new_ids         uuid[] := '{}'::uuid[];
  v_preds           uuid[];
  v_repl            uuid[];
  v_tx              uuid;
  v_relation_id     uuid;
  v_key             text;
  v_protected       boolean;
  v_created         integer := 0;
  v_obs             integer := 0;
  v_rel_confirmed   integer := 0;
  v_rel_proposed    integer := 0;
  v_excluded        integer := 0;
  v_refund_rel      integer := 0;
  v_refund_skipped  integer := 0;
  v_review          integer := 0;
  v_deactivated     uuid[];
  v_charge          uuid;
  v_refund          uuid;
  v_type            text;
  v_result          jsonb;
  b                 jsonb;
  v_dec             record;
  v_grp             record;
  v_cand            record;
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;
  if p_bookings is null or jsonb_typeof(p_bookings) <> 'array'
     or p_decisions is null or jsonb_typeof(p_decisions) <> 'array'
     or p_refund_candidates is null or jsonb_typeof(p_refund_candidates) <> 'array' then
    raise exception 'finance: der Plan ist unvollstaendig' using errcode = '22023';
  end if;

  -- ── the import this plan belongs to, locked for the duration ──
  select * into v_import
  from public.finance_imports
  where id = p_import_id and user_id = v_user
  for update;
  if not found then
    raise exception 'finance: Import % nicht gefunden', p_import_id using errcode = 'P0002';
  end if;
  if v_import.account_id is distinct from p_account_id then
    raise exception 'finance: der Import gehoert zu einem anderen Konto' using errcode = '22023';
  end if;
  if not public.finance_owns_account(p_account_id) then
    raise exception 'finance: Konto % nicht gefunden', p_account_id using errcode = 'P0002';
  end if;

  -- Already applied. Not an error and not a second import: the stored result,
  -- marked as a replay.
  if v_import.status = 'imported' then
    return coalesce(v_import.apply_result, jsonb_build_object('import_id', p_import_id))
           || jsonb_build_object('replayed', true);
  end if;

  -- ── the plan has to describe this export completely ──
  v_booking_count := jsonb_array_length(p_bookings);
  if jsonb_array_length(p_decisions) <> v_booking_count then
    raise exception 'finance: % Entscheidungen fuer % Umsaetze', jsonb_array_length(p_decisions), v_booking_count
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_decisions) as plan_row(index integer, outcome text)
    where plan_row.index is null or plan_row.index < 0 or plan_row.index >= v_booking_count
       or plan_row.outcome is null
       or plan_row.outcome not in ('new', 'duplicate', 'enriched', 'supersedes',
                            'supersedes_group', 'unresolved', 'review')
  ) then
    raise exception 'finance: der Plan enthaelt eine unbekannte Entscheidung' using errcode = '22023';
  end if;

  select count(distinct plan_row.index) into v_count
  from jsonb_to_recordset(p_decisions) as plan_row(index integer);
  if v_count <> v_booking_count then
    raise exception 'finance: jeder Umsatz braucht genau eine Entscheidung' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_decisions) as plan_row(existing_ids uuid[])
    where plan_row.existing_ids is not null and array_position(plan_row.existing_ids, null) is not null
  ) then
    raise exception 'finance: der Plan nennt eine leere Buchungs-ID' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_decisions) as plan_row(outcome text, existing_ids uuid[])
    where (plan_row.outcome = 'new' and coalesce(cardinality(plan_row.existing_ids), 0) > 0)
       or (plan_row.outcome <> 'new' and coalesce(cardinality(plan_row.existing_ids), 0) = 0)
  ) then
    raise exception 'finance: Entscheidung und genannte Buchungen passen nicht zusammen'
      using errcode = '22023';
  end if;

  -- ── every booking the plan names belongs to this user and this account ──
  -- The account is the hard boundary. RLS already hides another user's rows, so
  -- a foreign id simply will not be found and the count below will not add up;
  -- an own booking filed under a different account is caught by the same check.
  select array_agg(distinct u.x) into v_all_existing
  from jsonb_to_recordset(p_decisions) as plan_row(existing_ids uuid[]),
       lateral unnest(coalesce(plan_row.existing_ids, '{}'::uuid[])) as u(x);

  if v_all_existing is not null and cardinality(v_all_existing) > 0 then
    select count(*) into v_count
    from public.finance_transactions t
    where t.id = any (v_all_existing) and t.user_id = v_user and t.account_id = p_account_id;
    if v_count <> cardinality(v_all_existing) then
      raise exception 'finance: der Plan nennt Buchungen, die nicht zu diesem Konto gehoeren'
        using errcode = '42501';
    end if;
  end if;

  -- ── 1. the bookings that are genuinely new ──
  -- `new` and the settled side of a supersession alike: both are money that is
  -- not in the database yet. Everything else adds no booking.
  for v_dec in
    select * from jsonb_to_recordset(p_decisions)
      as plan_row(index integer, outcome text, tier integer, existing_ids uuid[], reason text, evidence jsonb)
    where plan_row.outcome in ('new', 'supersedes', 'supersedes_group')
    order by plan_row.index
  loop
    b := p_bookings -> v_dec.index;
    if b is null or jsonb_typeof(b) <> 'object' or nullif(btrim(coalesce(b->>'raw_description', '')), '') is null then
      raise exception 'finance: Umsatz % hat keinen Text', v_dec.index using errcode = '22023';
    end if;
    insert into public.finance_transactions (
      user_id, account_id, import_id, booking_date, value_date, amount_minor,
      currency, raw_description, external_reference, normalized_tokens, source_metadata
    ) values (
      v_user, p_account_id, p_import_id,
      (b->>'booking_date')::date,
      nullif(b->>'value_date', '')::date,
      (b->>'amount_minor')::bigint,
      coalesce(nullif(b->>'currency', ''), 'EUR'),
      b->>'raw_description',
      nullif(coalesce(b->>'external_reference', b->'source_metadata'->>'reference'), ''),
      coalesce(
        (select array_agg(t.value order by t.ord)
         from jsonb_array_elements_text(
                case when jsonb_typeof(b->'normalized_tokens') = 'array'
                     then b->'normalized_tokens' else '[]'::jsonb end
              ) with ordinality as t(value, ord)),
        '{}'::text[]
      ),
      case when jsonb_typeof(b->'source_metadata') = 'object' then b->'source_metadata' else null end
    )
    returning id into v_tx;
    v_new_ids[v_dec.index + 1] := v_tx;
    v_created := v_created + 1;
  end loop;

  -- ── 2. observations: the better text of an existing booking ──
  -- Only where the plan links one arrival to exactly ONE stored booking. In an
  -- ambiguous group the texts are real but unattributable, and writing one of
  -- them onto one of the rows would assert a correspondence no document states;
  -- those land in a review item further down instead.
  --
  -- And only where the arrival actually says something new. A literal duplicate
  -- repeats what the booking already holds, and a row that adds nothing is
  -- noise in an append-only table.
  for v_dec in
    select * from jsonb_to_recordset(p_decisions)
      as plan_row(index integer, outcome text, tier integer, existing_ids uuid[], reason text, evidence jsonb)
    where plan_row.outcome in ('duplicate', 'enriched') and cardinality(plan_row.existing_ids) = 1
    order by plan_row.index
  loop
    b := p_bookings -> v_dec.index;
    v_tx := v_dec.existing_ids[1];
    if exists (
      select 1 from public.finance_transactions t
      where t.id = v_tx
        and (
          -- A different text, or a reference the booking does not carry. Those
          -- are the two things a later export can genuinely add.
          --
          -- NOT "the arrival has a card date": a settled booking states its card
          -- date inside its own text, so that clause would fire on every literal
          -- duplicate and fill the table with copies of what is already there.
          t.raw_description is distinct from (b->>'raw_description')
          or (
            nullif(coalesce(b->>'external_reference', b->'source_metadata'->>'reference'), '') is not null
            and nullif(coalesce(b->>'external_reference', b->'source_metadata'->>'reference'), '')
                is distinct from t.external_reference
          )
        )
    ) then
      insert into public.finance_transaction_observations (
        user_id, transaction_id, import_id, observed_description, observed_reference,
        observed_card_date, observed_card_timestamp, source_variant, evidence
      ) values (
        v_user, v_tx, p_import_id,
        b->>'raw_description',
        nullif(coalesce(b->>'external_reference', b->'source_metadata'->>'reference'), ''),
        nullif(b->'source_metadata'->>'card_transaction_date', '')::date,
        nullif(b->'source_metadata'->>'card_timestamp', ''),
        case when b->>'source_variant' in ('standard', 'timestamped_card')
             then b->>'source_variant' else 'standard' end,
        jsonb_build_object(
          'outcome', v_dec.outcome,
          'tier', v_dec.tier,
          'match', v_dec.evidence,
          'source_metadata', b->'source_metadata'
        )
      )
      on conflict (user_id, observation_key) do nothing;
      get diagnostics v_count = row_count;
      v_obs := v_obs + v_count;
    end if;
  end loop;

  -- ── 3. supersessions, as groups ──
  -- All decisions that name the same set of stored bookings are ONE relation.
  -- For the real −60,65 € case that is two predecessors and two replacements in
  -- a single relation with no individual link — the cardinality is preserved and
  -- nothing is invented. A plain 1:1 supersession is the same code path with one
  -- member on each side.
  for v_grp in
    select public.finance_uuid_key(plan_row.existing_ids) as pkey,
           array_agg(plan_row.index order by plan_row.index) as idxs
    from jsonb_to_recordset(p_decisions) as plan_row(index integer, outcome text, existing_ids uuid[])
    where plan_row.outcome in ('supersedes', 'supersedes_group')
    group by public.finance_uuid_key(plan_row.existing_ids)
    order by 1
  loop
    v_preds := (select array_agg(x::uuid order by x) from unnest(string_to_array(v_grp.pkey, ',')) as t(x));
    v_repl  := (select array_agg(v_new_ids[i + 1] order by i) from unnest(v_grp.idxs) as t(i));

    -- A booking that is already the predecessor of a supersession cannot be
    -- superseded a second time. Reaching this point means the plan was computed
    -- against a state that has since moved on; repairing it here would be
    -- guessing, so the whole import is refused and nothing is written.
    if exists (
      select 1 from public.finance_transaction_relation_members m
      where m.user_id = v_user and m.role = 'predecessor' and m.transaction_id = any (v_preds)
    ) then
      raise exception 'finance: eine der Buchungen wurde bereits abgeloest — der Plan ist veraltet'
        using errcode = '23505';
    end if;

    -- Read from the database, never from the plan.
    select bool_or(public.finance_transaction_protected(x)) into v_protected
    from unnest(v_preds) as t(x);
    v_protected := coalesce(v_protected, false);

    v_key := md5('supersession|' || public.finance_uuid_key(v_preds) || '>' || public.finance_uuid_key(v_repl));
    v_relation_id := null;

    insert into public.finance_transaction_relations (
      user_id, import_id, relation_type, status, cardinality, reason, evidence, relation_key, confirmed_at
    ) values (
      v_user, p_import_id, 'supersession',
      case when v_protected then 'proposed' else 'confirmed' end,
      greatest(cardinality(v_preds), cardinality(v_repl)),
      case when v_protected
        then 'Ablösung erkannt. Mindestens eine der vorhandenen Buchungen trägt eine manuelle Entscheidung, also wurde nichts automatisch deaktiviert.'
        else 'Die abgerechnete Buchung löst die vorgemerkte ab; nur die abgerechnete zählt in der Auswertung.'
      end,
      jsonb_build_object(
        'predecessors', to_jsonb(v_preds),
        'replacements', to_jsonb(v_repl),
        'incoming_indexes', to_jsonb(v_grp.idxs),
        'ambiguous', cardinality(v_preds) > 1
      ),
      v_key,
      case when v_protected then null else now() end
    )
    on conflict (user_id, relation_key) do nothing
    returning id into v_relation_id;

    if v_relation_id is not null then
      insert into public.finance_transaction_relation_members (user_id, relation_id, relation_type, transaction_id, role)
      select v_user, v_relation_id, 'supersession', x, 'predecessor' from unnest(v_preds) as t(x);
      insert into public.finance_transaction_relation_members (user_id, relation_id, relation_type, transaction_id, role)
      select v_user, v_relation_id, 'supersession', x, 'replacement' from unnest(v_repl) as t(x);

      if v_protected then
        v_rel_proposed := v_rel_proposed + 1;
        -- The manual decision stays exactly as it is. But leaving the new
        -- booking counting while the old one also counts is the double count
        -- this module exists to prevent, so the NEW one stands down until a
        -- human has looked at the relation.
        with stood_down as (
          update public.finance_transactions
          set include_in_analytics = false
          where id = any (v_repl) and user_id = v_user and include_in_analytics
          returning id
        )
        select coalesce(array_agg(id), '{}'::uuid[]) into v_deactivated from stood_down;
        v_excluded := v_excluded + cardinality(v_deactivated);

        insert into public.finance_import_review_items (
          user_id, import_id, account_id, item_type, status, reason, transaction_ids, payload, item_key
        ) values (
          v_user, p_import_id, p_account_id, 'manual_lock_conflict', 'open',
          'Diese Buchung löst eine vorhandene ab, die manuell entschieden wurde. Die alte Buchung bleibt unverändert, die neue zählt vorerst nicht.',
          v_preds || v_repl,
          jsonb_build_object(
            'relation_id', v_relation_id,
            'predecessors', to_jsonb(v_preds),
            'replacements', to_jsonb(v_repl),
            'protected', (
              select coalesce(jsonb_agg(x), '[]'::jsonb)
              from unnest(v_preds) as t(x)
              where public.finance_transaction_protected(x)
            )
          ),
          md5('manual_lock_conflict|' || public.finance_uuid_key(v_preds) || '>' || public.finance_uuid_key(v_repl))
        )
        on conflict (user_id, item_key) where status = 'open' do nothing;
        get diagnostics v_count = row_count;
        v_review := v_review + v_count;
      else
        v_rel_confirmed := v_rel_confirmed + 1;
        with stood_down as (
          update public.finance_transactions
          set include_in_analytics = false
          where id = any (v_preds) and user_id = v_user and include_in_analytics
          returning id
        )
        select coalesce(array_agg(id), '{}'::uuid[]) into v_deactivated from stood_down;
        v_excluded := v_excluded + cardinality(v_deactivated);
      end if;

      -- WHICH bookings this import took out of the analytics, by id and not by
      -- count — the predecessors when the supersession was confirmed, the new
      -- bookings when it stood down in front of a manual decision. Both are
      -- "what this import switched off", and the relation's status says which
      -- side it means.
      --
      -- `include_in_analytics` is ANDed with the view's own rule, so a
      -- relation that is later REJECTED does not restore counting on its own:
      -- the flag has to be put back too. Recording exactly the rows this import
      -- flipped is what lets a later resolve step do that without guessing —
      -- a booking the user had excluded by hand before the import must not be
      -- switched back on by undoing a supersession.
      update public.finance_transaction_relations
      set evidence = evidence || jsonb_build_object('analytics_deactivated', to_jsonb(v_deactivated))
      where id = v_relation_id and user_id = v_user;
    end if;
  end loop;

  -- ── 4. everything nobody could decide ──
  for v_dec in
    select * from jsonb_to_recordset(p_decisions)
      as plan_row(index integer, outcome text, tier integer, existing_ids uuid[], reason text, evidence jsonb)
    where plan_row.outcome in ('unresolved', 'review')
    order by plan_row.index
  loop
    b := p_bookings -> v_dec.index;
    v_type := case v_dec.outcome when 'unresolved' then 'unresolved_match' else 'manual_review' end;
    insert into public.finance_import_review_items (
      user_id, import_id, account_id, item_type, status, reason, transaction_ids, payload, item_key
    ) values (
      v_user, p_import_id, p_account_id, v_type, 'open',
      left(coalesce(nullif(btrim(v_dec.reason), ''), 'Ohne Begründung aus dem Abgleich.'), 1000),
      v_dec.existing_ids,
      jsonb_build_object(
        'booking', b,
        'decision', jsonb_build_object(
          'index', v_dec.index, 'outcome', v_dec.outcome, 'tier', v_dec.tier,
          'existing_ids', to_jsonb(v_dec.existing_ids), 'reason', v_dec.reason, 'evidence', v_dec.evidence
        )
      ),
      md5(v_type || '|' || public.finance_uuid_key(v_dec.existing_ids)
          || '|' || coalesce(b->>'booking_date', '')
          || '|' || coalesce(b->>'amount_minor', '')
          || '|' || coalesce(b->>'currency', '')
          || '|' || coalesce(b->>'raw_description', ''))
    )
    on conflict (user_id, item_key) where status = 'open' do nothing;
    get diagnostics v_count = row_count;
    v_review := v_review + v_count;
  end loop;

  -- A richer text that belongs to a group rather than to a row. No booking is
  -- created (the money is already there) and no observation is attributed —
  -- but the text is kept, because it is the only place some references appear.
  for v_dec in
    select * from jsonb_to_recordset(p_decisions)
      as plan_row(index integer, outcome text, tier integer, existing_ids uuid[], reason text, evidence jsonb)
    where plan_row.outcome in ('duplicate', 'enriched') and cardinality(plan_row.existing_ids) > 1
    order by plan_row.index
  loop
    b := p_bookings -> v_dec.index;
    insert into public.finance_import_review_items (
      user_id, import_id, account_id, item_type, status, reason, transaction_ids, payload, item_key
    ) values (
      v_user, p_import_id, p_account_id, 'ambiguous_group', 'open',
      left(coalesce(nullif(btrim(v_dec.reason), ''), 'Mehrere gleichartige Buchungen — der Text lässt sich keiner einzelnen zuordnen.'), 1000),
      v_dec.existing_ids,
      jsonb_build_object('booking', b, 'outcome', v_dec.outcome, 'evidence', v_dec.evidence),
      md5('ambiguous_group|' || public.finance_uuid_key(v_dec.existing_ids)
          || '|' || coalesce(b->>'raw_description', ''))
    )
    on conflict (user_id, item_key) where status = 'open' do nothing;
    get diagnostics v_count = row_count;
    v_review := v_review + v_count;
  end loop;

  -- ── 5. refund candidates ──
  -- A proposal, never a fact: 0008 only accepts `refunds_transaction_id` on a
  -- booking typed as a refund, and typing a booking is a human decision. A side
  -- that was not imported (because its own decision was unresolved) has no id
  -- to point at; that candidate is skipped and counted, not invented.
  for v_cand in
    select * from jsonb_to_recordset(p_refund_candidates)
      as rc(reference text, charge jsonb, refund jsonb, reason text)
  loop
    v_charge := case
      when v_cand.charge->>'source' = 'incoming' and (v_cand.charge->>'index') ~ '^[0-9]+$'
        then v_new_ids[(v_cand.charge->>'index')::integer + 1]
      else nullif(v_cand.charge->>'id', '')::uuid
    end;
    v_refund := case
      when v_cand.refund->>'source' = 'incoming' and (v_cand.refund->>'index') ~ '^[0-9]+$'
        then v_new_ids[(v_cand.refund->>'index')::integer + 1]
      else nullif(v_cand.refund->>'id', '')::uuid
    end;

    if v_charge is null or v_refund is null or v_charge = v_refund then
      v_refund_skipped := v_refund_skipped + 1;
      continue;
    end if;

    select count(*) into v_count
    from public.finance_transactions t
    where t.id in (v_charge, v_refund) and t.user_id = v_user and t.account_id = p_account_id;
    if v_count <> 2 then
      raise exception 'finance: ein Retouren-Vorschlag nennt eine fremde Buchung' using errcode = '42501';
    end if;

    -- The identity of a refund proposal is the PAIR, sorted — not the direction
    -- it was proposed in. Which side is the purchase follows from the sign and
    -- is therefore deterministic; keying on the sorted pair means that even a
    -- proposal arriving the other way round cannot become a second, contradictory
    -- relation over the same two bookings.
    v_key := md5('refund_candidate|' || public.finance_uuid_key(array[v_charge, v_refund]));
    v_relation_id := null;
    insert into public.finance_transaction_relations (
      user_id, import_id, relation_type, status, cardinality, reason, evidence, relation_key
    ) values (
      v_user, p_import_id, 'refund_candidate', 'proposed', 1,
      left(coalesce(nullif(btrim(v_cand.reason), ''), 'Gleiche Referenz, entgegengesetzter Betrag.'), 1000),
      jsonb_build_object('reference', v_cand.reference, 'purchase', v_charge, 'refund', v_refund),
      v_key
    )
    on conflict (user_id, relation_key) do nothing
    returning id into v_relation_id;

    if v_relation_id is not null then
      insert into public.finance_transaction_relation_members (user_id, relation_id, relation_type, transaction_id, role)
      values (v_user, v_relation_id, 'refund_candidate', v_charge, 'purchase'),
             (v_user, v_relation_id, 'refund_candidate', v_refund, 'refund');
      v_refund_rel := v_refund_rel + 1;
    end if;
  end loop;

  -- ── 6. the import is done ──
  v_result := jsonb_build_object(
    'import_id',                    p_import_id,
    'account_id',                   p_account_id,
    'decisions',                    v_booking_count,
    'transactions_created',         v_created,
    'observations_created',         v_obs,
    'supersessions_confirmed',      v_rel_confirmed,
    'supersessions_proposed',       v_rel_proposed,
    'analytics_excluded',           v_excluded,
    'refund_candidates_created',    v_refund_rel,
    'refund_candidates_skipped',    v_refund_skipped,
    'review_items_created',         v_review,
    'outcomes', coalesce((
      select jsonb_object_agg(o.outcome, o.n)
      from (
        select d2.outcome, count(*) as n
        from jsonb_to_recordset(p_decisions) as d2(outcome text)
        group by d2.outcome
      ) o
    ), '{}'::jsonb),
    'replayed', false
  );

  update public.finance_imports
  set status = 'imported',
      imported_at = coalesce(imported_at, now()),
      apply_result = v_result
  where id = p_import_id and user_id = v_user;

  return v_result;
end;
$$;

revoke all on function public.finance_apply_reconciliation_plan(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.finance_apply_reconciliation_plan(uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated;

revoke all on function public.finance_owns_transactions(uuid[])      from public, anon;
revoke all on function public.finance_transaction_protected(uuid)    from public, anon;
grant execute on function public.finance_owns_transactions(uuid[])   to authenticated;
grant execute on function public.finance_transaction_protected(uuid) to authenticated;
grant execute on function public.finance_uuid_key(uuid[])            to authenticated;

-- ── Realtime: still deliberately not yet ────────────────────────────────────
-- Same reason as in 0008. Nothing subscribes to these tables; the publication
-- belongs in the migration that brings the import screen.
