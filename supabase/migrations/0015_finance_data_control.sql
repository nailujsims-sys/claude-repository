-- 0015_finance_data_control — eine einzelne Buchung löschen, und den ganzen
-- Finanzbereich auf Anfang setzen.
--
-- WARUM DAS IN DIE DATENBANK GEHÖRT UND NICHT IN DEN CLIENT. Beides sind
-- Vorgänge, die über mehrere Tabellen laufen und bei denen ein Abbruch in der
-- Mitte schlimmer wäre als gar nichts zu tun: eine halb gelöschte Buchung
-- hinterlässt einen offenen Prüfposten, der auf nichts mehr zeigt, ein halb
-- zurückgesetzter Finanzbereich Konten ohne Buchungen und Regeln ohne
-- Kategorien. Ein `delete` aus dem Browser, dann noch eins, dann noch eins, ist
-- genau diese Mitte — jede Zeile ein eigener Netzwerkaufruf, jeder davon
-- abbrechbar. Eine Funktion ist eine Transaktion: alles oder nichts.
--
-- ZWEI VORGÄNGE, ZWEI SEHR VERSCHIEDENE REICHWEITEN.
--
--   finance_delete_transaction   entfernt EINE Buchung und das, was
--                                ausschließlich an ihr hing. Global Gelerntes
--                                — Händler, Muster, Kategorieregeln, das
--                                KI-Gedächtnis — bleibt unangetastet, und die
--                                Importhistorie bleibt vollständig.
--
--   finance_reset_user_data      setzt den gesamten Finanzbereich des
--                                angemeldeten Nutzers auf den Zustand nach der
--                                Registrierung zurück: keine eigenen Daten
--                                mehr, aber die vollständige Standardtaxonomie
--                                wieder da.
--
-- KEIN ANDERES MODUL WIRD BERÜHRT. Aufgaben, Termine, Listen, das
-- Ausgaben-Modul und das Profil stehen in eigenen Tabellen, und keine einzige
-- Anweisung hier nennt eine davon.
--
-- DAS FREMDSCHLÜSSEL-BILD, AUS DEM DIE REIHENFOLGE FOLGT (Stand 0008–0014):
--
--   auf finance_transactions zeigen
--     finance_transaction_overrides.transaction_id            cascade
--     finance_transaction_ai_suggestions.transaction_id       cascade
--     finance_transaction_observations.transaction_id         cascade
--       → finance_transaction_observation_sightings.observation_id  cascade
--     finance_transaction_relation_members.transaction_id     cascade
--     finance_import_review_item_transactions.transaction_id  cascade
--     finance_transactions.refunds_transaction_id             set null
--     finance_ai_learning_memories.source_transaction_id      SET NULL  ← wichtig
--
--   auf finance_accounts zeigen
--     finance_transactions.account_id                         cascade
--     finance_imports.account_id                              cascade
--     finance_import_review_items.account_id                  cascade
--
--   auf finance_imports zeigen  (alle set null — ein Import ist Herkunft,
--     finance_transactions.import_id                           kein Besitzer)
--     finance_transaction_observations.import_id
--     finance_transaction_observation_sightings.import_id
--     finance_transaction_relations.import_id
--     finance_import_review_items.import_id
--     finance_transaction_ai_suggestions.import_id
--
--   auf finance_categories zeigen
--     finance_category_rules.category_id                      cascade
--     finance_transactions.category_id                        set null
--     finance_transaction_overrides.category_id               set null
--     finance_transaction_ai_suggestions.category_id          set null
--     finance_ai_learning_memories.category_id                set null
--     finance_ai_learning_memories.suggested_category_id      set null
--     finance_categories.parent_id                            no action,
--                                                             deferrable (0014)
--
-- WAS GLOBAL GELERNTES WISSEN IST — und deshalb eine einzelne Buchung
-- überlebt: finance_merchants, finance_merchant_patterns,
-- finance_category_rules, finance_ai_learning_memories. Sie beschreiben, wie
-- KÜNFTIGE Buchungen zu lesen sind, nicht, was eine vergangene war.
--
-- WAS NUR ZU EINER BUCHUNG GEHÖRT: ihr Override, ihr KI-Vorschlag, ihre
-- Beobachtungen und deren Sichtungen, ihre Mitgliedschaft in einer Relation und
-- ihre Verknüpfung mit einem Prüfposten. Alles davon steht schon per
-- `on delete cascade` am Fremdschlüssel; diese Migration fügt dem nichts hinzu,
-- sie schreibt nur die beiden Fälle auf, die der Cascade allein nicht sauber
-- löst (siehe Abschnitt 1).
--
-- Idempotent, zweimal einspielbar: nur `create or replace function`, keine
-- Tabelle, keine Spalte, kein Datenschreiben.

-- ── 1. Darf eine durch eine Relation deaktivierte Buchung wieder zählen? ───
--
-- WARUM ES DIESE FUNKTION GIBT, und warum sie klein ist. Eine Relation aus 0009
-- ist nicht nur eine Aussage über Buchungen — sie GREIFT IN DIE AUSWERTUNG EIN:
--
--   • bestätigte Ablösung        → der Vorgänger wird `include_in_analytics =
--                                  false`, denn sonst zählte dieselbe Zahlung
--                                  zweimal;
--   • vorgeschlagene Ablösung vor einer manuell entschiedenen alten Buchung
--                                → die NEUE Buchung steht vorerst still, weil
--                                  die manuelle Entscheidung unangetastet
--                                  bleibt.
--
-- Welche Zeilen eine Relation dabei umgelegt hat, steht in ihrem eigenen
-- `evidence.analytics_deactivated` — by id, nicht als Zahl. Das ist die
-- Buchführung, auf der `finance_resolve_relation` seine Rückwärtsgänge baut,
-- und sie ist auch hier die einzige zulässige Quelle: pauschal alle Mitglieder
-- wieder einzuschalten würde eine Buchung aktivieren, die der Nutzer selbst
-- ausgeschlossen hatte.
--
-- DREI BEDINGUNGEN, UND ALLE DREI MÜSSEN GELTEN:
--
--   1. Die Buchung zählt gerade wirklich nicht. Sonst gibt es nichts zu tun.
--   2. Sie trägt keine manuelle Entscheidung. `finance_transaction_protected`
--      ist derselbe Maßstab, den 0009 benutzt — „manuell schlägt automatisch"
--      gilt auch rückwärts: das Löschen einer Relation darf einen bewusst
--      ausgeschlossenen Umsatz nicht wieder mitzählen lassen.
--   3. KEINE ANDERE bestehende Relation verlangt ihren Ausschluss noch — und
--      das sind ZWEI Gründe, nicht einer:
--
--      a) Eine andere, nicht abgelehnte Relation führt sie in ihrem eigenen
--         `analytics_deactivated`. Sie hat sie stillgelegt und tut es weiterhin.
--         (Eine `rejected` Relation zählt nicht mit: `finance_resolve_relation`
--         leert dort ausdrücklich die Liste.)
--
--      b) Sie ist VORGÄNGER einer anderen, bestätigten Ablösung. Das ist der
--         Fall, den (a) allein nicht sieht, und er ist erreichbar: wurde eine
--         Buchung erst von einer vorgeschlagenen Ablösung geparkt und danach
--         selbst abgelöst, fand die Bestätigung sie bereits auf `false` vor und
--         schrieb sie deshalb NICHT in ihr `analytics_deactivated` — die Liste
--         nennt nur, was diese Relation wirklich umgelegt hat. Ihr Ausschluss
--         steht trotzdem: die Nachfolgebuchung zählt an ihrer Stelle, und sie
--         wieder einzuschalten hieße, dieselbe Zahlung zweimal zu zählen.
--         Deshalb wird hier die STRUKTUR gefragt und nicht nur die Buchführung.
--         (Dass eine Buchung Vorgänger höchstens EINER nicht abgelehnten
--         Relation sein kann, garantiert
--         `finance_relation_members_one_predecessor_idx` aus 0009.)
--
-- `p_ignore_relation` ist die Relation, die gerade verschwindet. Wird die
-- Funktion erst nach dem `delete` gerufen, ist sie ohnehin fort und der
-- Parameter darf `null` sein; der Parameter macht den Aufruf trotzdem lesbar
-- und die Funktion an einer zweiten Stelle benutzbar.
create or replace function public.finance_relation_reactivatable(
  p_transaction_id  uuid,
  p_ignore_relation uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
      select 1 from public.finance_transactions t
      where t.id = p_transaction_id
        and t.user_id = (select auth.uid())
        and not t.include_in_analytics
    )
    and not public.finance_transaction_protected(p_transaction_id)
    and not exists (
      select 1 from public.finance_transaction_relations r
      where r.user_id = (select auth.uid())
        and r.id is distinct from p_ignore_relation
        and r.status <> 'rejected'
        and jsonb_typeof(r.evidence -> 'analytics_deactivated') = 'array'
        and r.evidence -> 'analytics_deactivated' @> to_jsonb(p_transaction_id::text)
    )
    and not exists (
      -- `relation_status` auf der Mitgliedszeile ist kein zweites Gedächtnis:
      -- der zusammengesetzte Fremdschlüssel aus 0009 ist `on update cascade`,
      -- die Spalte folgt dem Status der Relation von selbst.
      select 1 from public.finance_transaction_relation_members m
      where m.user_id = (select auth.uid())
        and m.transaction_id = p_transaction_id
        and m.role = 'predecessor'
        and m.relation_type = 'supersession'
        and m.relation_status = 'confirmed'
        and m.relation_id is distinct from p_ignore_relation
    );
$$;

comment on function public.finance_relation_reactivatable(uuid, uuid) is
  'Darf eine Buchung, die eine Relation aus der Auswertung genommen hat, wieder '
  'zählen? Nur wenn sie nicht manuell entschieden ist, keine andere bestehende '
  'Relation sie in ihrem analytics_deactivated führt, und sie nicht Vorgänger '
  'einer anderen bestätigten Abloesung ist.';

revoke all on function public.finance_relation_reactivatable(uuid, uuid) from public, anon;
grant execute on function public.finance_relation_reactivatable(uuid, uuid) to authenticated;

-- ── 2. Eine einzelne Buchung löschen ────────────────────────────────────────
--
-- SECURITY INVOKER, und das ist keine Sparsamkeit, sondern die engere Variante:
-- jede Zeile, die hier verschwindet, verschwindet unter der RLS des Aufrufers.
-- `finance_transactions` hat seit 0008 eine DELETE-Policy „nur eigene Zeilen",
-- und die abhängigen Zeilen räumt der Fremdschlüssel-Cascade ab — der gehört
-- dem Tabelleneigentümer und fragt keine Policy, was richtig ist: er löscht
-- ausschließlich Zeilen, die auf eine gerade gelöschte zeigen.
--
-- Eine `security definer`-Funktion hätte hier nichts gekonnt, was diese nicht
-- kann, und dafür die Rechteprüfung ausgeschaltet.
--
-- ZWEI AUFRÄUMARBEITEN, DIE DER CASCADE NICHT ERLEDIGT, weil er sie nicht
-- erledigen kann — beide betreffen Zeilen, die die Buchung nicht besitzt,
-- sondern nur erwähnen:
--
--   RELATIONEN. Eine Relation ist eine Aussage über MEHRERE Buchungen („diese
--   ersetzt jene"). Fällt eine Seite weg, bleibt die Relation als Behauptung
--   über eine Buchung stehen, die es nicht mehr gibt. Also wird sie entfernt,
--   sobald sie durch dieses Löschen unter zwei Mitglieder fällt — und
--   ausdrücklich NUR, wenn sie dieses Löschen betraf: die Relation-IDs werden
--   VOR dem `delete` eingesammelt, damit eine fremde, ohnehin einelementige
--   Zeile nicht als Kollateralschaden mitgeht.
--
--   DIE AUSWERTUNG DIESER RELATIONEN. Eine Relation legt Buchungen still: eine
--   bestätigte Ablösung nimmt den Vorgänger aus der Auswertung, eine
--   vorgeschlagene Ablösung vor einer manuell entschiedenen alten Buchung nimmt
--   stattdessen die neue heraus. Verschwindet die Relation, verschwindet auch
--   der Grund — und eine überlebende Buchung darf nicht als „zählt nicht"
--   zurückbleiben, deaktiviert von etwas, das es nicht mehr gibt. Welche Zeilen
--   das betrifft, steht in `evidence.analytics_deactivated` der jeweiligen
--   Relation und wird gelesen, BEVOR sie gelöscht wird; ob eine davon wirklich
--   wieder zählen darf, entscheidet `finance_relation_reactivatable`
--   (Abschnitt 1) — nicht pauschal alle Mitglieder, keine manuell entschiedene
--   Buchung, und keine, die eine andere bestehende Relation weiterhin
--   stilllegt.
--
--   OFFENE PRÜFPOSTEN. `finance_import_review_items` hält die Frage, die ein
--   Import an einen Menschen hatte; die betroffenen Buchungen hängen in einer
--   Verknüpfungstabelle. Verschwindet die letzte davon, ist ein OFFENER Posten
--   eine Frage über nichts — unbeantwortbar, und trotzdem für immer in der
--   Warteschlange. Er wird deshalb entfernt. Ein bereits beantworteter
--   (`resolved`/`dismissed`) bleibt: er ist Geschichte, sein `payload` trägt den
--   eingefrorenen Stand, und genau dafür wurde er in 0009 so gebaut.
--
-- WAS BEWUSST BLEIBT:
--   • Der Import. Eine Buchung aus einem Kontoauszug zu entfernen heißt nicht,
--     dass der Auszug nie eingelesen wurde. Die Zeile in `finance_imports`
--     bleibt mitsamt `source_hash` — dieselbe Datei wird also weiterhin als
--     „schon eingelesen" erkannt, statt beim nächsten Versuch ein zweites Mal
--     als neu zu erscheinen.
--   • Das KI-Gedächtnis. `source_transaction_id` steht auf `set null` (0012);
--     die gelernte Regel überlebt ihre Ursprungsbuchung und verliert nur den
--     Rückverweis. Diese Semantik wird hier ausdrücklich NICHT verschärft.
--   • Händler, Muster und Kategorieregeln. Sie gehören keiner Buchung.
create or replace function public.finance_delete_transaction(p_transaction_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_tx        public.finance_transactions%rowtype;
  v_relations uuid[];
  v_dying     uuid[];
  v_restore   uuid[];
  v_reviews   uuid[];
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;

  -- `for update` statt eines nackten `select`: zwischen Prüfen und Löschen darf
  -- niemand dieselbe Zeile anfassen. Findet es nichts, ist die Buchung fremd
  -- oder es gibt sie nicht — für den Aufrufer dieselbe Antwort, und mehr darf
  -- er auch nicht erfahren.
  select * into v_tx
  from public.finance_transactions
  where id = p_transaction_id and user_id = v_user
  for update;

  if not found then
    raise exception 'finance: diese Buchung gibt es nicht' using errcode = 'P0002';
  end if;

  -- Wen dieses Löschen betrifft — eingesammelt, solange es die Zeilen noch gibt.
  select coalesce(array_agg(distinct m.relation_id), '{}')
  into v_relations
  from public.finance_transaction_relation_members m
  where m.user_id = v_user and m.transaction_id = v_tx.id;

  select coalesce(array_agg(distinct t.review_item_id), '{}')
  into v_reviews
  from public.finance_import_review_item_transactions t
  where t.user_id = v_user and t.transaction_id = v_tx.id;

  delete from public.finance_transactions
  where id = v_tx.id and user_id = v_user;

  -- Eine Relation mit weniger als zwei Mitgliedern ist keine Relation mehr.
  select coalesce(array_agg(r.id), '{}')
  into v_dying
  from public.finance_transaction_relations r
  where r.user_id = v_user
    and r.id = any (v_relations)
    and (
      select count(*) from public.finance_transaction_relation_members m
      where m.relation_id = r.id
    ) < 2;

  -- WAS DIESE RELATIONEN STILLGELEGT HATTEN — gelesen, SOLANGE es sie noch
  -- gibt. Eine Relation ist nicht nur eine Aussage über Buchungen; sie hat
  -- `include_in_analytics` umgelegt (0009), und welche Zeilen das waren, steht
  -- ausschließlich in ihrem eigenen `evidence.analytics_deactivated`. Wird sie
  -- gelöscht, ohne das zu lesen, bleibt eine ÜBERLEBENDE Buchung für immer aus
  -- der Auswertung — deaktiviert von etwas, das es nicht mehr gibt. Genau das
  -- war der Befund im Review.
  select coalesce(array_agg(distinct (x)::uuid), '{}')
  into v_restore
  from public.finance_transaction_relations r
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(r.evidence -> 'analytics_deactivated') = 'array'
         then r.evidence -> 'analytics_deactivated' else '[]'::jsonb end
  ) as t(x)
  where r.user_id = v_user and r.id = any (v_dying);

  delete from public.finance_transaction_relations r
  where r.user_id = v_user and r.id = any (v_dying);

  -- Und erst jetzt wieder einschalten: die Relation ist fort, also kann sie
  -- ihren eigenen Ausschluss nicht mehr begründen. Was eine ANDERE Relation
  -- noch stilllegt und was ein Mensch selbst entschieden hat, entscheidet
  -- `finance_relation_reactivatable` — hier steht keine zweite Fassung dieser
  -- Bedingung. Die gerade gelöschte Buchung steht üblicherweise selbst in der
  -- Liste; sie findet sich nicht mehr und fällt damit von allein heraus.
  update public.finance_transactions t
  set include_in_analytics = true
  where t.user_id = v_user
    and t.id = any (v_restore)
    and public.finance_relation_reactivatable(t.id, null);

  -- Ein offener Prüfposten ohne Buchung ist eine Frage, die niemand mehr
  -- beantworten kann.
  delete from public.finance_import_review_items i
  where i.user_id = v_user
    and i.id = any (v_reviews)
    and i.status = 'open'
    and not exists (
      select 1 from public.finance_import_review_item_transactions t
      where t.review_item_id = i.id
    );

  return v_tx.id;
end;
$$;

comment on function public.finance_delete_transaction(uuid) is
  'Eine eigene Buchung endgültig löschen. Overrides, KI-Vorschläge, '
  'Beobachtungen und Verknüpfungen dieser Buchung gehen mit; Händler, Muster, '
  'Kategorieregeln, KI-Gedächtnis und die Importhistorie bleiben.';

revoke all on function public.finance_delete_transaction(uuid) from public, anon;
grant execute on function public.finance_delete_transaction(uuid) to authenticated;

-- ── 3. Den ganzen Finanzbereich zurücksetzen ────────────────────────────────
--
-- WARUM HIER `security definer` NÖTIG IST — und es beim Löschen einer Buchung
-- nicht war. Der Reset endet nicht mit dem Löschen: danach muss die
-- Standardtaxonomie wieder vollständig dastehen, und die einzige Stelle, die
-- weiß, wie sie aussieht, ist `finance_apply_category_taxonomy` (0014). Die
-- Funktion nimmt eine Benutzer-ID entgegen und ist deshalb ausdrücklich für
-- `authenticated` gesperrt — sonst könnte ein Client die Kategorien eines
-- fremden Kontos anfassen. Eine `security invoker`-Funktion könnte sie also
-- nicht aufrufen; sie müsste die Taxonomie ein zweites Mal aufschreiben, und
-- zwei Kopien derselben Liste laufen irgendwann auseinander.
--
-- Also `security definer`, und dafür die vier Sicherungen, die dazugehören:
--
--   1. `v_user := auth.uid()`. Die Funktion nimmt KEINE Benutzer-ID entgegen —
--      es gibt keinen Parameter, den ein Client manipulieren könnte. Ohne
--      angemeldeten Benutzer bricht sie ab.
--   2. `set search_path = ''`. Jeder Name ist vollständig qualifiziert; ein
--      untergeschobenes Schema kann nichts umleiten.
--   3. JEDE Anweisung trägt `user_id = v_user` — ausnahmslos, auch dort, wo ein
--      Cascade dasselbe Ergebnis hätte. Ein `delete` ohne diese Bedingung wäre
--      in einer definer-Funktion das Löschen der Tabelle.
--   4. `revoke … from public, anon`, `grant execute … to authenticated`.
--
-- DIE REIHENFOLGE ist die Umkehrung des Fremdschlüsselbilds oben: erst die
-- Blätter, dann die Knoten. Die Cascades würden das meiste davon selbst
-- erledigen — hier steht es trotzdem Zeile für Zeile, denn eine definer-Funktion
-- soll lesbar machen, was sie anfasst, statt es einer Kette zu überlassen.
--
-- DIE KATEGORIEN GEHEN VOLLSTÄNDIG UND KOMMEN VOLLSTÄNDIG ZURÜCK. Keine
-- Mischform: nicht „die Standardzeilen zurücksetzen und eigene stehen lassen",
-- denn dabei bliebe eine selbst angelegte Kategorie ohne jede Buchung übrig und
-- eine umbenannte Standardkategorie behielte ihren Namen — ein Zustand, der
-- weder der alte noch der neue wäre. Der Self-Fremdschlüssel aus 0014 ist
-- `deferrable initially deferred`, deshalb dürfen Eltern und Kinder in EINER
-- Anweisung verschwinden.
--
-- WAS DER RESET NICHT IST: er entfernt keine Struktur. Nach ihm steht exakt
-- das da, was ein frisch registrierter Benutzer hat — 9 Oberkategorien, 26
-- Unterkategorien, und sonst nichts.
create or replace function public.finance_reset_user_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_counts jsonb := '{}'::jsonb;
  v_n      integer;
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;

  delete from public.finance_transaction_observation_sightings where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('observation_sightings', v_n);

  delete from public.finance_transaction_observations where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('observations', v_n);

  delete from public.finance_transaction_relation_members where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('relation_members', v_n);

  delete from public.finance_transaction_relations where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('relations', v_n);

  delete from public.finance_import_review_item_transactions where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('review_item_transactions', v_n);

  delete from public.finance_import_review_items where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('review_items', v_n);

  delete from public.finance_ai_learning_memories where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ai_memories', v_n);

  delete from public.finance_transaction_ai_suggestions where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ai_suggestions', v_n);

  delete from public.finance_transaction_overrides where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('overrides', v_n);

  delete from public.finance_category_rules where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('category_rules', v_n);

  delete from public.finance_merchant_patterns where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('merchant_patterns', v_n);

  delete from public.finance_transactions where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('transactions', v_n);

  delete from public.finance_merchants where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('merchants', v_n);

  delete from public.finance_imports where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('imports', v_n);

  delete from public.finance_accounts where user_id = v_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('accounts', v_n);

  -- Erst jetzt die Kategorien: sie sind das Einzige, was danach wiederkommt.
  delete from public.finance_categories where user_id = v_user;

  perform public.finance_apply_category_taxonomy(v_user);

  select count(*) into v_n from public.finance_categories where user_id = v_user;
  v_counts := v_counts || jsonb_build_object('categories', v_n);

  return v_counts;
end;
$$;

comment on function public.finance_reset_user_data() is
  'Alle persönlichen Finanzdaten des angemeldeten Nutzers löschen und die '
  'Standardtaxonomie wiederherstellen. Nimmt keine Benutzer-ID entgegen.';

revoke all on function public.finance_reset_user_data() from public, anon;
grant execute on function public.finance_reset_user_data() to authenticated;
