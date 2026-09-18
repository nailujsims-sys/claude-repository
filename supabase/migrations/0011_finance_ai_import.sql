-- 0011_finance_ai_import — die manuelle Buchung und der bankunabhängige KI-Import.
--
-- WAS SICH AM PRODUKT ÄNDERT. Bis hierher kannte das Finanzmodul genau einen
-- Weg, wie Geld in die Datenbank kommt: der DKB-PDF-Import. v1.23 stellt zwei
-- daneben, die beide nicht an eine Bank gebunden sind — eine einzelne Buchung
-- von Hand, und ein Auszug beliebiger Herkunft, den ChatGPT vorher in ein festes
-- JSON übersetzt hat. Der DKB-Weg bleibt vollständig erhalten; nichts in dieser
-- Migration fasst ihn an.
--
-- WARUM DAS BESTEHENDE SCHEMA NICHT REICHT — die drei Punkte, und nur die:
--
--   1. `finance_imports_source_type_known` kennt 'manual', 'pdf' und 'csv'.
--      Ein KI-Import ist keines davon. Ihn als 'csv' einzutragen wäre eine
--      Herkunftsangabe, die nicht stimmt — und die Herkunft ist in diesem
--      Modul kein Etikett, sondern die Grundlage jeder späteren Frage „woher
--      weiß die App das eigentlich". Also bekommt der Check einen vierten,
--      ehrlichen Wert.
--
--   2. Ein KI-VORSCHLAG HAT KEINE SPALTE, und darf auch keine bekommen.
--      `finance_transactions` trägt die Auflösung, die die Regel-Engine gerade
--      liefert; `finance_transaction_overrides` trägt, was ein Mensch von Hand
--      entschieden hat. Ein Vorschlag eines Sprachmodells ist weder das eine
--      noch das andere: er ist eine dritte Meinung, die nie eine
--      Nutzerentscheidung überschreiben darf und die man später mit der
--      tatsächlichen Entscheidung vergleichen können muss — genau daraus lernt
--      v1.24. In eine der beiden bestehenden Tabellen geschrieben wäre er
--      hinterher nicht mehr von ihnen zu unterscheiden. Deshalb eine eigene,
--      additive Tabelle.
--
--      Dazu gehört auch, dass der vorgeschlagene Händler ein TEXT ist und kein
--      `merchant_id`. Ein `finance_merchants`-Eintrag ist die Wurzel der
--      Pattern- und Lern-Engine; ihn aus einem Modellvorschlag heraus anzulegen
--      wäre exakt die automatische globale Lernregel, die v1.23 ausdrücklich
--      noch nicht erzeugen soll.
--
--   3. EIN IMPORT IST EINE HANDLUNG (die Regel, die 0009 aufgestellt hat).
--      Eine manuelle Buchung sind zwei Schreibvorgänge (Buchung + Entscheidung),
--      ein KI-Import sind drei pro Zeile. Als Einzelaufrufe aus dem Browser
--      hinterlässt jeder Abbruch in der Mitte eine Buchung ohne ihre Notiz oder
--      einen halben Auszug. Also zwei Funktionen, jede in einer Transaktion,
--      beide mit Invoker-Rechten wie `finance_learn_merchant_rule` und
--      `finance_apply_reconciliation_plan`: sie machen die Schreibvorgänge
--      atomar, sie erweitern nicht, was der Aufrufer erreichen kann.
--
-- WAS DIESE MIGRATION AUSDRÜCKLICH NICHT TUT: keine Spalte wird entfernt, keine
-- Policy umgeschrieben, kein Constraint gelockert, keine Zeile migriert. Was
-- der DKB-Import gespeichert hat, bedeutet danach dasselbe wie davor.

-- ── 1. Die Herkunft 'ai' ────────────────────────────────────────────────────
-- Additiv: der Check wird durch denselben Check mit einem Wert mehr ersetzt.
-- Jede Zeile, die den alten erfüllt, erfüllt auch den neuen.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'finance_imports_source_type_known') then
    alter table public.finance_imports drop constraint finance_imports_source_type_known;
  end if;
  alter table public.finance_imports add constraint finance_imports_source_type_known
    check (source_type in ('manual', 'pdf', 'csv', 'ai'));
end
$$;

comment on column public.finance_imports.source_type is
  'Woher die Buchungen dieses Imports kommen: manual, pdf (DKB-Umsatzexport), '
  'csv oder ai (ein von ChatGPT strukturierter Auszug beliebiger Bank).';

-- ── 2. finance_transaction_ai_suggestions ───────────────────────────────────
-- Was das Modell zu EINER Buchung vorgeschlagen hat, so wie es der Nutzer im
-- Preview gesehen hat — und daneben, ob er es dort noch geändert hat.
--
-- EINE ZEILE PRO (Buchung, Import). Derselbe Auszug zweimal durch dasselbe
-- Modell gibt denselben Vorschlag; ein späterer Import, der dieselbe Buchung
-- anders sieht, ist eine zweite Meinung und bekommt eine zweite Zeile. Was er
-- nicht darf, ist die erste überschreiben — deshalb der Unique-Index und das
-- `do nothing` in der Apply-Funktion.
--
-- KEIN FREMDSCHLÜSSEL AUF finance_merchants, siehe oben: der Händlername ist
-- Text, weil ein Vorschlag keinen Händler anlegt.
create table if not exists public.finance_transaction_ai_suggestions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  transaction_id        uuid not null references public.finance_transactions (id) on delete cascade,
  -- Wie bei der Buchung selbst: Import-Metadaten zu löschen darf nicht die
  -- Erkenntnis löschen, die aus ihnen stammt.
  import_id             uuid references public.finance_imports (id) on delete set null,
  -- Der erkannte Händler als Text. Null heißt „das Modell hat sich nicht
  -- festgelegt" — und genau dann steht needs_review auf true.
  merchant_name         text,
  -- Muss eine existierende Kategorie sein oder null. Eine erfundene Kategorie
  -- kommt hier nie an: der Parser setzt sie auf null und needs_review auf true.
  category_id           uuid references public.finance_categories (id) on delete set null,
  transaction_type      text not null default 'purchase',
  include_in_analytics  boolean not null default true,
  note                  text,
  -- „Ich bin mir nicht sicher." Vom Modell gesetzt oder vom Parser erzwungen.
  needs_review          boolean not null default false,
  -- Hat der Mensch diesen Vorschlag im Preview angefasst? Das ist die Spalte,
  -- aus der v1.24 lernt: Vorschlag + Korrektur = ein Trainingsbeispiel.
  user_edited           boolean not null default false,
  -- Das Format, in dem der Vorschlag ankam. Versioniert, damit ein später
  -- geändertes Importformat alte Vorschläge nicht stillschweigend uminterpretiert.
  format_version        integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint finance_ai_suggestions_merchant_len
    check (merchant_name is null or char_length(merchant_name) <= 120),
  constraint finance_ai_suggestions_note_len
    check (note is null or char_length(note) <= 2000),
  constraint finance_ai_suggestions_type_known check (
    transaction_type in ('purchase', 'refund', 'transfer', 'income', 'fee', 'other')
  ),
  constraint finance_ai_suggestions_format_version_known check (format_version >= 1)
);

create unique index if not exists finance_ai_suggestions_tx_import_idx
  on public.finance_transaction_ai_suggestions (transaction_id, coalesce(import_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists finance_ai_suggestions_user_idx
  on public.finance_transaction_ai_suggestions (user_id, created_at desc);
create index if not exists finance_ai_suggestions_import_idx
  on public.finance_transaction_ai_suggestions (import_id);
-- Die Frage, die v1.24 stellen wird: „wo lag das Modell daneben?"
create index if not exists finance_ai_suggestions_edited_idx
  on public.finance_transaction_ai_suggestions (user_id)
  where user_edited;

comment on table public.finance_transaction_ai_suggestions is
  'Was ein KI-Import zu einer Buchung vorgeschlagen hat — getrennt von der '
  'Regel-Auflösung (finance_transactions) und von der Entscheidung des '
  'Menschen (finance_transaction_overrides), damit die drei unterscheidbar '
  'bleiben.';

alter table public.finance_transaction_ai_suggestions enable row level security;

drop policy if exists "finance_ai_suggestions_select_own" on public.finance_transaction_ai_suggestions;
create policy "finance_ai_suggestions_select_own" on public.finance_transaction_ai_suggestions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_ai_suggestions_insert_own" on public.finance_transaction_ai_suggestions;
create policy "finance_ai_suggestions_insert_own" on public.finance_transaction_ai_suggestions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_transaction(transaction_id)
    and public.finance_owns_import(import_id)
    and public.finance_owns_category(category_id)
  );

-- Kein Update-Recht: ein Vorschlag ist eine Aussage von damals. Was der Mensch
-- daraus gemacht hat, steht im Override, nicht hier. `user_edited` wird beim
-- Anlegen gesetzt, weil die Korrektur im Preview passiert — vor dem Speichern.
drop policy if exists "finance_ai_suggestions_delete_own" on public.finance_transaction_ai_suggestions;
create policy "finance_ai_suggestions_delete_own" on public.finance_transaction_ai_suggestions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Auch `authenticated` wird zuerst alles entzogen und dann genau das gegeben,
-- was oben steht. Nicht aus Misstrauen gegen RLS, sondern weil Supabase neuen
-- Tabellen per `alter default privileges` alle Rechte mitgibt: ohne das revoke
-- hinge „kein Update" allein daran, dass keine Policy existiert — und das ist
-- eine stille Ablehnung (null Zeilen), keine laute. Ein Recht, das gar nicht da
-- ist, sagt dem Aufrufer, was Sache ist.
revoke all on public.finance_transaction_ai_suggestions from anon, authenticated;
grant select, insert, delete on public.finance_transaction_ai_suggestions to authenticated;

-- ── 3. Eine Buchung von Hand ────────────────────────────────────────────────
-- Zwei Schreibvorgänge, eine Transaktion:
--
--   • die Buchung, mit `manual_lock` — sie kommt von einem Menschen, also
--     tritt keine spätere Regelauswertung darüber;
--   • die Entscheidung, in `finance_transaction_overrides` — dort, wo dieses
--     Schema seit 0008 hinschreibt, was jemand von Hand festgelegt hat, und wo
--     als einziges eine Notiz einen Platz hat.
--
-- `import_id` bleibt NULL. Eine manuelle Buchung stammt aus keiner Datei, und
-- ein Import-Datensatz, der eine vortäuscht, wäre eine Herkunftsangabe, die
-- nicht stimmt. Die Herkunft steht stattdessen in `source_metadata`, wo auch
-- der Parser seine hinterlässt.
--
-- Die Tokens kommen vom Aufrufer, wie beim DKB-Plan auch: normalisiert wird an
-- genau einer Stelle (src/lib/finance/normalize.js), und der Constraint
-- `finance_transactions_tokens_normalized` prüft hier nach, dass das Ergebnis
-- aussieht wie etwas, das dieser Normalisierer produziert haben könnte.
create or replace function public.finance_create_manual_transaction(
  p_account_id           uuid,
  p_booking_date         date,
  p_amount_minor         bigint,
  p_currency             text,
  p_raw_description      text,
  p_normalized_tokens    text[],
  p_category_id          uuid default null,
  p_merchant_id          uuid default null,
  p_transaction_type     text default 'purchase',
  p_include_in_analytics boolean default true,
  p_note                 text default null,
  p_source_metadata      jsonb default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tx   uuid;
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;
  if not public.finance_owns_account(p_account_id) then
    raise exception 'finance: Konto % nicht gefunden', p_account_id using errcode = 'P0002';
  end if;
  if p_booking_date is null then
    raise exception 'finance: die Buchung braucht ein Datum' using errcode = '22023';
  end if;
  if p_amount_minor is null then
    raise exception 'finance: die Buchung braucht einen Betrag' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_raw_description, '')), '') is null then
    raise exception 'finance: die Buchung braucht eine Beschreibung' using errcode = '22023';
  end if;

  insert into public.finance_transactions (
    user_id, account_id, import_id, booking_date, amount_minor, currency,
    raw_description, normalized_tokens, merchant_id, category_id,
    transaction_type, include_in_analytics, manual_lock, source_metadata
  ) values (
    v_user, p_account_id, null, p_booking_date, p_amount_minor,
    coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'EUR'),
    btrim(p_raw_description), coalesce(p_normalized_tokens, '{}'::text[]),
    p_merchant_id, p_category_id,
    coalesce(nullif(btrim(coalesce(p_transaction_type, '')), ''), 'purchase'),
    coalesce(p_include_in_analytics, true),
    true,
    coalesce(p_source_metadata, jsonb_build_object('origin', 'manual'))
  )
  returning id into v_tx;

  -- Die Entscheidung selbst. Auch wenn sie „keine Kategorie" lautet: dass ein
  -- Mensch sie getroffen hat, ist die Information, die zählt.
  insert into public.finance_transaction_overrides (
    user_id, transaction_id, merchant_id, category_id,
    include_in_analytics, transaction_type, note
  ) values (
    v_user, v_tx, p_merchant_id, p_category_id,
    coalesce(p_include_in_analytics, true),
    coalesce(nullif(btrim(coalesce(p_transaction_type, '')), ''), 'purchase'),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return jsonb_build_object('transaction_id', v_tx, 'account_id', p_account_id);
end;
$$;

revoke all on function public.finance_create_manual_transaction(
  uuid, date, bigint, text, text, text[], uuid, uuid, text, boolean, text, jsonb
) from public, anon;
grant execute on function public.finance_create_manual_transaction(
  uuid, date, bigint, text, text, text[], uuid, uuid, text, boolean, text, jsonb
) to authenticated;

-- ── 4. Einen KI-Import anwenden ─────────────────────────────────────────────
-- WAS DER AUFRUFER SCHICKT: genau die Zeilen, die der Preview als „Neu"
-- ausgewiesen hat, jede mit ihrem Originaltext, ihrem Betrag, ihrem Datum, dem
-- Vorschlag des Modells und — falls der Mensch im Preview etwas korrigiert hat —
-- seiner Entscheidung. Bereits vorhandene Zeilen werden gar nicht erst
-- geschickt; welche das sind, entscheidet der kontobezogene Abgleich im Client
-- (src/lib/finance/ai/plan.js), und die Wiederholungssicherheit hängt nicht
-- daran (siehe unten).
--
-- WAS DIE DATENBANK NICHT GLAUBT:
--   • dass das Konto dem Aufrufer gehört — wird geprüft;
--   • dass der Import zu diesem Konto gehört — wird geprüft;
--   • dass eine genannte Kategorie existiert — der Fremdschlüssel und die
--     Insert-Policy prüfen es;
--   • dass derselbe Import nicht schon angewendet wurde — die Import-Zeile wird
--     gesperrt, und ein bereits angewendeter Import gibt sein gespeichertes
--     Ergebnis zurück und schreibt nichts. Zusammen mit dem Unique-Index auf
--     (user_id, source_hash) aus 0008 heißt das: derselbe ChatGPT-Block ein
--     zweites Mal eingefügt erzeugt keine einzige zusätzliche Buchung.
--
-- ALLES ODER NICHTS, invoker rights, wie 0009. Kein `security definer`.
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
  v_count       integer;
  v_tx          uuid;
  v_type        text;
  v_include     boolean;
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
    insert into public.finance_transaction_ai_suggestions (
      user_id, transaction_id, import_id, merchant_name, category_id,
      transaction_type, include_in_analytics, note, needs_review, user_edited,
      format_version
    ) values (
      v_user, v_tx, p_import_id,
      nullif(btrim(coalesce(s->>'merchant_name', '')), ''),
      nullif(s->>'category_id', '')::uuid,
      coalesce(nullif(s->>'transaction_type', ''), v_type),
      coalesce((s->>'include_in_analytics')::boolean, v_include),
      nullif(btrim(coalesce(s->>'note', '')), ''),
      coalesce((s->>'needs_review')::boolean, false),
      coalesce((s->>'user_edited')::boolean, false),
      coalesce((s->>'format_version')::integer, 1)
    )
    on conflict do nothing;
    get diagnostics v_count = row_count;
    v_suggested := v_suggested + v_count;

    -- Nur wenn der Mensch im Preview wirklich etwas entschieden hat. Ein
    -- unverändert übernommener Vorschlag ist keine Nutzerentscheidung und
    -- bekommt deshalb auch keine Zeile in einer Tabelle, die genau das bedeutet.
    if d is not null then
      insert into public.finance_transaction_overrides (
        user_id, transaction_id, category_id, include_in_analytics,
        transaction_type, note
      ) values (
        v_user, v_tx,
        nullif(d->>'category_id', '')::uuid,
        (d->>'include_in_analytics')::boolean,
        nullif(d->>'transaction_type', ''),
        nullif(btrim(coalesce(d->>'note', '')), '')
      )
      on conflict (transaction_id) do nothing;
      get diagnostics v_count = row_count;
      v_decided := v_decided + v_count;

      -- Eine Zeile, die ein Mensch angefasst hat, ist entschieden. Die
      -- Regelauswertung tritt nicht mehr darüber.
      update public.finance_transactions set manual_lock = true where id = v_tx;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'import_id', p_import_id,
    'account_id', p_account_id,
    'created', v_created,
    'suggestions', v_suggested,
    'decisions', v_decided
  );

  update public.finance_imports
  set status = 'imported', imported_at = now(), apply_result = v_result, updated_at = now()
  where id = p_import_id;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.finance_apply_ai_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.finance_apply_ai_import(uuid, uuid, jsonb) to authenticated;
