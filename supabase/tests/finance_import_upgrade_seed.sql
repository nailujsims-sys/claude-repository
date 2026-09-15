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
  v_user uuid;
  v_acct uuid;
  v_tx   uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'upgrade@mindwhiteboard.test')
    returning id into v_user;
  insert into public.finance_accounts (user_id, name, provider) values (v_user, 'Bestandskonto', 'DKB')
    returning id into v_acct;
  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens, manual_lock)
    values (v_user, v_acct, '2026-08-01', -2483, 'EUR', 'REWE TROISDORF SAGT DANKE 8407',
            array['REWE','TROISDORF','SAGT','DANKE','8407'], true)
    returning id into v_tx;
  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens, include_in_analytics)
    values (v_user, v_acct, '2026-08-02', -1000, 'EUR', 'Selbst ausgeschlossen', array['SELBST'], false);
  insert into public.finance_transaction_overrides (user_id, transaction_id, include_in_analytics, note)
    values (v_user, v_tx, false, 'Von Hand entschieden.');
  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash, status)
    values (v_user, v_acct, 'pdf', 'Alt.pdf', 'alt-hash', 'imported');
end
$$;

commit;

select 'FINANCE-UPGRADE-SEED: ok' as result;
