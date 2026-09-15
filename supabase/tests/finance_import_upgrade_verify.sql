-- Does 0009 leave an existing Finanzen database alone?
--
-- The other two suites run against a schema that was built in one go. This pair
-- answers the question production actually asks: 0008 has been applied, there is
-- data under it, and 0009 arrives. It must add and change nothing else — not a
-- booking, not a manual decision, not a policy.
--
-- Run by tools/rlsTest.mjs against a second database, in three steps:
--   1. migrations 0001-0008, then finance_import_upgrade_seed.sql
--   2. migration 0009, twice
--   3. finance_import_upgrade_verify.sql
--
-- The seed is deliberately the awkward kind of data: a locked booking, a booking
-- the user excluded themselves, an override, an import already marked applied.
-- Exactly the rows a careless migration would disturb.

begin;

do $$
declare
  n           integer;
  fingerprint text;
begin
  select count(*) into n from public.finance_transactions;
  if n <> 2 then raise exception 'FAIL: 0009 hat die Buchungen verändert (% statt 2)', n; end if;

  select count(*) into n from public.finance_transactions
   where raw_description = 'REWE TROISDORF SAGT DANKE 8407' and amount_minor = -2483
     and currency = 'EUR' and booking_date = '2026-08-01' and manual_lock;
  if n <> 1 then raise exception 'FAIL: 0009 hat die gesperrte Buchung angefasst'; end if;

  select count(*) into n from public.finance_transactions
   where raw_description = 'Selbst ausgeschlossen' and include_in_analytics = false;
  if n <> 1 then raise exception 'FAIL: 0009 hat eine selbst ausgeschlossene Buchung wieder eingeschaltet'; end if;

  select count(*) into n from public.finance_transaction_overrides where include_in_analytics = false;
  if n <> 1 then raise exception 'FAIL: 0009 hat einen Override verändert'; end if;

  select count(*) into n from public.finance_imports where source_hash = 'alt-hash' and status = 'imported';
  if n <> 1 then raise exception 'FAIL: 0009 hat einen bestehenden Import verändert'; end if;

  -- Die neuen Spalten sind da und leer — additiv heißt: nichts erfunden.
  select count(*) into n from public.finance_imports
   where apply_result is null and period_start is null and period_end is null;
  if n <> 1 then raise exception 'FAIL: 0009 hat die neuen Import-Spalten befüllt'; end if;

  -- Die vier Policies aus 0008 stehen unverändert auf jeder Tabelle, die es
  -- schon gab. Eine Migration, die eine davon versehentlich ersetzt, wäre die
  -- unauffälligste Art, RLS zu schwächen.
  for fingerprint in
    select t.tablename
    from pg_tables t
    where t.schemaname = 'public' and t.tablename like 'finance\_%'
      and t.tablename in (
        'finance_accounts','finance_categories','finance_merchants','finance_merchant_patterns',
        'finance_category_rules','finance_imports','finance_transactions','finance_transaction_overrides'
      )
  loop
    select count(*) into n from pg_policies p
    where p.schemaname = 'public' and p.tablename = fingerprint;
    if n <> 4 then
      raise exception 'FAIL: % hat nach 0009 % Policies statt 4', fingerprint, n;
    end if;
    select count(*) into n from pg_class c
    where c.relname = fingerprint and c.relnamespace = 'public'::regnamespace and c.relrowsecurity;
    if n <> 1 then raise exception 'FAIL: RLS auf % ist nach 0009 aus', fingerprint; end if;
  end loop;

  -- Und anon kommt nach wie vor an keine einzige davon heran.
  for fingerprint in
    select unnest(array['finance_accounts','finance_transactions','finance_transaction_overrides'])
  loop
    if has_table_privilege('anon', 'public.' || fingerprint, 'select') then
      raise exception 'FAIL: anon darf nach 0009 % lesen', fingerprint;
    end if;
  end loop;

  -- Der Einfrier-Trigger aus 0008 lebt noch.
  select count(*) into n from pg_trigger
   where tgname = 'finance_transactions_freeze_raw' and not tgisinternal;
  if n <> 1 then raise exception 'FAIL: der Einfrier-Trigger aus 0008 ist weg'; end if;
end
$$;

rollback;

select 'FINANCE-UPGRADE: all assertions passed' as result;
