-- Mind Whiteboard — Datenkontrolle (0015), gegen das echte Schema geprüft.
--
-- Zwei Vorgänge, und jeder von ihnen macht eine Zusage, die sich nur in einer
-- Datenbank prüfen lässt, weil sie über Fremdschlüssel und Policies läuft:
--
--   EINE BUCHUNG LÖSCHEN
--     • ihr Override, ihr KI-Vorschlag, ihre Beobachtungen und Sichtungen und
--       ihre Verknüpfungen verschwinden mit ihr;
--     • der IMPORT bleibt — mitsamt `source_hash`, also bleibt dieselbe Datei
--       „schon eingelesen";
--     • das KI-GEDÄCHTNIS bleibt, `source_transaction_id` wird `null`;
--     • Händler, Muster und Kategorieregeln bleiben unberührt;
--     • eine fremde Buchung lässt sich nicht löschen, und ohne Anmeldung
--       gar nichts.
--
--   DEN FINANZBEREICH ZURÜCKSETZEN
--     • alle eigenen Finanzdaten auf 0, die Standardtaxonomie vollständig
--       zurück (9 + 26 = 35);
--     • ein zweiter Nutzer bleibt Zeile für Zeile unberührt;
--     • zweimal ausgeführt dasselbe Ergebnis;
--     • `anon` darf die Funktion nicht einmal aufrufen.
--
-- Die Prüfungen, die eine Gegenprobe in tools/rlsTest.mjs scharf stellen soll,
-- melden sich mit `DATAFAIL:` — die Ausnahmebehandlung in den Abschnitten unten
-- filtert nach diesem Wort und darf es deshalb in ihren eigenen Meldungen nicht
-- verwenden (derselbe Grund wie in finance_category_hierarchy.sql).
--
-- Alles läuft in einer Transaktion, die mit ROLLBACK endet.
--
-- Zwei Wege, sie auszuführen:
--   • Supabase Dashboard → SQL Editor → einfügen → Run.
--   • Lokal gegen ein Wegwerf-Postgres: `npm run test:rls`.

begin;

do $$
declare
  user_a    uuid := gen_random_uuid();
  user_b    uuid := gen_random_uuid();
  acct_a    uuid;
  acct_b    uuid;
  imp_a     uuid;
  tx_manual uuid;
  tx_import uuid;
  tx_other  uuid;
  tx_b      uuid;
  merch_a   uuid;
  pat_a     uuid;
  rule_a    uuid;
  cat_leaf  uuid;
  obs_a     uuid;
  rel_a     uuid;
  rev_open  uuid;
  rev_done  uuid;
  mem_a     uuid;
  fingerprint_b_before text;
  fingerprint_b_after  text;
  n         integer;
  caught    text;
  result    jsonb;
begin
  -- ── Ausgangslage ──────────────────────────────────────────────────────────
  insert into auth.users (id, email) values
    (user_a, 'data-a@mindwhiteboard.test'),
    (user_b, 'data-b@mindwhiteboard.test');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  select id into cat_leaf from public.finance_categories
    where user_id = user_a and slug = 'lebensmittel';
  if cat_leaf is null then
    raise exception 'DATA: die Taxonomie von user_a fehlt';
  end if;

  insert into public.finance_accounts (user_id, name, currency)
    values (user_a, 'Girokonto', 'EUR') returning id into acct_a;

  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash, status)
    values (user_a, acct_a, 'pdf', 'Auszug 09-2026.pdf', 'hash-september', 'imported')
    returning id into imp_a;

  insert into public.finance_merchants (user_id, canonical_name)
    values (user_a, 'REWE') returning id into merch_a;
  insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
    values (user_a, merch_a, 'exact_token', array['REWE']) returning id into pat_a;
  insert into public.finance_category_rules (user_id, merchant_id, category_id)
    values (user_a, merch_a, cat_leaf) returning id into rule_a;

  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, date '2026-09-01', -1200, 'EUR', 'Von Hand', array['VON','HAND'])
    returning id into tx_manual;

  insert into public.finance_transactions
    (user_id, account_id, import_id, booking_date, amount_minor, currency, raw_description,
     normalized_tokens, merchant_id, category_id)
    values (user_a, acct_a, imp_a, date '2026-09-02', -2500, 'EUR', 'REWE FRANKFURT',
            array['REWE','FRANKFURT'], merch_a, cat_leaf)
    returning id into tx_import;

  insert into public.finance_transactions
    (user_id, account_id, import_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, imp_a, date '2026-09-03', -2500, 'EUR', 'EDEKA MITTE', array['EDEKA','MITTE'])
    returning id into tx_other;

  -- Was ausschließlich an tx_import hängt.
  insert into public.finance_transaction_overrides (user_id, transaction_id, category_id, note)
    values (user_a, tx_import, cat_leaf, 'von Hand entschieden');
  insert into public.finance_transaction_ai_suggestions
    (user_id, transaction_id, import_id, merchant_name, category_id)
    values (user_a, tx_import, imp_a, 'REWE', cat_leaf);
  insert into public.finance_transaction_observations
    (user_id, transaction_id, import_id, observed_description)
    values (user_a, tx_import, imp_a, 'REWE FRANKFURT HAUPTWACHE')
    returning id into obs_a;
  insert into public.finance_transaction_observation_sightings (user_id, observation_id, import_id)
    values (user_a, obs_a, imp_a);

  -- Eine Relation über zwei Buchungen, und ein Prüfposten über eine.
  insert into public.finance_transaction_relations
    (user_id, import_id, relation_type, status, relation_key)
    values (user_a, imp_a, 'supersession', 'proposed', 'rel-1') returning id into rel_a;
  insert into public.finance_transaction_relation_members
    (user_id, relation_id, relation_type, transaction_id, role)
    values (user_a, rel_a, 'supersession', tx_other, 'predecessor'),
           (user_a, rel_a, 'supersession', tx_import, 'replacement');

  insert into public.finance_import_review_items
    (user_id, import_id, account_id, item_type, status, reason, item_key)
    values (user_a, imp_a, acct_a, 'unresolved_match', 'open', 'Zuordnung unklar', 'item-open')
    returning id into rev_open;
  insert into public.finance_import_review_item_transactions (user_id, review_item_id, transaction_id)
    values (user_a, rev_open, tx_import);

  insert into public.finance_import_review_items
    (user_id, import_id, account_id, item_type, status, reason, item_key, resolved_at, resolution)
    values (user_a, imp_a, acct_a, 'manual_review', 'resolved', 'schon beantwortet', 'item-done',
            now(), 'erledigt')
    returning id into rev_done;
  insert into public.finance_import_review_item_transactions (user_id, review_item_id, transaction_id)
    values (user_a, rev_done, tx_import);

  -- Global Gelerntes, das die Buchung überleben muss.
  insert into public.finance_ai_learning_memories
    (user_id, kind, merchant_name, merchant_key, category_id, source_transaction_id, example_key)
    values (user_a, 'merchant_rule', 'REWE', 'rewe', cat_leaf, tx_import, 'mem-1')
    returning id into mem_a;

  -- ── 1. Eine eigene manuelle Buchung löschen ───────────────────────────────
  if public.finance_delete_transaction(tx_manual) is distinct from tx_manual then
    raise exception 'DATA: das Löschen meldet eine andere Buchung zurück';
  end if;

  select count(*) into n from public.finance_transactions where id = tx_manual;
  if n <> 0 then
    raise exception 'DATAFAIL: die geloeschte Buchung ist noch da';
  end if;

  -- ── 2. Eine importierte Buchung löschen ───────────────────────────────────
  perform public.finance_delete_transaction(tx_import);

  select count(*) into n from public.finance_transactions where id = tx_import;
  if n <> 0 then
    raise exception 'DATAFAIL: die importierte Buchung ist noch da';
  end if;

  -- 2a) Der Import bleibt, mit seinem Hash.
  select count(*) into n from public.finance_imports
    where id = imp_a and user_id = user_a and source_hash = 'hash-september';
  if n <> 1 then
    raise exception 'DATAFAIL: der Import wurde mitgeloescht (% Zeilen)', n;
  end if;

  -- 2b) Was nur an dieser Buchung hing, ist weg.
  select count(*) into n from public.finance_transaction_overrides where transaction_id = tx_import;
  if n <> 0 then
    raise exception 'DATAFAIL: der Override der Buchung ist noch da';
  end if;

  select count(*) into n from public.finance_transaction_ai_suggestions where transaction_id = tx_import;
  if n <> 0 then
    raise exception 'DATAFAIL: der KI-Vorschlag der Buchung ist noch da';
  end if;

  select count(*) into n from public.finance_transaction_observations where transaction_id = tx_import;
  if n <> 0 then
    raise exception 'DATAFAIL: die Beobachtung der Buchung ist noch da';
  end if;

  select count(*) into n from public.finance_transaction_observation_sightings where observation_id = obs_a;
  if n <> 0 then
    raise exception 'DATAFAIL: die Sichtung der Beobachtung ist noch da';
  end if;

  -- 2c) Die Relation hat ein Mitglied verloren und ist damit keine mehr.
  select count(*) into n from public.finance_transaction_relations where id = rel_a;
  if n <> 0 then
    raise exception 'DATAFAIL: die Relation ueberlebt den Verlust ihrer zweiten Seite';
  end if;
  select count(*) into n from public.finance_transaction_relation_members where relation_id = rel_a;
  if n <> 0 then
    raise exception 'DATAFAIL: es haengen noch Relationsmitglieder herum';
  end if;
  -- …und die andere Buchung ist geblieben.
  select count(*) into n from public.finance_transactions where id = tx_other;
  if n <> 1 then
    raise exception 'DATAFAIL: die zweite Buchung der Relation wurde mitgenommen';
  end if;

  -- 2d) Der OFFENE Prüfposten ohne Buchung ist weg, der beantwortete bleibt.
  select count(*) into n from public.finance_import_review_items where id = rev_open;
  if n <> 0 then
    raise exception 'DATAFAIL: ein offener Pruefposten ohne Buchung bleibt stehen';
  end if;
  select count(*) into n from public.finance_import_review_items where id = rev_done;
  if n <> 1 then
    raise exception 'DATAFAIL: ein beantworteter Pruefposten wurde geloescht';
  end if;

  -- 2e) Das Gedächtnis bleibt, nur der Rückverweis fällt weg.
  select count(*) into n from public.finance_ai_learning_memories
    where id = mem_a and source_transaction_id is null and category_id = cat_leaf;
  if n <> 1 then
    raise exception 'DATAFAIL: das KI-Gedaechtnis hat das Loeschen nicht unveraendert ueberlebt';
  end if;

  -- 2f) Händler, Muster und Regel sind unberührt.
  select count(*) into n from public.finance_merchants where id = merch_a;
  if n <> 1 then raise exception 'DATAFAIL: der Haendler wurde mitgeloescht'; end if;
  select count(*) into n from public.finance_merchant_patterns where id = pat_a and active;
  if n <> 1 then raise exception 'DATAFAIL: das Muster wurde mitgeloescht'; end if;
  select count(*) into n from public.finance_category_rules where id = rule_a;
  if n <> 1 then raise exception 'DATAFAIL: die Kategorieregel wurde mitgeloescht'; end if;

  -- 2g) Und das Konto steht noch.
  select count(*) into n from public.finance_accounts where id = acct_a;
  if n <> 1 then raise exception 'DATAFAIL: das Konto wurde mitgeloescht'; end if;

  -- 2h) Die aufgeschobenen Prüfungen, JETZT.
  --
  -- `finance_relation_members_coherent` (0009) ist ein `constraint trigger …
  -- deferrable initially deferred`: er feuert erst beim COMMIT. Diese Suite
  -- endet mit ROLLBACK, also feuerte er hier nie — und eine Relation, die nach
  -- dem Löschen einseitig zurückbliebe, wäre unbemerkt durchgegangen, während
  -- sie in der echten App beim Commit knallt. `set constraints all immediate`
  -- holt genau diesen Moment in den Test.
  set constraints all immediate;
  set constraints all deferred;

  -- ── 3. Eine fremde Buchung lässt sich nicht löschen ───────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  insert into public.finance_accounts (user_id, name, currency)
    values (user_b, 'Konto B', 'EUR') returning id into acct_b;
  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_b, acct_b, date '2026-09-05', -999, 'EUR', 'B BUCHUNG', array['B','BUCHUNG'])
    returning id into tx_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  caught := null;
  begin
    perform public.finance_delete_transaction(tx_b);
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then
    raise exception 'DATAFAIL: eine fremde Buchung liess sich loeschen';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.finance_transactions where id = tx_b;
  if n <> 1 then
    raise exception 'DATAFAIL: die fremde Buchung ist trotzdem verschwunden';
  end if;

  -- ── 4. Ohne Anmeldung gar nichts ──────────────────────────────────────────
  perform set_config('request.jwt.claims', '{}', true);
  caught := null;
  begin
    perform public.finance_delete_transaction(tx_b);
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then
    raise exception 'DATAFAIL: ohne angemeldeten Benutzer liess sich etwas loeschen';
  end if;

  caught := null;
  begin
    perform public.finance_reset_user_data();
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then
    raise exception 'DATAFAIL: ohne angemeldeten Benutzer liess sich zuruecksetzen';
  end if;

  -- ── 5. `anon` darf die Funktionen nicht einmal aufrufen ───────────────────
  execute 'set local role anon';
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'anon')::text, true);
  caught := null;
  begin
    perform public.finance_reset_user_data();
  exception when others then
    caught := sqlstate;
  end;
  if caught is distinct from '42501' then
    raise exception 'DATAFAIL: anon bekam beim Zuruecksetzen % statt einer Rechteverweigerung',
      coalesce(caught, 'keinen Fehler');
  end if;

  caught := null;
  begin
    perform public.finance_delete_transaction(tx_b);
  exception when others then
    caught := sqlstate;
  end;
  if caught is distinct from '42501' then
    raise exception 'DATAFAIL: anon bekam beim Loeschen % statt einer Rechteverweigerung',
      coalesce(caught, 'keinen Fehler');
  end if;
  execute 'set local role authenticated';

  -- ── 6. Zurücksetzen: user_b bekommt eigene Daten, damit er etwas zu ───────
  --      verlieren hätte.
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  insert into public.finance_merchants (user_id, canonical_name) values (user_b, 'EDEKA');
  insert into public.finance_imports (user_id, account_id, source_type, source_hash, status)
    values (user_b, acct_b, 'pdf', 'hash-b', 'imported');

  select md5(string_agg(x, ',' order by x)) into fingerprint_b_before from (
    select t.id::text || ':' || t.amount_minor::text from public.finance_transactions t
      where t.user_id = user_b
    union all
    select 'a:' || a.id::text || ':' || a.name from public.finance_accounts a where a.user_id = user_b
    union all
    select 'm:' || m.id::text || ':' || m.canonical_name from public.finance_merchants m where m.user_id = user_b
    union all
    select 'i:' || i.id::text from public.finance_imports i where i.user_id = user_b
    union all
    select 'c:' || c.id::text || ':' || c.slug || ':' || c.label || ':' || coalesce(c.parent_id::text, '-')
      from public.finance_categories c where c.user_id = user_b
  ) as rows(x);

  -- ── 7. user_a setzt zurück ────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  result := public.finance_reset_user_data();

  if (result ->> 'categories')::int <> 35 then
    raise exception 'DATA: der Reset meldet % Kategorien statt 35', result ->> 'categories';
  end if;
  if (result ->> 'accounts')::int <> 1 then
    raise exception 'DATA: der Reset meldet % geloeschte Konten statt 1', result ->> 'accounts';
  end if;

  -- 7a) Nichts Eigenes mehr — jede einzelne Tabelle.
  select
    (select count(*) from public.finance_accounts where user_id = user_a)
  + (select count(*) from public.finance_imports where user_id = user_a)
  + (select count(*) from public.finance_transactions where user_id = user_a)
  + (select count(*) from public.finance_transaction_observations where user_id = user_a)
  + (select count(*) from public.finance_transaction_observation_sightings where user_id = user_a)
  + (select count(*) from public.finance_transaction_relations where user_id = user_a)
  + (select count(*) from public.finance_transaction_relation_members where user_id = user_a)
  + (select count(*) from public.finance_import_review_items where user_id = user_a)
  + (select count(*) from public.finance_import_review_item_transactions where user_id = user_a)
  + (select count(*) from public.finance_transaction_overrides where user_id = user_a)
  + (select count(*) from public.finance_transaction_ai_suggestions where user_id = user_a)
  + (select count(*) from public.finance_ai_learning_memories where user_id = user_a)
  + (select count(*) from public.finance_merchants where user_id = user_a)
  + (select count(*) from public.finance_merchant_patterns where user_id = user_a)
  + (select count(*) from public.finance_category_rules where user_id = user_a)
  into n;
  if n <> 0 then
    raise exception 'DATAFAIL: nach dem Zuruecksetzen stehen noch % eigene Finanzzeilen da', n;
  end if;

  -- 7b) Die Taxonomie ist vollständig zurück.
  select count(*) into n from public.finance_categories where user_id = user_a;
  if n <> 35 then
    raise exception 'DATAFAIL: nach dem Zuruecksetzen gibt es % Kategorien statt 35', n;
  end if;
  select count(*) into n from public.finance_categories where user_id = user_a and parent_id is null;
  if n <> 9 then
    raise exception 'DATAFAIL: % Oberkategorien statt 9', n;
  end if;
  select count(*) into n from public.finance_categories where user_id = user_a and parent_id is not null;
  if n <> 26 then
    raise exception 'DATAFAIL: % Unterkategorien statt 26', n;
  end if;

  -- 7c) Keine dritte Ebene, keine fremden Eltern, ausgelieferte Labels.
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = user_a and p.parent_id is not null;
  if n <> 0 then
    raise exception 'DATAFAIL: nach dem Zuruecksetzen gibt es eine dritte Ebene';
  end if;

  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = user_a and p.user_id <> c.user_id;
  if n <> 0 then
    raise exception 'DATAFAIL: eine Kategorie haengt unter einem fremden Elternteil';
  end if;

  select count(*) into n
  from public.finance_categories c
  join public.finance_category_taxonomy() t on t.slug = c.slug
  where c.user_id = user_a and c.label is distinct from t.label;
  if n <> 0 then
    raise exception 'DATAFAIL: % Kategorien tragen nach dem Zuruecksetzen nicht das Standard-Label', n;
  end if;

  -- 7d) Keine tote Referenz — nichts zeigt mehr auf eine Zeile, die es nicht gibt.
  select count(*) into n
  from public.finance_categories c
  where c.user_id = user_a and c.parent_id is not null
    and not exists (select 1 from public.finance_categories p where p.id = c.parent_id);
  if n <> 0 then
    raise exception 'DATAFAIL: eine Kategorie zeigt auf ein Elternteil, das es nicht gibt';
  end if;

  -- ── 8. user_b ist Zeile für Zeile unberührt ──────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select md5(string_agg(x, ',' order by x)) into fingerprint_b_after from (
    select t.id::text || ':' || t.amount_minor::text from public.finance_transactions t
      where t.user_id = user_b
    union all
    select 'a:' || a.id::text || ':' || a.name from public.finance_accounts a where a.user_id = user_b
    union all
    select 'm:' || m.id::text || ':' || m.canonical_name from public.finance_merchants m where m.user_id = user_b
    union all
    select 'i:' || i.id::text from public.finance_imports i where i.user_id = user_b
    union all
    select 'c:' || c.id::text || ':' || c.slug || ':' || c.label || ':' || coalesce(c.parent_id::text, '-')
      from public.finance_categories c where c.user_id = user_b
  ) as rows(x);

  if fingerprint_b_after is distinct from fingerprint_b_before then
    raise exception 'DATAFAIL: der Reset von user_a hat die Daten von user_b veraendert';
  end if;

  -- ── 9. Zweimal zurücksetzen ist dasselbe wie einmal ──────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  result := public.finance_reset_user_data();
  if (result ->> 'categories')::int <> 35 then
    raise exception 'DATAFAIL: der zweite Reset meldet % Kategorien statt 35', result ->> 'categories';
  end if;
  if (result ->> 'accounts')::int <> 0 then
    raise exception 'DATA: der zweite Reset will % Konten geloescht haben', result ->> 'accounts';
  end if;
  select count(*) into n from public.finance_categories where user_id = user_a;
  if n <> 35 then
    raise exception 'DATAFAIL: nach dem zweiten Reset gibt es % Kategorien statt 35', n;
  end if;

  -- ── 10. Nichts außerhalb von finance_* wurde angefasst ───────────────────
  -- Aufgaben sind das Modul mit der einfachsten Zeile; steht sie danach noch
  -- da, hat der Reset seinen Bereich nicht verlassen.
  insert into public.tasks (user_id, title) values (user_a, 'Aufgabe bleibt');
  result := public.finance_reset_user_data();
  select count(*) into n from public.tasks where user_id = user_a and title = 'Aufgabe bleibt';
  if n <> 1 then
    raise exception 'DATAFAIL: der Reset hat ausserhalb von finance_* geloescht';
  end if;

  raise notice 'DATA: all assertions passed';
end
$$;

select 'DATA: all assertions passed' as result;

rollback;
