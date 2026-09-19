-- Der Stand NACH 0014 — verglichen, nicht geglaubt.
--
-- Läuft gegen die Datenbank, die `finance_category_upgrade_seed.sql` vor der
-- Migration befüllt hat. Jede Zusage von 0014 ist hier eine Zeile:
--
--   • die fünf Kategorie-IDs sind EXAKT dieselben wie vorher
--   • jeder Fremdschlüssel zeigt weiter auf dieselbe Zeile
--   • die bestehenden Regeln, Overrides, Vorschläge und Erinnerungen sind noch da
--   • die fünf sind jetzt Blätter unter der richtigen Oberkategorie
--   • die drei beschlossenen Umbenennungen sind passiert
--   • eine EIGENE Umbenennung des Nutzers wurde NICHT überschrieben
--   • beide Benutzer haben die vollständige Taxonomie

do $$
declare
  u1 uuid := '00000000-0000-4000-8000-000000000101';
  u2 uuid := '00000000-0000-4000-8000-000000000202';
  n  integer;
  r  record;
begin
  -- ── 1. Keine einzige ID hat sich geändert ────────────────────────────────
  for r in
    select b.what, b.category as before_id, c.id as after_id
    from public._cat_upgrade_before b
    left join public.finance_categories c
      on c.user_id = u1 and c.slug = replace(b.what, 'cat:', '')
    where b.what like 'cat:%'
  loop
    if r.after_id is null then
      raise exception 'UPGRADE: die Kategorie % gibt es nach 0014 nicht mehr', r.what;
    end if;
    if r.after_id <> r.before_id then
      raise exception 'UPGRADE: % hat eine neue id (% statt %)', r.what, r.after_id, r.before_id;
    end if;
  end loop;

  -- ── 2. Jeder Fremdschlüssel zeigt weiter auf dieselbe Zeile ──────────────
  select count(*) into n from public.finance_transactions t
   where t.user_id = u1
     and t.category_id = (select category from public._cat_upgrade_before where what = 'tx');
  if n <> 1 then raise exception 'UPGRADE: die Buchung hat ihre Kategorie verloren'; end if;

  select count(*) into n from public.finance_category_rules
   where user_id = u1
     and category_id = (select category from public._cat_upgrade_before where what = 'rule');
  if n <> 1 then raise exception 'UPGRADE: die Kategorieregel hat ihre Kategorie verloren'; end if;

  select count(*) into n from public.finance_transaction_overrides
   where user_id = u1
     and category_id = (select category from public._cat_upgrade_before where what = 'override');
  if n <> 1 then raise exception 'UPGRADE: der Override hat seine Kategorie verloren'; end if;

  select count(*) into n from public.finance_transaction_ai_suggestions
   where user_id = u1
     and category_id = (select category from public._cat_upgrade_before where what = 'suggestion');
  if n <> 1 then raise exception 'UPGRADE: der KI-Vorschlag hat seine Kategorie verloren'; end if;

  select count(*) into n from public.finance_ai_learning_memories
   where user_id = u1
     and category_id = (select category from public._cat_upgrade_before where what = 'memory')
     and suggested_category_id = (select category from public._cat_upgrade_before where what = 'rule');
  if n <> 1 then raise exception 'UPGRADE: die Erinnerung hat ihre Kategorien verloren'; end if;

  -- Und keine dieser Spalten steht plötzlich auf null (das wäre der stille
  -- Datenverlust, den `on delete set null` verursacht hätte, wenn 0014 die
  -- alten Zeilen gelöscht und neu angelegt hätte).
  select count(*) into n from public.finance_transactions
   where user_id = u1 and category_id is null;
  if n <> 0 then raise exception 'UPGRADE: % Buchungen stehen jetzt ohne Kategorie da', n; end if;

  -- ── 3. Die fünf sind Blätter unter der richtigen Oberkategorie ───────────
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = u1
    and ((c.slug = 'lebensmittel' and p.slug = 'essen_trinken')
      or (c.slug = 'restaurant'   and p.slug = 'essen_trinken')
      or (c.slug = 'klamotten'    and p.slug = 'shopping')
      or (c.slug = 'drogerie'     and p.slug = 'drogerie_pflege')
      or (c.slug = 'sonstige'     and p.slug = 'sonstiges_parent'));
  if n <> 5 then
    raise exception 'UPGRADE: nur % der fünf alten Kategorien hängen richtig', n;
  end if;

  -- ── 4. Die drei beschlossenen Umbenennungen ──────────────────────────────
  select count(*) into n from public.finance_categories
   where user_id = u1
     and ((slug = 'restaurant' and label = 'Restaurants & Cafés')
       or (slug = 'klamotten'  and label = 'Kleidung')
       or (slug = 'sonstige'   and label = 'Allgemeines Sonstiges'));
  if n <> 3 then
    raise exception 'UPGRADE: nur % der drei Umbenennungen sind passiert', n;
  end if;

  -- ── 5. …aber die eigene Umbenennung des Nutzers bleibt ───────────────────
  select count(*) into n from public.finance_categories
   where user_id = u2 and slug = 'restaurant' and label = 'Auswärts essen';
  if n <> 1 then
    raise exception 'UPGRADE: die eigene Umbenennung des Nutzers wurde überschrieben';
  end if;
  -- Und sie ist trotzdem eingehängt worden.
  select count(*) into n
  from public.finance_categories c
  join public.finance_categories p on p.id = c.parent_id
  where c.user_id = u2 and c.slug = 'restaurant' and p.slug = 'essen_trinken';
  if n <> 1 then
    raise exception 'UPGRADE: die umbenannte Kategorie wurde nicht eingehängt';
  end if;

  -- ── 6. Beide Benutzer haben die vollständige Taxonomie ───────────────────
  for r in select unnest(array[u1, u2]) as uid
  loop
    select count(*) into n from public.finance_categories where user_id = r.uid;
    if n <> 35 then
      raise exception 'UPGRADE: Benutzer % hat % Kategorien statt 35', r.uid, n;
    end if;
    select count(*) into n from public.finance_categories
     where user_id = r.uid and parent_id is null;
    if n <> 9 then
      raise exception 'UPGRADE: Benutzer % hat % Oberkategorien statt 9', r.uid, n;
    end if;
  end loop;

  -- ── 7. Und die Regel, die daran hängt, funktioniert weiter ───────────────
  -- Eine bestehende gültige Leaf-Zuordnung muss sich unverändert schreiben
  -- lassen; die Migration darf sie nicht nachträglich ungültig machen.
  update public.finance_transactions
     set category_id = (select category from public._cat_upgrade_before where what = 'cat:restaurant')
   where user_id = u1;
  update public.finance_transactions
     set category_id = (select category from public._cat_upgrade_before where what = 'tx')
   where user_id = u1;
end
$$;

select 'FINANCE-CATEGORY-UPGRADE: all assertions passed' as result;
