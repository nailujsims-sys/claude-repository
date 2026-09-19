-- 0012_finance_ai_learning — aus einer Korrektur wird Wissen, wenn der Mensch es sagt.
--
-- WAS SICH AM PRODUKT ÄNDERT. v1.23 hat die Korrektur eines KI-Vorschlags
-- sauber gespeichert (`finance_transaction_ai_suggestions.human_review`), aber
-- sie blieb bei der einen Buchung. v1.24 erlaubt dem Nutzer, dieselbe Korrektur
-- ausdrücklich für die Zukunft zu merken — und „Zukunft" heißt hier: der
-- nächste Prompt, den „KI-Kontext kopieren" schreibt. Das Gedächtnis liegt in
-- dieser App; ChatGPT bekommt es bei jedem Import mitgeteilt und behält selbst
-- nichts.
--
-- WARUM DAS BESTEHENDE SCHEMA NICHT REICHT — vier Punkte, und nur die:
--
--   1. EINE LERNREGEL IST KEINE PATTERN-REGEL. `finance_merchant_patterns`
--      hängt an exakten, normalisierten Tokens des Banktextes; das ist die
--      Stärke der klassischen Engine und genau das, was hier falsch wäre. „REWE"
--      soll auch „REWE Stuttgart" und „Rewe Markt Köln" erklären, und diese
--      Abstraktion leistet das Sprachmodell, nicht ein Tokenvergleich. Eine
--      KI-Lernregel darf deshalb weder ein Muster noch einen
--      `finance_merchants`-Eintrag erzeugen: der Händlername bleibt Text.
--
--   2. EIN BEISPIEL IST KEINE REGEL. „Ähnliche Buchungen" speichert einen
--      konkreten Fall — Originaltext, was das Modell sagte, was der Mensch
--      daraus machte — und überlässt dem Modell, wie weit es ihn überträgt. Das
--      ist eine andere Art von Wissen als „immer für REWE", und beide brauchen
--      unterschiedliche Zusagen im Prompt (Hinweis vs. Vorrang). Eine Tabelle
--      mit `kind` hält sie auseinander, ohne sie zu trennen.
--
--   3. EIN ZAHLUNGSDIENSTLEISTER IST EINE AUSSAGE ÜBER DIE IDENTITÄT, NICHT
--      ÜBER DIE KATEGORIE. „PayPal ist nicht der Händler" sagt dem Modell, wo
--      es weitersuchen soll — es sagt nichts darüber, in welche Kategorie die
--      Buchung gehört. Deshalb trägt eine Zeile dieser Art keine Kategorie,
--      und der Check unten erzwingt das.
--
--   4. DAS MERKEN GEHÖRT IN DEN IMPORT. Der Nutzer wählt den Umfang im Preview,
--      also bevor irgendetwas gespeichert ist. Ein zweiter Schreibvorgang aus
--      dem Browser hinterlässt bei jedem Abbruch einen Import ohne das Wissen,
--      das der Mensch gerade ausdrücklich behalten wollte. „Ein Import ist eine
--      Handlung" (0009) gilt weiter: `finance_apply_ai_import` bekommt das
--      Merken dazu, in derselben Transaktion.
--
-- WAS DIESE MIGRATION AUSDRÜCKLICH NICHT TUT: keine Zeile wird migriert, keine
-- Spalte entfernt, keine Policy umgeschrieben, kein Constraint gelockert. Die
-- Pattern- und Lern-Engine aus 0008 bleibt unangetastet und weiterhin zuständig
-- für alles, was sie heute entscheidet.

-- ── 1. Der Vergleichsschlüssel eines Händlernamens ──────────────────────────
-- „REWE", „Rewe Markt!" und „rewe  markt" sind für einen Menschen derselbe
-- Händler. Damit zwei Regeln für denselben Händler kollidieren können (und
-- genau das sollen sie, siehe Teil 4), braucht es eine kanonische Form.
--
-- SIE IST BEWUSST DIESELBE REGEL WIE IN src/lib/finance/normalize.js: NFKC,
-- Großbuchstaben, alles außer Buchstaben und Ziffern ist eine Grenze, und
-- Grenzen werden zu einem einzelnen Leerzeichen. Kein Stoppwort, keine
-- Rechtsform, keine Ortsentfernung, kein Fuzzy — dieselbe Zusage wie dort.
--
-- WER SIE BERECHNET: die Datenbank, immer. Der Aufrufer schickt den Namen, nie
-- den Schlüssel; ein Schlüssel vom Client wäre ein Weg, zwei Regeln für
-- denselben Händler nebeneinander zu legen, die der Unique-Index nicht sieht.
--
-- WARUM `collate "und-x-icu"` DARIN STEHT: ohne sie hinge das Ergebnis an der
-- Locale der Datenbank. In einer Datenbank mit C-Locale macht `upper('bäckerei')`
-- ein „BäCKEREI", und `[[:alnum:]]` hält das Ä für ein Trennzeichen — derselbe
-- Händler bekäme dort zwei Regeln, und die Testdatenbank wäre nicht dieselbe wie
-- Production. Mit der ausdrücklichen Kollation ist der Schlüssel überall gleich.
create or replace function public.finance_memory_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      upper(normalize(coalesce(p_name, ''), NFKC) collate "und-x-icu"),
      '[^[:alnum:]]+', ' ', 'g'
    )),
    ''
  );
$$;

comment on function public.finance_memory_key(text) is
  'Die kanonische Vergleichsform eines Händlernamens für KI-Lernregeln — '
  'dieselbe Normalisierung wie src/lib/finance/normalize.js, damit zwei Regeln '
  'für denselben Händler sich gegenseitig finden.';

-- ── 2. finance_ai_learning_memories ─────────────────────────────────────────
-- Was der Nutzer ausdrücklich für kommende KI-Importe behalten wollte.
--
-- DREI ARTEN, UND SIE BEDEUTEN NICHT DASSELBE:
--
--   merchant_rule     „Immer für REWE" — eine starke persönliche Regel. Im
--                     Prompt mit Vorrang vor allgemeinen Annahmen.
--   payment_provider  „PayPal als Zahlungsdienstleister behandeln" — eine
--                     Aussage über die Identität, nie über die Kategorie.
--   similar_example   „Ähnliche Buchungen" — ein konkreter Fall als Hinweis,
--                     aus dem das Modell selbst abstrahieren darf.
--
-- DIE ZWEI STARKEN ARTEN SIND EINDEUTIG: pro Nutzer und Händler höchstens eine
-- aktive. Beispiele dürfen viele sein — sie widersprechen einander nicht,
-- sondern zeigen Fälle.
create table if not exists public.finance_ai_learning_memories (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  kind                  text not null,

  -- Der Händler, um den es geht — als Text, aus Punkt 1 der Kopfzeile. Für
  -- `similar_example` darf er fehlen (eine Korrektur kann auch nur die
  -- Kategorie betreffen).
  merchant_name         text,
  merchant_key          text,

  -- Was gelernt wurde. Alle drei nullbar, weil nur gelernt wird, was der Mensch
  -- auch gesagt hat: die Kategorie, wenn seine Entscheidung eine trägt, und Art
  -- bzw. „zählt in der Auswertung" NUR, wenn sie sich vom Vorschlag des Modells
  -- unterscheiden. Eine Voreinstellung, die zufällig stehen blieb, ist keine
  -- Entscheidung und wird nicht zur Regel.
  category_id           uuid references public.finance_categories (id) on delete set null,
  transaction_type      text,
  include_in_analytics  boolean,

  -- Der Fall, aus dem das Wissen stammt. Für `similar_example` ist der
  -- Originaltext der Kern des Beispiels; für die starken Regeln ist er nur
  -- Herkunft.
  source_description    text,
  source_transaction_id uuid references public.finance_transactions (id) on delete set null,
  source_suggestion_id  uuid references public.finance_transaction_ai_suggestions (id) on delete set null,

  -- Was das Modell vorgeschlagen hatte, typisiert. Ein Beispiel ohne diese
  -- Hälfte wäre kein Beispiel, sondern eine Behauptung: „REWE → Lebensmittel"
  -- lehrt nichts, „das Modell sagte Sonstige, ich sagte Lebensmittel" schon.
  -- Ausdrückliche Spalten statt freiem Text, damit der Prompt-Builder sie
  -- formulieren kann und niemand gespeicherten Prompt-Text wieder einliest.
  suggested_merchant_name        text,
  suggested_category_id          uuid references public.finance_categories (id) on delete set null,
  suggested_transaction_type     text,
  suggested_include_in_analytics boolean,

  -- Die Identität eines Beispiels: derselbe Fall zweimal gemerkt ist einmal
  -- gemerkt. Von der Datenbank berechnet (siehe Teil 4), nie vom Aufrufer.
  example_key           text,

  -- Deaktivieren statt löschen: das ist die Rückgängig-Zusage der App (§18/§19)
  -- und der Grund, warum eine falsch gemerkte Regel kein endgültiger Fehler ist.
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint finance_ai_memories_kind_known
    check (kind in ('similar_example', 'merchant_rule', 'payment_provider')),
  constraint finance_ai_memories_merchant_len
    check (merchant_name is null or char_length(merchant_name) <= 120),
  constraint finance_ai_memories_suggested_merchant_len
    check (suggested_merchant_name is null or char_length(suggested_merchant_name) <= 120),
  constraint finance_ai_memories_description_len
    check (source_description is null or char_length(source_description) <= 500),
  constraint finance_ai_memories_type_known check (
    transaction_type is null
    or transaction_type in ('purchase', 'refund', 'transfer', 'income', 'fee', 'other')
  ),
  constraint finance_ai_memories_suggested_type_known check (
    suggested_transaction_type is null
    or suggested_transaction_type in ('purchase', 'refund', 'transfer', 'income', 'fee', 'other')
  ),
  -- Eine starke Regel ohne Händler wäre eine Regel über nichts.
  constraint finance_ai_memories_strong_needs_merchant check (
    kind = 'similar_example'
    or (merchant_name is not null and merchant_key is not null)
  ),
  -- Eine Händlerregel, die nichts über die Einordnung sagt, ist keine Regel.
  -- Dass ein Text zu „REWE" gehört, lernt das Beispiel, nicht sie.
  constraint finance_ai_memories_rule_needs_content check (
    kind <> 'merchant_rule'
    or category_id is not null
    or transaction_type is not null
    or include_in_analytics is not null
  ),
  -- Ein Dienstleister ist eine Aussage über die Identität. Eine Kategorie hier
  -- wäre genau der Fehler, den die Regel verhindern soll — „alles von PayPal
  -- ist Kategorie X".
  constraint finance_ai_memories_provider_has_no_class check (
    kind <> 'payment_provider'
    or (category_id is null and transaction_type is null and include_in_analytics is null)
  ),
  -- Ein Beispiel ohne Fall ist kein Beispiel.
  constraint finance_ai_memories_example_needs_case check (
    kind <> 'similar_example'
    or (source_description is not null and example_key is not null)
  )
);

-- Pro Nutzer und Händler genau eine aktive starke Regel — und zwar über beide
-- starken Arten hinweg: „immer für PayPal → Kategorie X" und „PayPal ist ein
-- Dienstleister" sind unvereinbar, und zwei unvereinbare Wahrheiten
-- gleichzeitig aktiv sind genau das, was Abschnitt 10 der Vorgabe ausschließt.
create unique index if not exists finance_ai_memories_strong_idx
  on public.finance_ai_learning_memories (user_id, merchant_key)
  where active and kind in ('merchant_rule', 'payment_provider');

-- Derselbe Fall zweimal gemerkt ist einmal gemerkt.
create unique index if not exists finance_ai_memories_example_idx
  on public.finance_ai_learning_memories (user_id, example_key)
  where active and kind = 'similar_example';

-- Die Frage, die der Prompt-Builder bei jedem „KI-Kontext kopieren" stellt:
-- „was ist aktiv, neueste zuerst?"
create index if not exists finance_ai_memories_active_idx
  on public.finance_ai_learning_memories (user_id, kind, created_at desc)
  where active;

comment on table public.finance_ai_learning_memories is
  'Was der Nutzer ausdrücklich für kommende KI-Importe behalten wollte — starke '
  'Händlerregeln, Zahlungsdienstleister und konkrete Korrekturbeispiele. Erzeugt '
  'weder Muster noch finance_merchants-Einträge: das Abstrahieren übernimmt das '
  'Sprachmodell, nicht ein Tokenvergleich.';

alter table public.finance_ai_learning_memories enable row level security;

drop policy if exists "finance_ai_memories_select_own" on public.finance_ai_learning_memories;
create policy "finance_ai_memories_select_own" on public.finance_ai_learning_memories
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_ai_memories_insert_own" on public.finance_ai_learning_memories;
create policy "finance_ai_memories_insert_own" on public.finance_ai_learning_memories
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_category(category_id)
    and public.finance_owns_category(suggested_category_id)
    and public.finance_owns_transaction(source_transaction_id)
  );

-- Anders als bei einem Vorschlag gibt es hier ein Update-Recht, und es ist der
-- Kern des Umgangs mit diesen Zeilen: deaktivieren, wieder aktivieren, eine
-- Regel durch eine neuere ersetzen. Was ein Vorschlag gesagt hat, ist Geschichte;
-- was der Nutzer sich merken will, darf er ändern.
drop policy if exists "finance_ai_memories_update_own" on public.finance_ai_learning_memories;
create policy "finance_ai_memories_update_own" on public.finance_ai_learning_memories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.finance_owns_category(category_id)
    and public.finance_owns_category(suggested_category_id)
  );

drop policy if exists "finance_ai_memories_delete_own" on public.finance_ai_learning_memories;
create policy "finance_ai_memories_delete_own" on public.finance_ai_learning_memories
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Wie bei 0011: erst alles entziehen, dann genau das geben, was oben steht.
-- Supabase gibt neuen Tabellen per `alter default privileges` alle Rechte mit,
-- und ein Recht, das nicht existiert, ist eine ehrlichere Ablehnung als eine
-- Policy, die stillschweigend null Zeilen liefert.
revoke all on public.finance_ai_learning_memories from anon, authenticated;
grant select, insert, update, delete on public.finance_ai_learning_memories to authenticated;

-- ── 3. Der Schlüssel eines Beispiels ────────────────────────────────────────
-- Zwei Beispiele sind dasselbe Beispiel, wenn derselbe Originaltext zu
-- derselben Korrektur desselben Vorschlags geführt hat. Betrag und Datum stehen
-- bewusst nicht darin: derselbe REWE-Einkauf für 24,95 € und für 18,99 € lehrt
-- dasselbe, und zweimal dieselbe Lehre ist eine.
create or replace function public.finance_memory_example_key(
  p_description  text,
  p_sug_merchant text,
  p_sug_category uuid,
  p_sug_type     text,
  p_sug_include  boolean,
  p_merchant     text,
  p_category     uuid,
  p_type         text,
  p_include      boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(
    concat_ws(
      '|',
      coalesce(public.finance_memory_key(p_description), ''),
      coalesce(public.finance_memory_key(p_sug_merchant), ''),
      coalesce(p_sug_category::text, ''),
      coalesce(p_sug_type, ''),
      coalesce(p_sug_include::text, ''),
      coalesce(public.finance_memory_key(p_merchant), ''),
      coalesce(p_category::text, ''),
      coalesce(p_type, ''),
      coalesce(p_include::text, '')
    )
  );
$$;

-- ── 4. Ein KI-Import, jetzt mit Gedächtnis ──────────────────────────────────
-- Dieselbe Funktion wie in 0011, dieselbe Signatur, dieselben Zusagen — plus
-- einen Block am Ende jeder Zeile.
--
-- WAS DER AUFRUFER ZUM MERKEN SCHICKT: genau ein Wort.
--
--   "learning": { "mode": "none" | "similar" | "merchant_rule" | "payment_provider" }
--
-- UND SONST NICHTS. Was gelernt wird, entscheidet diese Funktion aus dem, was
-- ohnehin in derselben Zeile steht: dem Vorschlag des Modells und der
-- Entscheidung des Menschen. Das ist kein Geiz, sondern die einzige Art, die
-- drei Zusagen aus Abschnitt 3 der Vorgabe durchzusetzen —
--
--   • die Notiz wird nie gelernt,
--   • die Buchungsart nur bei echter Abweichung vom Vorschlag,
--   • „zählt in der Auswertung" nur bei echter Abweichung —
--
-- denn ein Client, der die Felder selbst schickt, kann sie auch anders schicken.
--
-- KEIN AUTOMATISCHES LERNEN. `mode` ungleich 'none' ist nur erlaubt, wenn der
-- Mensch diese Zeile tatsächlich korrigiert hat (`human_review = 'corrected'`)
-- UND diese Korrektur ein Feld betrifft, aus dem sich lernen lässt.
-- Eine Bestätigung ist das wertvollste Signal, das es gibt — und trotzdem keine
-- Erlaubnis, daraus eine Regel für alles Kommende zu machen. Wie weit eine
-- einzelne Korrektur verallgemeinert werden soll, entscheidet der Nutzer im
-- Preview und niemand sonst.
--
-- UND „KORRIGIERT" REICHT NICHT. Eine geänderte Notiz macht eine Zeile zurecht
-- zu `corrected` — sie IST eine menschliche Entscheidung über diese Buchung.
-- Lernen lässt sich daraus trotzdem nichts: eine Regel für kommende Importe
-- kann nur aus den Feldern entstehen, die ein nächster Vorschlag auch wieder
-- füllt (Händler, Kategorie, Buchungsart, Auswertung). „Geschäftsessen" als
-- Regel für alles Kommende wäre Unsinn. Deshalb prüft die Funktion die
-- fachliche Abweichung selbst, statt sich auf `human_review` zu verlassen —
-- und zwar unabhängig davon, was der Client anbietet oder verbirgt.
create or replace function public.finance_apply_ai_import(
  p_import_id  uuid,
  p_account_id uuid,
  p_bookings   jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user        uuid := (select auth.uid());
  v_import      public.finance_imports%rowtype;
  v_created     integer := 0;
  v_suggested   integer := 0;
  v_decided     integer := 0;
  v_learned     integer := 0;
  v_count       integer;
  v_tx          uuid;
  v_sug         uuid;
  v_type        text;
  v_include     boolean;
  -- Die Entscheidung des Menschen, aufgeschlüsselt: einmal gelesen, dreimal
  -- gefragt.
  v_dec_merchant uuid;
  v_dec_name     text;
  v_dec_category uuid;
  v_dec_note     text;
  v_dec_include  boolean;
  v_classifies   boolean;
  -- Was der Mensch sich merken wollte, und was daraus wird.
  v_review       text;
  v_mode         text;
  v_learnable    boolean;
  v_dec_type     text;
  v_kind         text;
  v_key          text;
  v_learn_name   text;
  v_learn_cat    uuid;
  v_learn_type   text;
  v_learn_incl   boolean;
  v_sug_name     text;
  v_sug_cat      uuid;
  v_sug_type     text;
  v_sug_incl     boolean;
  v_result      jsonb;
  b             jsonb;
  s             jsonb;
  d             jsonb;
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;
  if p_bookings is null or jsonb_typeof(p_bookings) <> 'array' then
    raise exception 'finance: der Import ist unvollstaendig' using errcode = '22023';
  end if;

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

  -- Schon angewendet: das gespeicherte Ergebnis, als Wiederholung markiert.
  -- Damit entsteht auch keine zweite Erinnerung — die Wiederholungssicherheit
  -- des Imports ist zugleich die des Gedächtnisses.
  if v_import.status = 'imported' then
    return coalesce(v_import.apply_result, jsonb_build_object('import_id', p_import_id))
           || jsonb_build_object('replayed', true);
  end if;

  for b in select value from jsonb_array_elements(p_bookings)
  loop
    if jsonb_typeof(b) <> 'object'
       or nullif(btrim(coalesce(b->>'raw_description', '')), '') is null then
      raise exception 'finance: ein Umsatz dieses Imports hat keinen Text' using errcode = '22023';
    end if;
    if nullif(b->>'booking_date', '') is null then
      raise exception 'finance: ein Umsatz dieses Imports hat kein Datum' using errcode = '22023';
    end if;
    if nullif(b->>'amount_minor', '') is null then
      raise exception 'finance: ein Umsatz dieses Imports hat keinen Betrag' using errcode = '22023';
    end if;

    s := case when jsonb_typeof(b->'suggestion') = 'object' then b->'suggestion' else '{}'::jsonb end;
    d := case when jsonb_typeof(b->'user_decision') = 'object' then b->'user_decision' else null end;
    v_type := coalesce(nullif(b->>'transaction_type', ''), 'purchase');
    v_include := coalesce((b->>'include_in_analytics')::boolean, true);

    insert into public.finance_transactions (
      user_id, account_id, import_id, booking_date, value_date, amount_minor,
      currency, raw_description, external_reference, normalized_tokens,
      category_id, transaction_type, include_in_analytics, source_metadata
    ) values (
      v_user, p_account_id, p_import_id,
      (b->>'booking_date')::date,
      nullif(b->>'value_date', '')::date,
      (b->>'amount_minor')::bigint,
      coalesce(nullif(b->>'currency', ''), 'EUR'),
      b->>'raw_description',
      nullif(coalesce(b->>'external_reference', ''), ''),
      coalesce(
        (select array_agg(t.value order by t.ord)
         from jsonb_array_elements_text(
                case when jsonb_typeof(b->'normalized_tokens') = 'array'
                     then b->'normalized_tokens' else '[]'::jsonb end
              ) with ordinality as t(value, ord)),
        '{}'::text[]
      ),
      nullif(b->>'category_id', '')::uuid,
      v_type,
      v_include,
      case when jsonb_typeof(b->'source_metadata') = 'object' then b->'source_metadata' else null end
    )
    returning id into v_tx;
    v_created := v_created + 1;

    -- Der Vorschlag, so wie er ankam.
    v_sug_name := nullif(btrim(coalesce(s->>'merchant_name', '')), '');
    v_sug_cat  := nullif(s->>'category_id', '')::uuid;
    v_sug_type := coalesce(nullif(s->>'transaction_type', ''), v_type);
    v_sug_incl := coalesce((s->>'include_in_analytics')::boolean, v_include);
    v_review   := case when s->>'human_review' in ('confirmed', 'corrected')
                       then s->>'human_review' else 'none' end;

    v_sug := null;
    insert into public.finance_transaction_ai_suggestions (
      user_id, transaction_id, import_id, merchant_name, category_id,
      transaction_type, include_in_analytics, note, needs_review, human_review,
      format_version
    ) values (
      v_user, v_tx, p_import_id,
      v_sug_name,
      v_sug_cat,
      v_sug_type,
      v_sug_incl,
      nullif(btrim(coalesce(s->>'note', '')), ''),
      coalesce((s->>'needs_review')::boolean, false),
      v_review,
      coalesce((s->>'format_version')::integer, 1)
    )
    on conflict do nothing
    returning id into v_sug;
    get diagnostics v_count = row_count;
    v_suggested := v_suggested + v_count;

    -- Was der Mensch im Preview gesehen und mitgenommen hat. Ob daraus eine
    -- Override-Zeile wird, entscheidet NICHT der Aufrufer, sondern dieselbe
    -- Frage wie bei der Handbuchung: sagt diese Entscheidung etwas über die
    -- Einordnung, oder hält sie etwas fest, das sonst verloren ginge?
    v_dec_merchant := null;
    v_dec_name     := null;
    v_dec_category := null;
    v_dec_note     := null;
    v_dec_include  := null;
    if d is not null then
      v_dec_merchant := nullif(d->>'merchant_id', '')::uuid;
      v_dec_name     := nullif(btrim(coalesce(d->>'merchant_name', '')), '');
      v_dec_category := nullif(d->>'category_id', '')::uuid;
      v_dec_note     := nullif(btrim(coalesce(d->>'note', '')), '');
      v_dec_include  := (d->>'include_in_analytics')::boolean;
      -- Einordnung heißt: Händler oder Kategorie. Dieselbe Definition wie in
      -- finance_create_manual_transaction und in
      -- src/lib/finance/effectiveClassification.js — drei Stellen, eine Regel.
      v_classifies := v_dec_merchant is not null
                   or v_dec_name is not null
                   or v_dec_category is not null;

      if v_classifies or v_dec_note is not null or v_dec_include = false then
        insert into public.finance_transaction_overrides (
          user_id, transaction_id, merchant_id, merchant_name, category_id,
          include_in_analytics, transaction_type, note
        ) values (
          v_user, v_tx,
          -- Ein Händler, den es schon gibt, wird verknüpft; einer, den der Mensch
          -- gerade erst benannt hat, steht als Text daneben. In beiden Fällen
          -- entsteht kein Muster und keine Regel.
          v_dec_merchant,
          v_dec_name,
          v_dec_category,
          -- Nur ein ausdrückliches „zählt nicht" gehört auf die erste Stufe der
          -- Auswertungsregel. Ein bestätigtes „zählt" ist die Voreinstellung und
          -- steht schon auf der Buchung.
          case when v_dec_include = false then false else null end,
          nullif(d->>'transaction_type', ''),
          v_dec_note
        )
        on conflict (transaction_id) do nothing;
        get diagnostics v_count = row_count;
        v_decided := v_decided + v_count;
      end if;

      -- Gesperrt wird nur, was auch eingeordnet wurde. Eine Bestätigung ohne
      -- Händler und ohne Kategorie ist eine GEPRÜFTE Buchung, keine
      -- EINGEORDNETE — sie darf weiter in der Zuordnung auftauchen, und dass ein
      -- Mensch sie angesehen hat, steht im Vorschlag (`human_review`).
      if v_classifies then
        update public.finance_transactions set manual_lock = true where id = v_tx;
      end if;
    end if;

    -- ── Für die Zukunft merken ───────────────────────────────────────────────
    v_mode := coalesce(
      nullif(
        case when jsonb_typeof(b->'learning') = 'object' then b->'learning'->>'mode' else null end,
        ''
      ),
      'none'
    );

    if v_mode <> 'none' then
      if v_mode not in ('similar', 'merchant_rule', 'payment_provider') then
        raise exception 'finance: unbekannter Merk-Umfang %', v_mode using errcode = '22023';
      end if;
      if v_review <> 'corrected' then
        raise exception 'finance: gemerkt wird nur, was der Mensch korrigiert hat'
          using errcode = '22023';
      end if;

      -- Gibt es überhaupt etwas zu lernen? Verglichen wird die Entscheidung des
      -- Menschen mit dem Vorschlag des Modells, Feld für Feld — die Notiz ist
      -- ausdrücklich nicht dabei.
      v_dec_type := nullif(coalesce(d->>'transaction_type', ''), '');
      -- Ohne Entscheidung gibt es nichts zu vergleichen: ein Payload mit
      -- `learning`, aber ohne `user_decision`, behauptet eine Korrektur, die
      -- nirgends steht.
      v_learnable := d is not null and (
           v_dec_merchant is not null                        -- bewusst verknüpft
        or v_dec_name     is distinct from v_sug_name
        or v_dec_category is distinct from v_sug_cat
        or (v_dec_type    is not null and v_dec_type is distinct from v_sug_type)
        or (v_dec_include is not null and v_dec_include is distinct from v_sug_incl)
      );
      if not v_learnable then
        raise exception 'finance: aus dieser Aenderung laesst sich nichts lernen'
          using errcode = '22023';
      end if;

      -- Der Händler, den der Mensch am Ende stehen ließ. Ein verknüpfter
      -- Eintrag zählt mit seinem Namen — die Regel ist Text, nicht Fremdschlüssel.
      v_learn_name := coalesce(
        v_dec_name,
        (select m.canonical_name from public.finance_merchants m
          where m.id = v_dec_merchant and m.user_id = v_user)
      );
      v_key := public.finance_memory_key(v_learn_name);

      -- Was gelernt werden darf: die Kategorie der Entscheidung, und Art bzw.
      -- Auswertung NUR, wenn sie vom Vorschlag abweichen. Die Notiz steht
      -- bewusst in keiner dieser Zeilen.
      v_learn_cat  := v_dec_category;
      v_learn_type := case
        when d is null then null
        when nullif(d->>'transaction_type', '') is null then null
        when d->>'transaction_type' is distinct from v_sug_type then d->>'transaction_type'
        else null
      end;
      v_learn_incl := case
        when v_dec_include is null then null
        when v_dec_include is distinct from v_sug_incl then v_dec_include
        else null
      end;

      if v_mode = 'similar' then
        insert into public.finance_ai_learning_memories (
          user_id, kind, merchant_name, merchant_key, category_id, transaction_type,
          include_in_analytics, source_description, source_transaction_id,
          source_suggestion_id, suggested_merchant_name, suggested_category_id,
          suggested_transaction_type, suggested_include_in_analytics, example_key
        ) values (
          v_user, 'similar_example', v_learn_name, v_key, v_learn_cat, v_learn_type,
          v_learn_incl, left(b->>'raw_description', 500), v_tx,
          v_sug, v_sug_name, v_sug_cat, v_sug_type, v_sug_incl,
          public.finance_memory_example_key(
            b->>'raw_description', v_sug_name, v_sug_cat, v_sug_type, v_sug_incl,
            v_learn_name, v_learn_cat, v_learn_type, v_learn_incl
          )
        )
        on conflict (user_id, example_key) where active and kind = 'similar_example'
        do nothing;
        get diagnostics v_count = row_count;
        v_learned := v_learned + v_count;

      else
        -- Die zwei starken Arten. Beide brauchen einen Händler; eine
        -- Händlerregel braucht außerdem etwas, das sie über ihn aussagt.
        if v_key is null then
          raise exception 'finance: eine Regel fuer die Zukunft braucht einen Haendler'
            using errcode = '22023';
        end if;
        v_kind := case when v_mode = 'merchant_rule' then 'merchant_rule' else 'payment_provider' end;
        if v_kind = 'merchant_rule'
           and v_learn_cat is null and v_learn_type is null and v_learn_incl is null then
          raise exception 'finance: eine Haendlerregel braucht eine Kategorie oder eine Abweichung'
            using errcode = '22023';
        end if;

        -- Zwei unvereinbare Wahrheiten über denselben Händler darf es nicht
        -- geben: die andere starke Art wird still deaktiviert — still, weil der
        -- Nutzer gerade ausdrücklich etwas anderes gesagt hat, und die alte
        -- Zeile bleibt als deaktivierte Zeile lesbar.
        update public.finance_ai_learning_memories
        set active = false, updated_at = now()
        where user_id = v_user
          and active
          and merchant_key = v_key
          and kind in ('merchant_rule', 'payment_provider')
          and kind <> v_kind;

        -- Dieselbe Art für denselben Händler wird ERSETZT, nicht verdoppelt:
        -- „REWE → Lebensmittel" und später „REWE → Restaurant" sind nicht zwei
        -- Regeln, sondern eine geänderte Meinung.
        update public.finance_ai_learning_memories
        set merchant_name        = v_learn_name,
            category_id          = case when v_kind = 'merchant_rule' then v_learn_cat else null end,
            transaction_type     = case when v_kind = 'merchant_rule' then v_learn_type else null end,
            include_in_analytics = case when v_kind = 'merchant_rule' then v_learn_incl else null end,
            source_description   = left(b->>'raw_description', 500),
            source_transaction_id = v_tx,
            source_suggestion_id  = v_sug,
            suggested_merchant_name = v_sug_name,
            suggested_category_id   = v_sug_cat,
            suggested_transaction_type = v_sug_type,
            suggested_include_in_analytics = v_sug_incl,
            updated_at = now()
        where user_id = v_user and active and kind = v_kind and merchant_key = v_key;
        get diagnostics v_count = row_count;

        if v_count = 0 then
          insert into public.finance_ai_learning_memories (
            user_id, kind, merchant_name, merchant_key, category_id, transaction_type,
            include_in_analytics, source_description, source_transaction_id,
            source_suggestion_id, suggested_merchant_name, suggested_category_id,
            suggested_transaction_type, suggested_include_in_analytics
          ) values (
            v_user, v_kind, v_learn_name, v_key,
            case when v_kind = 'merchant_rule' then v_learn_cat else null end,
            case when v_kind = 'merchant_rule' then v_learn_type else null end,
            case when v_kind = 'merchant_rule' then v_learn_incl else null end,
            left(b->>'raw_description', 500), v_tx, v_sug,
            v_sug_name, v_sug_cat, v_sug_type, v_sug_incl
          );
          get diagnostics v_count = row_count;
        end if;
        v_learned := v_learned + v_count;
      end if;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'import_id', p_import_id,
    'account_id', p_account_id,
    'created', v_created,
    'suggestions', v_suggested,
    'decisions', v_decided,
    'memories', v_learned
  );

  update public.finance_imports
  set status = 'imported', imported_at = now(), apply_result = v_result, updated_at = now()
  where id = p_import_id;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.finance_apply_ai_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.finance_apply_ai_import(uuid, uuid, jsonb) to authenticated;
