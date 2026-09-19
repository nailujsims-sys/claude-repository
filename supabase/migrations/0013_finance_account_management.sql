-- 0013_finance_account_management — ein Konto bearbeiten, archivieren, und nur
-- dann löschen, wenn wirklich nichts daran hängt.
--
-- WARUM DIESE MIGRATION ÜBERHAUPT NÖTIG IST. `finance_imports.account_id` und
-- `finance_transactions.account_id` (0008) sowie
-- `finance_import_review_items.account_id` (0009) verweisen mit
-- `on delete cascade` auf `finance_accounts`. Das ist für das Löschen eines
-- BENUTZERS richtig — wer sein Konto bei uns auflöst, nimmt seine Kontoauszüge
-- mit — und für das Löschen eines KONTOS aus der Oberfläche heraus
-- katastrophal: ein Fehlgriff auf „Löschen" nähme wortlos jede Buchung, jeden
-- Import und jede offene Prüfung dieses Kontos mit. Ein Bankkonto verschwindet
-- im echten Leben auch nicht rückwirkend aus der eigenen Geschichte.
--
-- Deshalb zwei getrennte Vorgänge, und die Datenbank entscheidet, welcher
-- erlaubt ist — nicht die Oberfläche:
--
--   ARCHIVIEREN  ist der Normalfall. Eine Spalte, ein Zeitstempel, sonst
--                nichts: keine Buchung wird angefasst, kein Import, keine
--                Regel. Das Konto bleibt vollständig in der Historie und in
--                jeder Auswertung; es verschwindet nur aus der Auswahl für
--                NEUE Buchungen und Importe. Und es ist umkehrbar.
--
--   LÖSCHEN      geht ausschließlich bei einem Konto, an dem nichts hängt —
--                geprüft an den echten Fremdschlüsseln des Schemas, nicht an
--                einer Liste, die beim nächsten `create table` veraltet.
--
-- DIE WÄHRUNG IST KEIN NAME. Name und Anbieter sind Beschriftungen und jederzeit
-- änderbar. `currency` ist die Basis, unter der jeder gespeicherte Betrag dieses
-- Kontos gelesen wird: ein Wechsel von EUR auf AUD würde 2.483 Cent von gestern
-- zu 24,83 AUD erklären, ohne dass irgendjemand eine Zahl angefasst hat. Alte
-- Buchungen umzuschreiben wäre die noch schlechtere Antwort (0008: „eine
-- importierte Buchung behält ihren Betrag für immer"). Also: solange das Konto
-- leer ist, frei änderbar — danach nicht mehr.
--
-- WAS DIESE MIGRATION AUSDRÜCKLICH NICHT TUT: sie archiviert kein bestehendes
-- Konto, migriert keine Zeile, entfernt keine Spalte, lockert kein Constraint
-- und schreibt keine Policy um. Sie ist additiv und zweimal einspielbar.

-- ── 1. Die Spalte ───────────────────────────────────────────────────────────
-- `null` heißt aktiv. Ein Zeitstempel statt eines Booleans, weil „seit wann"
-- eine Frage ist, die ein Mensch an ein Archiv stellt, und ein Boolean sie
-- nicht beantworten kann. Kein Default: bestehende Konten bleiben aktiv.
alter table public.finance_accounts
  add column if not exists archived_at timestamptz;

comment on column public.finance_accounts.archived_at is
  'Seit wann dieses Konto nicht mehr für neue Buchungen und Importe angeboten '
  'wird. null = aktiv. Historie und Auswertungen sind davon unberührt.';

-- Die einzige Frage, die die Oberfläche neu stellt, ist „meine aktiven Konten" —
-- und genau die beantwortet dieser Index ohne einen zweiten Blick in die Zeile.
create index if not exists finance_accounts_user_archived_idx
  on public.finance_accounts (user_id, archived_at);

-- ── 2. Hängt an diesem Konto Finanzhistorie? ────────────────────────────────
-- Die Frage, an der Löschen und Währungswechsel hängen — und deshalb die eine
-- Stelle, an der sie beantwortet wird.
--
-- SIE LIEST DIE FREMDSCHLÜSSEL DES SCHEMAS, KEINE LISTE. Heute sind es drei
-- Tabellen (`finance_imports`, `finance_transactions`,
-- `finance_import_review_items`); morgen kann eine vierte dazukommen, und eine
-- fest verdrahtete Aufzählung wäre dann stillschweigend falsch — in der
-- Richtung, in der man es erst merkt, wenn Daten weg sind. Also wird
-- `pg_constraint` gefragt: jede Tabelle, die per Fremdschlüssel auf
-- `finance_accounts` zeigt, zählt, unabhängig von ihrer `on delete`-Regel.
--
-- ES IST BEWUSST KEIN `security definer`. Die Funktion läuft als Aufrufer,
-- unter derselben RLS wie alles andere — und das ist hier keine Lücke, sondern
-- die Zusage des Schemas: jede dieser Tabellen trägt `user_id`, und ihre
-- Insert-Policy verlangt `finance_owns_account(account_id)`. Eine Zeile, die auf
-- mein Konto zeigt, ist deshalb immer meine; „für mich unsichtbar" und „gibt es
-- nicht" fallen zusammen. Der Aufrufer prüft die Eigentümerschaft des Kontos
-- ohnehin vorher.
--
-- Rückgabe ist der Tabellenname der ERSTEN gefundenen Abhängigkeit (oder null).
-- Ein Name statt eines Booleans, weil eine spätere Fehlermeldung dann sagen
-- kann, woran es liegt, ohne die Prüfung ein zweites Mal zu schreiben.
create or replace function public.finance_account_dependency(p_account_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  r      record;
  v_hit  boolean;
begin
  if p_account_id is null then
    return null;
  end if;

  for r in
    select cl.relname   as table_name,
           att.attname  as column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
    join pg_catalog.pg_attribute att
      on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.finance_accounts'::regclass
      and ns.nspname = 'public'
      and array_length(c.conkey, 1) = 1
    order by cl.relname
  loop
    execute format(
      'select exists (select 1 from public.%I where %I = $1)',
      r.table_name, r.column_name
    )
    into v_hit
    using p_account_id;

    if v_hit then
      return r.table_name;
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.finance_account_dependency(uuid) is
  'Der Name der ersten Tabelle, die per Fremdschlüssel auf dieses Konto zeigt '
  'und Zeilen dazu hält — oder null, wenn das Konto wirklich leer ist. Liest '
  'die Fremdschlüssel des Schemas, damit eine neue Tabelle die Prüfung nicht '
  'stillschweigend aushebelt.';

revoke all on function public.finance_account_dependency(uuid) from public, anon;
grant execute on function public.finance_account_dependency(uuid) to authenticated;

-- ── 3. Das Konto, wie der Aufrufer es sehen darf ────────────────────────────
-- Ein kleiner gemeinsamer Helfer: Konto sperren, Eigentümer prüfen, sonst der
-- gleiche Fehler wie überall. Er existiert, damit die drei Funktionen unten
-- sich in diesem Punkt nicht unterscheiden können.
create or replace function public.finance_account_for_update(p_account_id uuid)
returns public.finance_accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_account public.finance_accounts%rowtype;
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;

  select * into v_account
  from public.finance_accounts
  where id = p_account_id and user_id = v_user
  for update;

  if not found then
    raise exception 'finance: Konto % nicht gefunden', p_account_id using errcode = 'P0002';
  end if;

  return v_account;
end;
$$;

revoke all on function public.finance_account_for_update(uuid) from public, anon;
grant execute on function public.finance_account_for_update(uuid) to authenticated;

-- ── 4. finance_update_account ───────────────────────────────────────────────
-- Name, Anbieter, Währung — in einem Aufruf, mit der Währungsregel darin.
--
-- Die Regel steht hier und nicht in der Oberfläche, weil eine Regel, die nur
-- ein Formular kennt, keine Regel ist: ein zweiter Client, ein direkter
-- PostgREST-Aufruf oder ein späterer Screen käme daran vorbei. Was der Browser
-- davon zeigt (ein gesperrtes Feld mit einem Satz daneben), ist Höflichkeit,
-- nicht der Schutz.
create or replace function public.finance_update_account(
  p_account_id uuid,
  p_name       text,
  p_provider   text,
  p_currency   text
)
returns public.finance_accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account  public.finance_accounts%rowtype;
  v_name     text;
  v_provider text;
  v_currency text;
begin
  v_account := public.finance_account_for_update(p_account_id);

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Das Konto braucht einen Namen.' using errcode = 'FIN03';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Der Name des Kontos ist zu lang.' using errcode = 'FIN03';
  end if;

  v_provider := nullif(btrim(coalesce(p_provider, '')), '');
  if v_provider is not null and char_length(v_provider) > 80 then
    raise exception 'Der Name der Bank ist zu lang.' using errcode = 'FIN03';
  end if;

  v_currency := upper(btrim(coalesce(p_currency, '')));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Die Währung braucht drei Buchstaben, zum Beispiel EUR.'
      using errcode = 'FIN03';
  end if;

  -- Der eine Punkt, an dem diese Funktion etwas ablehnt, das wie eine
  -- Kleinigkeit aussieht. Siehe Kopfzeile: nicht die alten Buchungen werden
  -- umgeschrieben, sondern der Wechsel wird abgelehnt.
  if v_currency is distinct from v_account.currency
     and public.finance_account_dependency(p_account_id) is not null then
    raise exception
      'Die Währung kann nicht mehr geändert werden, weil das Konto bereits Buchungen enthält.'
      using errcode = 'FIN01';
  end if;

  update public.finance_accounts
  set name       = v_name,
      provider   = v_provider,
      currency   = v_currency,
      updated_at = now()
  where id = p_account_id
  returning * into v_account;

  return v_account;
end;
$$;

comment on function public.finance_update_account(uuid, text, text, text) is
  'Name, Anbieter und Währung eines eigenen Kontos ändern. Die Währung nur, '
  'solange keine Finanzdaten daran hängen.';

revoke all on function public.finance_update_account(uuid, text, text, text) from public, anon;
grant execute on function public.finance_update_account(uuid, text, text, text) to authenticated;

-- ── 5. finance_set_account_archived ─────────────────────────────────────────
-- Archivieren und Reaktivieren sind ein Aufruf mit einem Schalter, weil sie
-- dieselbe Handlung in zwei Richtungen sind — und weil „Rückgängig" im Toast
-- damit buchstäblich derselbe Aufruf mit `false` ist.
--
-- Ein bereits archiviertes Konto behält seinen Zeitstempel: zweimal auf
-- „Archivieren" zu kommen darf nicht so aussehen, als wäre es gerade eben
-- passiert.
--
-- Es ist ausdrücklich ERLAUBT, ein leeres Konto zu archivieren. Die Oberfläche
-- bietet dort „Löschen" an, weil das die ehrlichere Antwort ist; eine Datenbank,
-- die deshalb das Archivieren verböte, würde eine Geschmacksfrage zu einem
-- Fehler machen.
create or replace function public.finance_set_account_archived(
  p_account_id uuid,
  p_archived   boolean
)
returns public.finance_accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.finance_accounts%rowtype;
begin
  v_account := public.finance_account_for_update(p_account_id);

  if p_archived is null then
    raise exception 'finance: archivieren oder reaktivieren?' using errcode = '22023';
  end if;

  update public.finance_accounts
  set archived_at = case
        when p_archived then coalesce(v_account.archived_at, now())
        else null
      end,
      updated_at = now()
  where id = p_account_id
  returning * into v_account;

  return v_account;
end;
$$;

comment on function public.finance_set_account_archived(uuid, boolean) is
  'Ein eigenes Konto archivieren oder reaktivieren. Buchungen, Importe und '
  'Regeln bleiben dabei unverändert.';

revoke all on function public.finance_set_account_archived(uuid, boolean) from public, anon;
grant execute on function public.finance_set_account_archived(uuid, boolean) to authenticated;

-- ── 6. finance_delete_empty_account ─────────────────────────────────────────
-- Das Löschen, das sich nicht auf `on delete cascade` verlässt.
--
-- Der Cascade bleibt am Fremdschlüssel stehen — er gehört dorthin, für den Tag,
-- an dem ein Benutzer sein Konto auflöst. Was er nie sein darf, ist der Weg,
-- auf dem ein Fehlgriff in einem Sheet eine Kontohistorie mitnimmt. Diese
-- Funktion ist deshalb der einzige Löschweg, den die App kennt, und sie fragt
-- vorher.
create or replace function public.finance_delete_empty_account(p_account_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.finance_accounts%rowtype;
  v_dep     text;
begin
  v_account := public.finance_account_for_update(p_account_id);

  v_dep := public.finance_account_dependency(p_account_id);
  if v_dep is not null then
    raise exception
      'Dieses Konto enthält bereits Finanzdaten und kann nur archiviert werden.'
      using errcode = 'FIN02', detail = format('abhängige Tabelle: %s', v_dep);
  end if;

  delete from public.finance_accounts
  where id = v_account.id and user_id = v_account.user_id;

  return v_account.id;
end;
$$;

comment on function public.finance_delete_empty_account(uuid) is
  'Ein eigenes Konto endgültig löschen — ausschließlich, wenn keine einzige '
  'Zeile per Fremdschlüssel darauf zeigt.';

revoke all on function public.finance_delete_empty_account(uuid) from public, anon;
grant execute on function public.finance_delete_empty_account(uuid) to authenticated;
