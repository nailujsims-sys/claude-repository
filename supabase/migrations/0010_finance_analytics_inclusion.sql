-- 0010_finance_analytics_inclusion — „zählt diese Buchung?", einmal beantwortet.
--
-- Three places can have an opinion about whether a booking belongs in a
-- spending total, and until now only one of them was ever asked:
--
--   • the booking itself      (`finance_transactions.include_in_analytics`,
--                              written by the import)
--   • the user, about one     (`finance_transaction_overrides.include_in_analytics`,
--     booking                  there since 0008 and never read by anything)
--   • the user, about a       ← THIS MIGRATION
--     merchant
--
-- The third one is what production asked for: Scalable Capital is a transfer
-- into one's own portfolio, not spending, and saying so once must also cover
-- every future booking of it. A per-booking decision cannot do that, and
-- rewriting thousands of rows at import time would be the wrong shape — the
-- statement is about the merchant, so it lives on the merchant.
--
-- WHAT THIS MIGRATION IS CAREFUL ABOUT
--
--   1. It is additive. One column with a default, one function, one view
--      replaced. No booking is rewritten, no row is deleted, nothing that
--      exists changes meaning.
--   2. „Nicht berücksichtigen" NEVER means deleted. The booking, its raw text,
--      its observations and its reconciliation history stay exactly as they
--      are; only the interpretation changes, and it is reversible at any time.
--   3. The view and the client must not be able to disagree. Both now resolve
--      inclusion by the SAME four-step rule (see below), and
--      tools/financeAnalyticsE2E.mjs checks the two implementations against
--      each other on the same rows rather than trusting that they match.
--
-- THE RULE, in the one order that makes sense:
--
--   1. an explicit decision about THIS booking          (the override)
--   2. the default of the merchant, IF it is unambiguous
--   3. what the import wrote on the booking
--   4. true
--
-- Step 2 deliberately does not read `finance_transactions.merchant_id`. Since
-- 0008 the pattern engine is the authority on which merchant a booking belongs
-- to — a booking imported before a rule existed carries no merchant id and must
-- still follow that merchant's default, and a booking two merchants claim has
-- no unambiguous default to follow. The column is a cache of a past answer; the
-- patterns are the answer.

-- ── The merchant's own default ──────────────────────────────────────────────
-- `default_` says what it is: the answer used when the booking itself says
-- nothing. `review_mode` next to it is the other merchant-level default, and
-- reads the same way.
alter table public.finance_merchants
  add column if not exists default_include_in_analytics boolean not null default true;

comment on column public.finance_merchants.default_include_in_analytics is
  'Zählen Buchungen dieses Händlers in Auswertungen? Default für jede Buchung, '
  'die selbst nichts anderes sagt. Ein Override auf der Buchung gewinnt.';

-- Existing merchants keep counting — the column's default already says so, and
-- this states it for a row that somehow predates the default.
update public.finance_merchants
set default_include_in_analytics = true
where default_include_in_analytics is null;

-- ── Which merchant a set of tokens belongs to, unambiguously ────────────────
-- The same rule as src/lib/finance/merchantMatching.js, in the same spirit: one
-- merchant or none. Two merchants claiming the same booking is a conflict, and
-- a conflict has no default to inherit — guessing one here would be the
-- specificity ranking the engine deliberately does not have.
--
-- `stable` rather than `immutable`: it reads tables. `security invoker` by
-- omission, so the caller's RLS decides which patterns it can see — a user
-- can never inherit a default from somebody else's merchant.
create or replace function public.finance_unique_merchant(p_tokens text[])
returns uuid
language sql
stable
set search_path = ''
as $$
  -- Exactly one, or nothing. `array_agg` rather than an aggregate over uuid,
  -- because Postgres has no min(uuid) — and picking a "smallest" merchant would
  -- be the tie-break this rule refuses to make anyway.
  select case when array_length(ids, 1) = 1 then ids[1] end
  from (
    select array_agg(distinct mp.merchant_id) as ids
    from public.finance_merchant_patterns mp
    where mp.active
      and public.finance_pattern_matches(mp.pattern_type, mp.tokens, p_tokens)
  ) p;
$$;

-- ── The four steps, as one answer ──────────────────────────────────────────
create or replace function public.finance_effective_include_in_analytics(
  p_override_include boolean,
  p_merchant_default boolean,
  p_transaction_include boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_override_include, p_merchant_default, p_transaction_include, true);
$$;

-- ── The analytics basis ────────────────────────────────────────────────────
-- 0009 built this view on `t.include_in_analytics` alone, which was the only
-- opinion that existed then. It now asks all three, in order, and keeps the
-- supersession filter unchanged: a provisional booking that a later export
-- replaced must not be counted twice, whatever anybody thinks of it.
create or replace view public.finance_analytics_transactions
with (security_invoker = true) as
select t.*
from public.finance_transactions t
left join public.finance_transaction_overrides o on o.transaction_id = t.id
left join lateral (
  select m.default_include_in_analytics
  from public.finance_merchants m
  where m.id = public.finance_unique_merchant(t.normalized_tokens)
) mm on true
where public.finance_effective_include_in_analytics(
        o.include_in_analytics, mm.default_include_in_analytics, t.include_in_analytics)
  and not exists (
    select 1
    from public.finance_transaction_relation_members rm
    join public.finance_transaction_relations r on r.id = rm.relation_id
    where rm.transaction_id = t.id
      and rm.role = 'predecessor'
      and r.relation_type = 'supersession'
      and r.status = 'confirmed'
  );

-- ── Grants ─────────────────────────────────────────────────────────────────
-- The view keeps the grants 0009 gave it; `create or replace view` preserves
-- them, and these two lines make that explicit rather than assumed.
revoke all on public.finance_analytics_transactions from anon;
grant select on public.finance_analytics_transactions to authenticated;

revoke all on function public.finance_unique_merchant(text[]) from public, anon;
grant execute on function public.finance_unique_merchant(text[]) to authenticated;
revoke all on function public.finance_effective_include_in_analytics(boolean, boolean, boolean)
  from public, anon;
grant execute on function public.finance_effective_include_in_analytics(boolean, boolean, boolean)
  to authenticated;

-- RLS on finance_merchants is unchanged: the four policies of 0008 are per row,
-- so the new column is covered by them the moment it exists. No policy is
-- touched here, which is also the point — a migration that rewrites a policy is
-- the quietest way to weaken one.
