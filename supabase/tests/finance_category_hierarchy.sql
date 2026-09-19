-- Mind Whiteboard — die zweistufige Taxonomie, gegen das echte Schema geprüft.
--
-- 0014 macht sechs Zusagen, die sich in JavaScript nicht prüfen lassen, weil
-- jede von ihnen eine Eigenschaft der DATENBANK ist:
--
--   • KEINE ID WIRD ERSETZT — die fünf Kategorien aus 0008 behalten ihre `id`,
--     und jeder Fremdschlüssel, der vor der Migration auf sie zeigte, zeigt
--     danach auf dieselbe Zeile.
--   • GENAU ZWEI EBENEN — eine dritte lehnt die Datenbank ab, nicht der Client.
--   • NUR BLÄTTER SIND ZUORDENBAR — auf JEDEM Schreibweg, auch dem, den heute
--     noch niemand geschrieben hat.
--   • EINE OBERKATEGORIE MIT KINDERN VERSCHWINDET NICHT — und ein verwaistes
--     Kind lässt sich nie committen.
--   • EIN BENUTZER-DELETE RÄUMT TROTZDEM VOLLSTÄNDIG AUF — Eltern und Kinder
--     gemeinsam, und fremde Benutzer bleiben unberührt.
--   • JEDER NEUE BENUTZER BEKOMMT DIE VOLLSTÄNDIGE TAXONOMIE.
--
-- Der vorletzte Punkt ist der Grund, warum der Fremdschlüssel
-- `on delete no action deferrable initially deferred` ist und nicht
-- `on delete restrict`: Abschnitt 6 zeigt den Fall, in dem RESTRICT eine
-- vollkommen zulässige Transaktion abweist.
--
-- Alles läuft in einer Transaktion, die mit ROLLBACK endet — gegen Production
-- ausgeführt bleibt kein Benutzer und keine Kategorie zurück. Ausnahme ist
-- Abschnitt 7, der eigene Transaktionen braucht (siehe dort).
--
-- Zwei Wege, sie auszuführen:
--   • Supabase Dashboard → SQL Editor → einfügen → Run.
--   • Lokal gegen ein Wegwerf-Postgres: `npm run test:rls`.

begin;

do $$
declare
  user_a     uuid := gen_random_uuid();
  user_b     uuid := gen_random_uuid();
  acct_a     uuid;
  tx_a       uuid;
  sug        uuid;
  parent_id_ uuid;
  leaf_id    uuid;
  third      uuid;
  foreign_p  uuid;
  merch      uuid;
  before_ids jsonb;
  after_ids  jsonb;
  n          integer;
  caught     text;
begin
  -- ── Ausgangslage: zwei Benutzer, beide mit voller Taxonomie ───────────────
  insert into auth.users (id, email) values
    (user_a, 'cat-a@mindwhiteboard.test'),
    (user_b, 'cat-b@mindwhiteboard.test');

  execute 'set local role authenticated';

  -- Die fremde Oberkategorie wird JETZT gelesen, als user_b — unter der RLS von
  -- user_a ist sie unsichtbar, und ein `select` liefe auf NULL hinaus. Genau
  -- daran ist die erste Fassung dieses Tests vorbeigelaufen: sie fügte ein Kind
  -- mit `parent_id = null` ein, bekam eine gültige Oberkategorie und hielt das
  -- für eine bestandene Prüfung.
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select id into foreign_p from public.finance_categories
    where user_id = user_b and slug = 'shopping';
  if foreign_p is null then
    raise exception 'CATS: die Taxonomie von user_b fehlt';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  -- ── 1. Die Taxonomie ist vollständig und genau zwei Ebenen tief ───────────
  select count(*) into n from public.finance_categories where user_id = user_a;
  if n <> 35 then
    raise exception 'CATSFAIL: ein neuer Benutzer bekommt % Kategorien statt 35', n;
  end if;

  select count(*) into n
  from public.finance_categories
  where user_id = user_a and parent_id is null;
  if n <> 9 then
    raise exception 'CATS: % Oberkategorien statt 9', n;
  end if;

  select count(*) into n
  from public.finance_categories
  where user_id = user_a and parent_id is not null;
  if n <> 26 then
    raise exception 'CATS: % Unterkategorien statt 26', n;
  end if;

  -- Keine dritte Ebene: kein Kind zeigt auf eine Zeile, die selbst ein Kind ist.
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = user_a and p.parent_id is not null;
  if n <> 0 then
    raise exception 'CATS: % Kategorien liegen auf einer dritten Ebene', n;
  end if;

  -- Jede Unterkategorie gehört demselben Benutzer wie ihr Elternteil.
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id is distinct from p.user_id;
  if n <> 0 then
    raise exception 'CATS: % Kategorien hängen unter einem fremden Elternteil', n;
  end if;

  -- ── 2. Die fünf alten Slugs sind Blätter mit den beschlossenen Namen ──────
  select count(*) into n
  from public.finance_categories
  where user_id = user_a
    and slug in ('lebensmittel', 'restaurant', 'klamotten', 'drogerie', 'sonstige')
    and parent_id is not null;
  if n <> 5 then
    raise exception 'CATS: nur % der fünf alten Kategorien sind zuordenbar', n;
  end if;

  select count(*) into n
  from public.finance_categories
  where user_id = user_a
    and ((slug = 'restaurant' and label <> 'Restaurants & Cafés')
      or (slug = 'klamotten'  and label <> 'Kleidung')
      or (slug = 'sonstige'   and label <> 'Allgemeines Sonstiges')
      or (slug = 'lebensmittel' and label <> 'Lebensmittel')
      or (slug = 'drogerie'   and label <> 'Drogerie'));
  if n <> 0 then
    raise exception 'CATS: % der fünf alten Kategorien trägt ein falsches Label', n;
  end if;

  -- Und sie hängen unter der richtigen Oberkategorie.
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = user_a
    and ((c.slug = 'lebensmittel' and p.slug <> 'essen_trinken')
      or (c.slug = 'restaurant'   and p.slug <> 'essen_trinken')
      or (c.slug = 'klamotten'    and p.slug <> 'shopping')
      or (c.slug = 'drogerie'     and p.slug <> 'drogerie_pflege')
      or (c.slug = 'sonstige'     and p.slug <> 'sonstiges_parent'));
  if n <> 0 then
    raise exception 'CATS: % der fünf alten Kategorien hängt falsch', n;
  end if;

  select id into parent_id_ from public.finance_categories
    where user_id = user_a and slug = 'essen_trinken';
  select id into leaf_id from public.finance_categories
    where user_id = user_a and slug = 'lebensmittel';

  -- ── 3. Eine dritte Ebene wird abgelehnt ───────────────────────────────────
  begin
    insert into public.finance_categories (user_id, slug, label, sort_order, parent_id)
    values (user_a, 'zu_tief', 'Zu tief', 999, leaf_id);
    raise exception 'CATSFAIL: eine dritte Ebene wurde angenommen';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%dritte Kategorieebene%' then raise; end if;
  end;

  -- Und eine Zeile mit Kindern darf nicht selbst zum Kind werden.
  begin
    update public.finance_categories
      set parent_id = (select id from public.finance_categories
                       where user_id = user_a and slug = 'shopping')
      where id = parent_id_;
    raise exception 'CATSFAIL: eine Oberkategorie mit Kindern wurde zum Kind gemacht';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%hat selbst Unterkategorien%' then raise; end if;
  end;

  -- Und eine fremde Oberkategorie ebenfalls nicht.
  begin
    insert into public.finance_categories (user_id, slug, label, sort_order, parent_id)
    values (user_a, 'fremdes_kind', 'Fremdes Kind', 998, foreign_p);
    raise exception 'CATSFAIL: ein Kind unter fremdem Elternteil wurde angenommen';
  exception when others then
    caught := sqlerrm;
    if caught like 'CATSFAIL:%' then raise; end if;
    -- Entweder der Trigger oder RLS — beide sind eine gültige Ablehnung.
    if caught not like '%anderen Konto%' and caught not like '%row-level security%'
       and caught not like '%gibt es nicht%' then raise; end if;
  end;

  -- ── 4. Nur Blätter sind zuordenbar — auf jedem Schreibweg ─────────────────
  insert into public.finance_accounts (user_id, name) values (user_a, 'Girokonto')
    returning id into acct_a;
  insert into public.finance_merchants (user_id, canonical_name) values (user_a, 'REWE')
    returning id into merch;

  -- 4a. Eine Buchung.
  begin
    insert into public.finance_transactions
      (user_id, account_id, booking_date, amount_minor, currency, raw_description,
       normalized_tokens, category_id)
    values (user_a, acct_a, '2026-09-10', -1438, 'EUR', 'REWE', array['REWE'], parent_id_);
    raise exception 'CATSFAIL: eine Oberkategorie wurde einer Buchung zugeordnet';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;

  -- …und ein Blatt geht.
  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description,
     normalized_tokens, category_id)
  values (user_a, acct_a, '2026-09-10', -1438, 'EUR', 'REWE', array['REWE'], leaf_id)
  returning id into tx_a;

  -- 4b. Ein nachträgliches UPDATE auf eine Oberkategorie ebenso wenig.
  begin
    update public.finance_transactions set category_id = parent_id_ where id = tx_a;
    raise exception 'CATSFAIL: eine Buchung wurde auf eine Oberkategorie umgestellt';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;

  -- 4c. Ein Override.
  begin
    insert into public.finance_transaction_overrides (user_id, transaction_id, category_id)
    values (user_a, tx_a, parent_id_);
    raise exception 'CATSFAIL: ein Override trug eine Oberkategorie';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  insert into public.finance_transaction_overrides (user_id, transaction_id, category_id)
  values (user_a, tx_a, leaf_id);

  -- 4d. Eine Kategorieregel.
  begin
    insert into public.finance_category_rules (user_id, merchant_id, category_id)
    values (user_a, merch, parent_id_);
    raise exception 'CATSFAIL: eine Regel trug eine Oberkategorie';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  insert into public.finance_category_rules (user_id, merchant_id, category_id)
  values (user_a, merch, leaf_id);

  -- 4e. Ein KI-Vorschlag.
  begin
    insert into public.finance_transaction_ai_suggestions
      (user_id, transaction_id, merchant_name, category_id)
    values (user_a, tx_a, 'REWE', parent_id_);
    raise exception 'CATSFAIL: ein KI-Vorschlag trug eine Oberkategorie';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  insert into public.finance_transaction_ai_suggestions
    (user_id, transaction_id, merchant_name, category_id)
  values (user_a, tx_a, 'REWE', leaf_id) returning id into sug;

  -- 4f. Eine gelernte Erinnerung — beide Spalten.
  begin
    insert into public.finance_ai_learning_memories
      (user_id, kind, merchant_name, merchant_key, category_id)
    values (user_a, 'merchant_rule', 'REWE', public.finance_memory_key('REWE'), parent_id_);
    raise exception 'CATSFAIL: eine Erinnerung trug eine Oberkategorie';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  begin
    insert into public.finance_ai_learning_memories
      (user_id, kind, merchant_name, merchant_key, category_id, suggested_category_id)
    values (user_a, 'merchant_rule', 'REWE', public.finance_memory_key('REWE'),
            leaf_id, parent_id_);
    raise exception 'CATSFAIL: suggested_category_id trug eine Oberkategorie';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  insert into public.finance_ai_learning_memories
    (user_id, kind, merchant_name, merchant_key, category_id)
  values (user_a, 'merchant_rule', 'REWE', public.finance_memory_key('REWE'), leaf_id);

  -- 4g. Und der Lernpfad, der die Kategorie über ihren SLUG nachschlägt.
  begin
    perform public.finance_learn_merchant_rule(
      tx_a, 'essen_trinken', 'exact_token', array['REWE']::text[], merch);
    raise exception 'CATSFAIL: finance_learn_merchant_rule nahm eine Oberkategorie an';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;

  -- 4h. Die manuelle Buchung.
  begin
    perform public.finance_create_manual_transaction(
      acct_a, '2026-09-11'::date, -500::bigint, 'EUR', 'Von Hand',
      array['VON','HAND']::text[], parent_id_);
    raise exception 'CATSFAIL: finance_create_manual_transaction nahm eine Oberkategorie an';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%Oberkategorie%' then raise; end if;
  end;
  perform public.finance_create_manual_transaction(
    acct_a, '2026-09-11'::date, -500::bigint, 'EUR', 'Von Hand',
    array['VON','HAND']::text[], leaf_id);

  -- ── 5. Der aufgeschobene Fremdschlüssel ───────────────────────────────────
  -- Aufgeschoben heißt: die Prüfung läuft am COMMIT. In einem Block, der mit
  -- ROLLBACK endet, käme sie deshalb nie dran — `set constraints … immediate`
  -- holt sie an genau die Stelle, an der sie geprüft werden soll.

  -- 5a. Eine Oberkategorie allein zu löschen scheitert.
  begin
    delete from public.finance_categories where id = parent_id_;
    set constraints public.finance_categories_parent_fk immediate;
    raise exception 'CATSFAIL: eine Oberkategorie mit Kindern ließ sich löschen';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%violates foreign key constraint%' then raise; end if;
  end;
  set constraints public.finance_categories_parent_fk deferred;

  -- Sie steht noch. Nichts ist verwaist.
  select count(*) into n from public.finance_categories where id = parent_id_;
  if n <> 1 then
    raise exception 'CATS: die Oberkategorie ist nach dem abgelehnten Delete weg';
  end if;

  -- 5b. Eltern UND Kinder gemeinsam gehen — in EINER Transaktion, Eltern
  --     zuerst. Das ist der Fall, an dem `on delete restrict` scheitert, obwohl
  --     am Ende gar nichts verwaist wäre: RESTRICT lässt sich nicht aufschieben.
  --     Hier ist es genau umgekehrt, und deshalb steht der Fremdschlüssel so.
  begin
    -- Die Regel und der Vorschlag zeigen noch auf ein Kind; sie gehen mit.
    delete from public.finance_category_rules where user_id = user_a;
    delete from public.finance_ai_learning_memories where user_id = user_a;
    delete from public.finance_transaction_ai_suggestions where user_id = user_a;
    delete from public.finance_transaction_overrides where user_id = user_a;
    update public.finance_transactions set category_id = null where user_id = user_a;

    delete from public.finance_categories where id = parent_id_;
    delete from public.finance_categories where parent_id = parent_id_;
    set constraints public.finance_categories_parent_fk immediate;
  exception when others then
    raise exception 'CATS: Eltern und Kinder gemeinsam zu löschen scheiterte: %', sqlerrm;
  end;
  set constraints public.finance_categories_parent_fk deferred;

  select count(*) into n from public.finance_categories
   where user_id = user_a and slug in ('essen_trinken', 'lebensmittel', 'restaurant');
  if n <> 0 then
    raise exception 'CATS: nach dem gemeinsamen Delete stehen noch % Zeilen', n;
  end if;

  -- 5c. Ein verwaistes Kind lässt sich nicht committen: das Elternteil
  --     verschwindet, das Kind bleibt stehen.
  begin
    third := (select id from public.finance_categories
              where user_id = user_a and slug = 'bildung');
    delete from public.finance_categories where id = third;
    set constraints public.finance_categories_parent_fk immediate;
    raise exception 'CATSFAIL: ein verwaistes Kind wäre durchgegangen';
  exception when others then
    caught := sqlerrm;
    -- Die eigene Meldung darf der Filter darunter NIE verschlucken: sie enthält
    -- dieselben Wörter, nach denen er sucht. Genau daran ist die Gegenprobe zum
    -- Wächter einmal vorbeigelaufen und hat „bestanden" gemeldet, während der
    -- Trigger gar nicht mehr da war.
    if caught like 'CATSFAIL:%' then raise; end if;
    if caught not like '%violates foreign key constraint%' then raise; end if;
  end;
  set constraints public.finance_categories_parent_fk deferred;

  raise notice 'CATS: Abschnitt 1-5 bestanden';
end
$$;

rollback;

-- ── 6. Der Benutzer-Delete ──────────────────────────────────────────────────
-- Die eigentliche Frage hinter der Wahl des Fremdschlüssels: räumt der Cascade
-- aus `auth.users` die ganze Taxonomie ab — Eltern und Kinder, in derselben
-- Anweisung — und bleibt ein zweiter Benutzer dabei unberührt?
begin;

do $$
declare
  gone   uuid := gen_random_uuid();
  stays  uuid := gen_random_uuid();
  acct   uuid;
  leaf   uuid;
  n      integer;
begin
  insert into auth.users (id, email) values
    (gone,  'cat-gone@mindwhiteboard.test'),
    (stays, 'cat-stays@mindwhiteboard.test');

  select count(*) into n from public.finance_categories where user_id = gone;
  if n <> 35 then
    raise exception 'CATS-DELETE: der Benutzer startet mit % Kategorien statt 35', n;
  end if;

  -- Und zwar mit Daten daran, damit der Cascade echte Arbeit hat.
  select id into leaf from public.finance_categories
    where user_id = gone and slug = 'lebensmittel';
  insert into public.finance_accounts (user_id, name) values (gone, 'Girokonto')
    returning id into acct;
  insert into public.finance_transactions
    (user_id, account_id, booking_date, amount_minor, currency, raw_description,
     normalized_tokens, category_id)
  values (gone, acct, '2026-09-10', -1438, 'EUR', 'REWE', array['REWE'], leaf);

  -- DER TEST.
  delete from auth.users where id = gone;

  select count(*) into n from public.finance_categories where user_id = gone;
  if n <> 0 then
    raise exception 'CATS-DELETE: % Kategorien haben den Benutzer überlebt', n;
  end if;
  select count(*) into n from public.finance_transactions where user_id = gone;
  if n <> 0 then
    raise exception 'CATS-DELETE: % Buchungen haben den Benutzer überlebt', n;
  end if;

  -- Der zweite Benutzer ist unberührt.
  select count(*) into n from public.finance_categories where user_id = stays;
  if n <> 35 then
    raise exception 'CATS-DELETE: der andere Benutzer hat jetzt % Kategorien', n;
  end if;
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = stays;
  if n <> 26 then
    raise exception 'CATS-DELETE: beim anderen Benutzer zeigen % Kinder auf ein Elternteil', n;
  end if;

  raise notice 'CATS: Abschnitt 6 bestanden';
end
$$;

rollback;

-- ── 7. Und dasselbe noch einmal ECHT, ohne Savepoint-Tricks ─────────────────
-- Abschnitt 6 läuft in einer Transaktion, die zurückgerollt wird; die
-- aufgeschobene Prüfung käme dort nie an ein COMMIT. Dieser Abschnitt committet
-- wirklich — und räumt danach selbst auf.
begin;
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000000c7';
begin
  insert into auth.users (id, email) values (u, 'cat-commit@mindwhiteboard.test');
end
$$;
commit;

begin;
delete from auth.users where id = '00000000-0000-4000-8000-0000000000c7';
commit;

do $$
declare n integer;
begin
  select count(*) into n from public.finance_categories
   where user_id = '00000000-0000-4000-8000-0000000000c7';
  if n <> 0 then
    raise exception 'CATS-COMMIT: % Kategorien haben ein echtes COMMIT überlebt', n;
  end if;
  raise notice 'CATS: Abschnitt 7 bestanden';
end
$$;

select 'CATS: all assertions passed' as result;
