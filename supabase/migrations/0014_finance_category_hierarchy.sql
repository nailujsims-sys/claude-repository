-- 0014_finance_category_hierarchy — aus fünf flachen Kategorien wird eine
-- zweistufige Taxonomie, ohne dass eine einzige bestehende Zuordnung umzieht.
--
-- WAS DIESE MIGRATION NICHT TUT, und das ist ihr wichtigster Satz: sie legt
-- KEINE der fünf bestehenden Kategorien neu an. `lebensmittel`, `restaurant`,
-- `klamotten`, `drogerie` und `sonstige` behalten ihre `id`, und damit behalten
-- jede Buchung, jede Kategorieregel, jeder Override, jeder KI-Vorschlag und
-- jede gelernte Erinnerung ihren Fremdschlüssel. Eine ID zu ersetzen und die
-- Zeiger nachzuziehen wäre dieselbe Taxonomie mit einem Datenverlustrisiko
-- obendrauf; die fünf Zeilen bekommen deshalb nur ein `parent_id`, und drei von
-- ihnen ein neues Label.
--
-- ZWEI EBENEN, MEHR NICHT. `parent_id is null` = Oberkategorie,
-- `parent_id` gesetzt = Unterkategorie. Die dritte Ebene verhindert ein
-- Trigger, nicht eine Konvention: eine Hierarchie, die nur der Client einhält,
-- ist keine.
--
-- NUR BLÄTTER SIND ZUORDENBAR. Eine Oberkategorie ist eine Überschrift. Sie
-- darf nicht als Kategorie einer Buchung, einer Regel, eines Overrides, eines
-- KI-Vorschlags oder einer Erinnerung auftauchen — und zwar auf JEDEM
-- Schreibweg, nicht nur auf den dreien, die der Client heute benutzt. Dafür
-- gibt es eine Hilfsfunktion (`finance_category_is_leaf`) und EINEN
-- Trigger-Wächter, der an fünf Tabellen hängt, statt fünf Kopien derselben
-- Bedingung in fünf Policies und drei RPCs.
--
-- Sie ist additiv und zweimal einspielbar: jede Anweisung ist entweder
-- `if not exists`, `on conflict do nothing` oder ein Update, das beim zweiten
-- Lauf nichts mehr findet.

-- ── 1. Die Spalte ───────────────────────────────────────────────────────────
-- `on delete restrict`: eine Oberkategorie, an der Unterkategorien hängen, darf
-- nicht verschwinden — sonst blieben Blätter ohne Überschrift zurück und jede
-- Aggregation über `parent_id` hätte eine Lücke. Der Weg zu einer leeren
-- Oberkategorie führt über ihre Kinder, in dieser Reihenfolge, bewusst.
--
-- Für das Löschen eines BENUTZERS ist das unkritisch: `user_id` kaskadiert,
-- Eltern und Kinder verschwinden in derselben Anweisung, und die referentielle
-- Prüfung läuft am Ende der Anweisung — da ist kein Kind mehr übrig, das auf
-- eine gelöschte Oberkategorie zeigen könnte.
alter table public.finance_categories
  add column if not exists parent_id uuid references public.finance_categories (id)
    on delete restrict;

comment on column public.finance_categories.parent_id is
  'Die Oberkategorie. null = diese Zeile IST eine Oberkategorie. Genau zwei '
  'Ebenen; nur Zeilen mit gesetztem parent_id sind einer Buchung zuordenbar.';

-- „Alle Unterkategorien dieser Oberkategorie" ist die Frage, die das Dashboard
-- bei jeder Aggregation stellt.
create index if not exists finance_categories_user_parent_idx
  on public.finance_categories (user_id, parent_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'finance_categories_parent_not_self'
  ) then
    alter table public.finance_categories
      add constraint finance_categories_parent_not_self check (parent_id is null or parent_id <> id);
  end if;
end
$$;

-- ── 2. Genau zwei Ebenen, an der Tabelle ────────────────────────────────────
-- Vier Dinge, die eine zweistufige Taxonomie kaputt machen könnten, und alle
-- vier werden hier abgelehnt statt im Client vermieden:
--
--   • eine Oberkategorie, die es nicht gibt
--   • eine Oberkategorie, die einem anderen Benutzer gehört (die Policies
--     verbieten es bereits — hier steht der lesbare Satz dazu)
--   • eine Oberkategorie, die selbst schon ein Kind ist  → dritte Ebene
--   • eine Zeile, die Kinder hat und selbst zum Kind gemacht wird → dritte Ebene
create or replace function public.finance_categories_hierarchy_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.finance_categories%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into v_parent
  from public.finance_categories
  where id = new.parent_id;

  if not found then
    raise exception 'finance: Oberkategorie % gibt es nicht', new.parent_id using errcode = 'P0002';
  end if;
  if v_parent.user_id is distinct from new.user_id then
    raise exception 'finance: die Oberkategorie gehoert zu einem anderen Konto' using errcode = '42501';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'finance: eine dritte Kategorieebene gibt es nicht' using errcode = '22023';
  end if;
  if exists (select 1 from public.finance_categories c where c.parent_id = new.id) then
    raise exception 'finance: % hat selbst Unterkategorien und kann keine werden', new.slug
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists finance_categories_hierarchy on public.finance_categories;
create trigger finance_categories_hierarchy
  before insert or update of parent_id, user_id on public.finance_categories
  for each row execute function public.finance_categories_hierarchy_guard();

-- ── 3. „Darf diese Kategorie einer Buchung zugeordnet werden?" ──────────────
-- EINE Antwort, an EINER Stelle. Null geht durch, weil „keine Kategorie" eine
-- gültige Angabe ist — eine Buchung ohne Einordnung ist offen, nicht falsch.
--
-- Bewusst kein `security definer`: die Funktion läuft als Aufrufer, unter
-- derselben RLS wie alles andere. Eine fremde Kategorie ist damit unsichtbar
-- und fällt in dieselbe Ablehnung wie eine Oberkategorie — die Eigentümerschaft
-- prüfen ohnehin die Policies aus 0008 mit `finance_owns_category`.
create or replace function public.finance_category_is_leaf(p_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_id is null or exists (
    select 1 from public.finance_categories c
    where c.id = p_id and c.parent_id is not null
  );
$$;

-- Der Wächter. Er bekommt die zu prüfenden Spalten als Trigger-Argumente, damit
-- dieselbe Funktion an `finance_transactions.category_id` und an
-- `finance_ai_learning_memories.(category_id, suggested_category_id)` hängen
-- kann, ohne dass jemand sie kopiert.
create or replace function public.finance_category_assignable_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text;
  v_value  uuid;
  v_slug   text;
begin
  foreach v_column in array tg_argv
  loop
    execute format('select ($1).%I::uuid', v_column) into v_value using new;
    if v_value is not null and not public.finance_category_is_leaf(v_value) then
      select slug into v_slug from public.finance_categories where id = v_value;
      raise exception
        'finance: % ist eine Oberkategorie und kann nicht zugeordnet werden',
        coalesce(v_slug, v_value::text)
        using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists finance_transactions_category_assignable on public.finance_transactions;
create trigger finance_transactions_category_assignable
  before insert or update of category_id on public.finance_transactions
  for each row execute function public.finance_category_assignable_guard('category_id');

drop trigger if exists finance_overrides_category_assignable on public.finance_transaction_overrides;
create trigger finance_overrides_category_assignable
  before insert or update of category_id on public.finance_transaction_overrides
  for each row execute function public.finance_category_assignable_guard('category_id');

drop trigger if exists finance_category_rules_category_assignable on public.finance_category_rules;
create trigger finance_category_rules_category_assignable
  before insert or update of category_id on public.finance_category_rules
  for each row execute function public.finance_category_assignable_guard('category_id');

-- Die beiden Tabellen aus 0011/0012 sind optional vorhanden, wenn jemand diese
-- Datei gegen eine ältere Datenbank laufen lässt — der Trigger wird deshalb nur
-- gehängt, wenn es die Tabelle gibt.
do $$
begin
  if to_regclass('public.finance_transaction_ai_suggestions') is not null then
    execute 'drop trigger if exists finance_ai_suggestions_category_assignable
             on public.finance_transaction_ai_suggestions';
    execute 'create trigger finance_ai_suggestions_category_assignable
             before insert or update of category_id
             on public.finance_transaction_ai_suggestions
             for each row execute function public.finance_category_assignable_guard(''category_id'')';
  end if;

  if to_regclass('public.finance_ai_learning_memories') is not null then
    execute 'drop trigger if exists finance_ai_memories_category_assignable
             on public.finance_ai_learning_memories';
    execute 'create trigger finance_ai_memories_category_assignable
             before insert or update of category_id, suggested_category_id
             on public.finance_ai_learning_memories
             for each row execute function
             public.finance_category_assignable_guard(''category_id'', ''suggested_category_id'')';
  end if;
end
$$;

revoke all on function public.finance_category_is_leaf(uuid) from public, anon;
grant execute on function public.finance_category_is_leaf(uuid) to authenticated;
revoke all on function public.finance_categories_hierarchy_guard() from public, anon, authenticated;
revoke all on function public.finance_category_assignable_guard() from public, anon, authenticated;

-- ── 4. Die Taxonomie ────────────────────────────────────────────────────────
-- Dieselbe Liste wie src/config/finance.js, in derselben Reihenfolge — jede
-- Oberkategorie VOR ihren Kindern, weil der Trigger aus Abschnitt 2 die
-- Elternzeile schon sehen muss. tools/financeLogic.mjs liest beide Listen
-- gegeneinander und schlägt fehl, sobald sie auseinanderlaufen.
--
-- `finance_default_categories()` bekommt eine vierte Spalte. Der Rückgabetyp
-- ändert sich damit, und den kann `create or replace` nicht ändern — also erst
-- weg, dann neu. Der einzige Aufrufer ist `finance_seed_categories()`, das
-- gleich darunter ebenfalls neu geschrieben wird.
drop function if exists public.finance_default_categories();

create or replace function public.finance_default_categories()
returns table (slug text, label text, sort_order integer, parent_slug text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('essen_trinken',        'Essen & Trinken',       100, null),
    ('lebensmittel',         'Lebensmittel',          110, 'essen_trinken'),
    ('restaurant',           'Restaurants & Cafés',   120, 'essen_trinken'),
    ('shopping',             'Shopping',              200, null),
    ('klamotten',            'Kleidung',              210, 'shopping'),
    ('technik',              'Technik',               220, 'shopping'),
    ('shopping_sonstige',    'Allgemeines Shopping',  230, 'shopping'),
    ('mobilitaet',           'Mobilität',             300, null),
    ('auto_tanken',          'Auto & Tanken',         310, 'mobilitaet'),
    ('bahn_oepnv',           'Bahn & ÖPNV',           320, 'mobilitaet'),
    ('taxi_sharing',         'Taxi & Sharing',        330, 'mobilitaet'),
    ('parken',               'Parken',                340, 'mobilitaet'),
    ('fluege',               'Flüge',                 350, 'mobilitaet'),
    ('drogerie_pflege',      'Drogerie & Pflege',     400, null),
    ('drogerie',             'Drogerie',              410, 'drogerie_pflege'),
    ('friseur_pflege',       'Friseur & Pflege',      420, 'drogerie_pflege'),
    ('wohnen_haushalt',      'Wohnen & Haushalt',     500, null),
    ('miete_nebenkosten',    'Miete & Nebenkosten',   510, 'wohnen_haushalt'),
    ('haushalt',             'Haushalt',              520, 'wohnen_haushalt'),
    ('moebel_einrichtung',   'Möbel & Einrichtung',   530, 'wohnen_haushalt'),
    ('freizeit',             'Freizeit',              600, null),
    ('events_kultur',        'Events & Kultur',       610, 'freizeit'),
    ('games_medien',         'Games & Medien',        620, 'freizeit'),
    ('ausgehen',             'Ausgehen',              630, 'freizeit'),
    ('freizeit_sonstige',    'Allgemeine Freizeit',   640, 'freizeit'),
    ('gesundheit_sport',     'Gesundheit & Sport',    700, null),
    ('gesundheit',           'Gesundheit',            710, 'gesundheit_sport'),
    ('fitnessstudio',        'Fitnessstudio',         720, 'gesundheit_sport'),
    ('sport_ausruestung',    'Sportausrüstung',       730, 'gesundheit_sport'),
    ('bildung',              'Bildung',               800, null),
    ('studium_schule',       'Studium & Schule',      810, 'bildung'),
    ('buecher_lernmaterial', 'Bücher & Lernmaterial', 820, 'bildung'),
    ('kurse_weiterbildung',  'Kurse & Weiterbildung', 830, 'bildung'),
    ('sonstiges_parent',     'Sonstiges',             900, null),
    ('sonstige',             'Allgemeines Sonstiges', 910, 'sonstiges_parent')
  ) as c(slug, label, sort_order, parent_slug);
$$;

-- Die eine Prozedur, die aus der Liste oben Zeilen macht — benutzt vom
-- Signup-Trigger und vom Backfill ganz unten, damit die beiden nie
-- auseinanderlaufen können.
--
-- Sie ist idempotent in beide Richtungen: fehlende Zeilen entstehen, vorhandene
-- bekommen ihr `parent_id` und ihre Sortierung. Ein Label wird NUR ersetzt,
-- solange es noch das ursprünglich ausgelieferte trägt — wer „Restaurant" selbst
-- in „Auswärts essen" umbenannt hat, behält seinen Namen, und v1.26 nimmt ihm
-- den nicht wieder weg.
create or replace function public.finance_apply_category_taxonomy(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Die Oberkategorien. Erst sie, dann die Kinder.
  insert into public.finance_categories (user_id, slug, label, sort_order, is_system, parent_id)
  select p_user, d.slug, d.label, d.sort_order, true, null
  from public.finance_default_categories() d
  where d.parent_slug is null
  on conflict (user_id, slug) do nothing;

  -- 2. Die Unterkategorien, mit aufgelöster Oberkategorie.
  insert into public.finance_categories (user_id, slug, label, sort_order, is_system, parent_id)
  select p_user, d.slug, d.label, d.sort_order, true, p.id
  from public.finance_default_categories() d
  join public.finance_categories p on p.user_id = p_user and p.slug = d.parent_slug
  where d.parent_slug is not null
  on conflict (user_id, slug) do nothing;

  -- 3. Die Zeilen, die es schon gab: einhängen und einsortieren. Das ist der
  --    Schritt, der die fünf alten Kategorien in die Hierarchie holt, ohne eine
  --    einzige ID anzufassen.
  update public.finance_categories c
  set parent_id = p.id,
      sort_order = d.sort_order
  from public.finance_default_categories() d
  join public.finance_categories p on p.user_id = p_user and p.slug = d.parent_slug
  where c.user_id = p_user
    and c.slug = d.slug
    and d.parent_slug is not null
    and (c.parent_id is distinct from p.id or c.sort_order is distinct from d.sort_order);

  update public.finance_categories c
  set sort_order = d.sort_order
  from public.finance_default_categories() d
  where c.user_id = p_user
    and c.slug = d.slug
    and d.parent_slug is null
    and c.parent_id is null
    and c.sort_order is distinct from d.sort_order;

  -- 4. Die drei beschlossenen Umbenennungen — nur, wo das alte Label noch steht.
  update public.finance_categories
  set label = 'Restaurants & Cafés'
  where user_id = p_user and slug = 'restaurant' and label = 'Restaurant';

  update public.finance_categories
  set label = 'Kleidung'
  where user_id = p_user and slug = 'klamotten' and label = 'Klamotten';

  update public.finance_categories
  set label = 'Allgemeines Sonstiges'
  where user_id = p_user and slug = 'sonstige' and label = 'Sonstige';
end;
$$;

create or replace function public.finance_seed_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.finance_apply_category_taxonomy(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_finance on auth.users;
create trigger on_auth_user_created_finance
  after insert on auth.users
  for each row execute function public.finance_seed_categories();

revoke all on function public.finance_default_categories() from public, anon;
grant execute on function public.finance_default_categories() to authenticated;
revoke all on function public.finance_apply_category_taxonomy(uuid) from public, anon, authenticated;
revoke all on function public.finance_seed_categories() from public, anon, authenticated;

-- ── 5. Was der Wächter aus Abschnitt 3 mit abdeckt ─────────────────────────
-- Die drei Funktionen, über die dieses Modul schreibt — `finance_learn_merchant_rule`
-- (0008, schlägt die Kategorie über ihren Slug nach),
-- `finance_create_manual_transaction` (0011) und `finance_apply_ai_import`
-- (0012) — bleiben Wort für Wort, wie sie sind. Keine von ihnen ist
-- `security definer`, alle drei schreiben in `finance_transactions`,
-- `finance_transaction_overrides`, `finance_category_rules` oder
-- `finance_transaction_ai_suggestions`, und an jeder dieser Tabellen hängt der
-- Wächter. Eine Oberkategorie wird also auf jedem dieser Wege abgelehnt, mit
-- demselben Satz, und die ganze Funktion rollt zurück.
--
-- DAS IST DER PUNKT DIESER BAUWEISE, und der Grund, warum hier nichts kopiert
-- wird: die Regel „nur Blätter sind zuordenbar" steht einmal
-- (`finance_category_is_leaf`), wird einmal durchgesetzt
-- (`finance_category_assignable_guard`) und gilt dadurch auch für den vierten
-- Schreibweg, den heute noch niemand geschrieben hat. Drei große Funktionen
-- nachzubauen, nur um dieselbe Bedingung ein zweites Mal hineinzuschreiben,
-- wäre die Variante, bei der eine davon beim nächsten Mal vergessen wird.

-- ── 6. Die bestehenden Konten ───────────────────────────────────────────────
-- Derselbe Abschluss wie 0008 und 0013: der Trigger deckt jedes künftige Konto
-- ab, diese Schleife die, die es schon gibt. Zweimal ausgeführt ändert sie
-- nichts mehr.
do $$
declare
  u record;
begin
  for u in select id from auth.users
  loop
    perform public.finance_apply_category_taxonomy(u.id);
  end loop;
end
$$;
