-- Der Stand VOR 0014: eine Datenbank, auf der seit Wochen gearbeitet wurde.
--
-- Läuft nach 0013 und vor 0014 (tools/rlsTest.mjs). Er legt genau das an, was
-- die Migration nicht anfassen darf — fünf flache Kategorien und je einen
-- Fremdschlüssel aus jeder Tabelle, die auf sie zeigt — und schreibt den
-- Ist-Zustand in eine Tabelle, damit `finance_category_upgrade_verify.sql`
-- danach nicht glauben muss, sondern vergleichen kann.
--
-- ZWEI BENUTZER, WEIL ES ZWEI FÄLLE GIBT: einer hat seine Kategorien nie
-- angefasst (seine drei Labels werden von 0014 umbenannt), der andere hat
-- „Restaurant" selbst in „Auswärts essen" umbenannt (sein Name muss bleiben).

create table if not exists public._cat_upgrade_before (
  what     text primary key,
  category uuid not null
);

do $$
declare
  u1    uuid := '00000000-0000-4000-8000-000000000101'::uuid;
  u2    uuid := '00000000-0000-4000-8000-000000000202'::uuid;
  acct  uuid;
  merch uuid;
  tx    uuid;
  sug   uuid;
  c     record;
begin
  insert into auth.users (id, email) values
    (u1, 'up1@mindwhiteboard.test'),
    (u2, 'up2@mindwhiteboard.test');

  -- Vor 0014 sind es genau fünf, und sie sind flach.
  if (select count(*) from public.finance_categories where user_id = u1) <> 5 then
    raise exception 'SEED: der Ausgangsstand hat nicht fünf Kategorien';
  end if;

  -- Die fünf IDs, festgehalten.
  for c in select slug, id from public.finance_categories where user_id = u1
  loop
    insert into public._cat_upgrade_before (what, category)
    values ('cat:' || c.slug, c.id);
  end loop;

  -- Jede Tabelle, die auf eine Kategorie zeigt, bekommt eine Zeile.
  insert into public.finance_accounts (user_id, name) values (u1, 'Girokonto')
    returning id into acct;
  insert into public.finance_merchants (user_id, canonical_name) values (u1, 'REWE')
    returning id into merch;
  insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
    values (u1, merch, 'exact_token', array['REWE']);

  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description,
     normalized_tokens, category_id)
  values (u1, acct, '2026-08-10', -1438, 'EUR', 'REWE TROISDORF',
          array['REWE','TROISDORF'],
          (select category from public._cat_upgrade_before where what = 'cat:lebensmittel'))
  returning id into tx;
  insert into public._cat_upgrade_before (what, category)
    select 'tx', category from public._cat_upgrade_before where what = 'cat:lebensmittel';

  insert into public.finance_category_rules (user_id, merchant_id, category_id)
  values (u1, merch,
          (select category from public._cat_upgrade_before where what = 'cat:restaurant'));
  insert into public._cat_upgrade_before (what, category)
    select 'rule', category from public._cat_upgrade_before where what = 'cat:restaurant';

  insert into public.finance_transaction_overrides (user_id, transaction_id, category_id)
  values (u1, tx,
          (select category from public._cat_upgrade_before where what = 'cat:klamotten'));
  insert into public._cat_upgrade_before (what, category)
    select 'override', category from public._cat_upgrade_before where what = 'cat:klamotten';

  insert into public.finance_transaction_ai_suggestions
    (user_id, transaction_id, merchant_name, category_id)
  values (u1, tx, 'REWE',
          (select category from public._cat_upgrade_before where what = 'cat:drogerie'))
  returning id into sug;
  insert into public._cat_upgrade_before (what, category)
    select 'suggestion', category from public._cat_upgrade_before where what = 'cat:drogerie';

  insert into public.finance_ai_learning_memories
    (user_id, kind, merchant_name, merchant_key, category_id, suggested_category_id)
  values (u1, 'merchant_rule', 'REWE', public.finance_memory_key('REWE'),
          (select category from public._cat_upgrade_before where what = 'cat:sonstige'),
          (select category from public._cat_upgrade_before where what = 'cat:restaurant'));
  insert into public._cat_upgrade_before (what, category)
    select 'memory', category from public._cat_upgrade_before where what = 'cat:sonstige';

  -- Der zweite Benutzer hat selbst umbenannt.
  update public.finance_categories
     set label = 'Auswärts essen'
   where user_id = u2 and slug = 'restaurant';
end
$$;
