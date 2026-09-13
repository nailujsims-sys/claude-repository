-- Mind Whiteboard — Row Level Security verification.
--
-- Proves, against the real schema, that a signed-in user can reach their own
-- rows and nothing else. Everything happens inside one transaction that ends
-- in ROLLBACK, so running it leaves no users, no tasks and no events behind.
--
-- Two ways to run it:
--   • Supabase Dashboard → SQL Editor → paste → Run. A green result means all
--     assertions held; any FAIL aborts with the message.
--   • Locally against a throwaway Postgres: `npm run test:rls`
--     (tools/rlsTest.mjs boots a cluster, applies the migrations, runs this).
--
-- Each assertion states what an attacker would achieve if it failed.

begin;

do $$
declare
  user_a   uuid := gen_random_uuid();
  user_b   uuid := gen_random_uuid();
  task_a   uuid;
  event_a  uuid;
  list_a   uuid;
  list_b   uuid;
  item_a   uuid;
  expense_a uuid;
  n        integer;
  ok       boolean;
  ok_text  text;
  event_local uuid;
begin
  -- ── Setup: two accounts, created the way Supabase creates them ────────────
  insert into auth.users (id, email) values
    (user_a, 'rls-a@mindwhiteboard.test'),
    (user_b, 'rls-b@mindwhiteboard.test');

  select count(*) into n from public.profiles where id in (user_a, user_b);
  if n <> 2 then
    raise exception 'FAIL: signup trigger did not create both profiles (found %)', n;
  end if;

  -- ── 1. The signed-in user may create their own rows ───────────────────────
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  insert into public.tasks (user_id, title, category)
    values (user_a, 'Aufgabe von A', 'Privat')
    returning id into task_a;
  insert into public.events (user_id, title, start_at, end_at)
    values (user_a, 'Termin von A', '2026-09-02T09:00', '2026-09-02T10:00')
    returning id into event_a;
  insert into public.lists (user_id, name, template, icon)
    values (user_a, 'Liste von A', 'shopping', 'shopping-cart')
    returning id into list_a;
  insert into public.list_items (user_id, list_id, title, quantity, unit)
    values (user_a, list_a, 'Äpfel', 6, 'Stück')
    returning id into item_a;
  insert into public.expenses (user_id, title, original_amount, original_currency, transaction_date, exchange_rate_aud_eur)
    values (user_a, 'Kaffee in Sydney', 5.50, 'AUD', current_date, 0.58)
    returning id into expense_a;

  -- ── 2. …and read them back ───────────────────────────────────────────────
  select count(*) into n from public.tasks;
  if n <> 1 then raise exception 'FAIL: A sees % of their own tasks, expected 1', n; end if;
  select count(*) into n from public.events;
  if n <> 1 then raise exception 'FAIL: A sees % of their own events, expected 1', n; end if;
  select count(*) into n from public.lists;
  if n <> 1 then raise exception 'FAIL: A sees % of their own lists, expected 1', n; end if;
  select count(*) into n from public.list_items;
  if n <> 1 then raise exception 'FAIL: A sees % of their own list entries, expected 1', n; end if;
  select count(*) into n from public.expenses;
  if n <> 1 then raise exception 'FAIL: A sees % of their own expenses, expected 1', n; end if;

  -- ── 3. …and update and soft-delete them ──────────────────────────────────
  update public.tasks set title = 'Aufgabe von A, bearbeitet' where id = task_a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not update their own task'; end if;

  -- ── 4. A row may not be handed to another user ───────────────────────────
  ok := false;
  begin
    update public.tasks set user_id = user_b where id = task_a;
  exception when others then
    ok := true;                       -- the WITH CHECK half of the policy
  end;
  if not ok then
    select count(*) into n from public.tasks where id = task_a;
    if n > 0 then
      raise exception 'FAIL: A moved their task into B''s account';
    end if;
  end if;

  ok := false;
  begin
    insert into public.tasks (user_id, title) values (user_b, 'Untergeschobene Aufgabe');
    ok := false;
  exception when others then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: A could insert a task owned by B'; end if;

  -- ── 4b. An entry may not be parked inside somebody else's list ────────────
  -- The second half of `list_items_insert_own`: an entry that is correctly
  -- owned but points at a foreign list has to be refused too, or A could fill
  -- B's shopping list with rows B can neither see nor remove.
  execute 'reset role';
  insert into public.lists (user_id, name) values (user_b, 'Liste von B') returning id into list_b;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  ok := false;
  begin
    insert into public.list_items (user_id, list_id, title) values (user_a, list_b, 'Untergeschoben');
  exception when others then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: A put an entry into B''s list'; end if;

  ok := false;
  begin
    update public.list_items set list_id = list_b where id = item_a;
  exception when others then
    ok := true;
  end;
  if not ok then
    select count(*) into n from public.list_items where id = item_a and list_id = list_b;
    if n > 0 then raise exception 'FAIL: A moved an entry into B''s list'; end if;
  end if;

  -- ── 5. The other user sees none of it ────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.tasks;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s tasks', n; end if;
  select count(*) into n from public.events;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s events', n; end if;
  select count(*) into n from public.lists where id = list_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s lists', n; end if;
  select count(*) into n from public.list_items;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s list entries', n; end if;
  select count(*) into n from public.expenses;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s expenses', n; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: B sees % profiles, expected only their own', n; end if;

  -- ── 6. …and can neither change nor delete it ─────────────────────────────
  update public.tasks set title = 'Von B übernommen' where id = task_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated % of A''s tasks', n; end if;

  delete from public.tasks where id = task_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s tasks', n; end if;

  delete from public.events where id = event_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s events', n; end if;

  delete from public.lists where id = list_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s lists', n; end if;

  delete from public.list_items where id = item_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s list entries', n; end if;

  -- An expense is money: reading somebody else's is a privacy breach, changing
  -- one is a lie about what they spent.
  update public.expenses set original_amount = 999 where id = expense_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated % of A''s expenses', n; end if;

  delete from public.expenses where id = expense_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s expenses', n; end if;

  -- ── 7. Without a session there is nothing at all ─────────────────────────
  -- Two layers have to hold here: the grants (anon has none) and, if a grant
  -- were ever handed out by mistake, the policies, which are scoped to the
  -- `authenticated` role. Either outcome is a pass; a readable row is not.
  execute 'set local role anon';
  perform set_config('request.jwt.claims', null, true);

  begin
    execute 'select count(*) from public.tasks' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % tasks', n; end if;
  exception when insufficient_privilege then null;   -- no grant: also a pass
  end;

  begin
    execute 'select count(*) from public.events' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % events', n; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select count(*) from public.lists' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % lists', n; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select count(*) from public.list_items' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % list entries', n; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select count(*) from public.expenses' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % expenses', n; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select count(*) from public.profiles' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % profiles', n; end if;
  exception when insufficient_privilege then null;
  end;

  ok := false;
  begin
    execute format('insert into public.tasks (user_id, title) values (%L, %L)', user_a, 'Von anon');
  exception when others then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: an unauthenticated client inserted a task'; end if;

  -- ── 8. The Google integration ────────────────────────────────────────────
  -- The rule this section exists for: a browser may see *that* it is connected
  -- and *which* calendars there are, and may never see the tokens behind them.
  execute 'reset role';

  -- Two connected accounts, written the way the sync service writes them.
  insert into public.google_connections (user_id, google_account_email, default_calendar_id)
    values (user_a, 'a@example.test', 'a-privat'), (user_b, 'b@example.test', 'b-privat');
  insert into public.google_credentials (user_id, access_token, refresh_token)
    values (user_a, 'token-a', 'refresh-a'), (user_b, 'token-b', 'refresh-b');
  insert into public.google_calendars (user_id, google_calendar_id, summary, access_role, is_selected)
    values (user_a, 'a-privat', 'A privat', 'owner', true),
           (user_b, 'b-privat', 'B privat', 'owner', true);
  insert into public.google_channels (id, user_id, google_calendar_id, token)
    values ('chan-a', user_a, 'a-privat', 'secret-a');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  -- A sees their own connection, and only their own.
  select count(*) into n from public.google_connections;
  if n <> 1 then raise exception 'FAIL: A sees % Google connections, expected only their own', n; end if;
  select count(*) into n from public.google_connections where user_id = user_b;
  if n <> 0 then raise exception 'FAIL: A can see B''s Google connection'; end if;

  select count(*) into n from public.google_calendars;
  if n <> 1 then raise exception 'FAIL: A sees % Google calendars, expected only their own', n; end if;

  -- The tokens. Not "A cannot see B''s" — A cannot see *any*, including their
  -- own: the browser has no grant on this table at all, which is what keeps a
  -- Google refresh token out of a client bundle even if a policy were added
  -- by accident later.
  ok := false;
  begin
    execute 'select count(*) from public.google_credentials' into n;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: a signed-in client could read google_credentials'; end if;

  ok := false;
  begin
    execute 'select count(*) from public.google_channels' into n;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: a signed-in client could read google_channels'; end if;

  ok := false;
  begin
    execute 'select count(*) from public.google_event_tombstones' into n;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: a signed-in client could read google_event_tombstones'; end if;

  -- The connection and the calendar list are read-only for the client: every
  -- change goes through an Edge Function, so a browser cannot mark a broken
  -- sync as healthy or point a connection somewhere else.
  ok := false;
  begin
    execute format('update public.google_connections set status = %L where user_id = %L', 'connected', user_a);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: a client could write to google_connections'; end if;

  ok := false;
  begin
    execute format('update public.google_calendars set is_selected = false where user_id = %L', user_a);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: a client could write to google_calendars'; end if;

  -- ── 9. The triggers that keep the sync honest ────────────────────────────
  -- A change made by a device owes Google something; a change made by the sync
  -- service does not. That single distinction is what stops the echo loop.
  insert into public.events (user_id, title, start_at, end_at, google_calendar_id, sync_enabled)
    values (user_a, 'Termin in Google', '2026-09-03T09:00', '2026-09-03T10:00', 'a-privat', true)
    returning id into event_a;
  select sync_state into strict ok_text from public.events where id = event_a;
  if ok_text <> 'pending' then
    raise exception 'FAIL: an event created on a device was not marked pending (got %)', ok_text;
  end if;

  -- An app-only event never becomes Google''s business.
  insert into public.events (user_id, title, start_at, end_at, sync_enabled)
    values (user_a, 'Nur in der App', '2026-09-03T11:00', '2026-09-03T12:00', false)
    returning id into event_local;
  select sync_state into strict ok_text from public.events where id = event_local;
  if ok_text <> 'local' then
    raise exception 'FAIL: an app-only event was marked % instead of local', ok_text;
  end if;

  -- Deleting a synced event leaves the tombstone the sync service needs; the
  -- client cannot write one itself, which is why the trigger is definer.
  execute 'reset role';
  update public.events set google_event_id = 'gev-1', sync_state = 'synced' where id = event_a;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  delete from public.events where id = event_a;
  execute 'reset role';
  select count(*) into n from public.google_event_tombstones
    where user_id = user_a and google_event_id = 'gev-1';
  if n <> 1 then raise exception 'FAIL: deleting a synced event left no tombstone for Google'; end if;

  -- Deleting an app-only event must never reach Google.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  delete from public.events where id = event_local;
  execute 'reset role';
  select count(*) into n from public.google_event_tombstones where user_id = user_a;
  if n <> 1 then raise exception 'FAIL: deleting an app-only event produced a Google tombstone'; end if;

  -- Switching the sync off on an event that is already in Google takes it out
  -- of Google rather than leaving a second copy behind (§14).
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.events (user_id, title, start_at, end_at, google_calendar_id, sync_enabled)
    values (user_a, 'Wird lokal', '2026-09-04T09:00', '2026-09-04T10:00', 'a-privat', true)
    returning id into event_a;
  execute 'reset role';
  update public.events set google_event_id = 'gev-2', sync_state = 'synced' where id = event_a;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  update public.events set sync_enabled = false where id = event_a;

  execute 'reset role';
  select count(*) into n from public.google_event_tombstones
    where user_id = user_a and google_event_id = 'gev-2';
  if n <> 1 then raise exception 'FAIL: switching the sync off left the Google copy in place'; end if;
  select sync_state into strict ok_text from public.events where id = event_a;
  if ok_text <> 'local' then
    raise exception 'FAIL: an event taken out of Google is still %', ok_text;
  end if;
  select count(*) into n from public.events where id = event_a and google_event_id is null;
  if n <> 1 then raise exception 'FAIL: an event taken out of Google kept its Google id'; end if;

  -- ── 9b. Deleting a list takes its entries with it ────────────────────────
  -- `on delete cascade` is what stops a delete from leaving rows behind that
  -- belong to a list nobody can reach any more.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.list_items where list_id = list_a;
  if n <> 1 then raise exception 'FAIL: A''s entry vanished before the cascade test (found %)', n; end if;

  delete from public.lists where id = list_a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not delete their own list'; end if;

  select count(*) into n from public.list_items where list_id = list_a;
  if n <> 0 then raise exception 'FAIL: % entries survived the deletion of their list', n; end if;

  -- ── 9c. An expense the overview could not read ───────────────────────────
  -- The three columns every total depends on: an amount it can add up, a
  -- currency it can convert, and a rate it can divide by. All three are
  -- refused by the database, not only by the form — a row that slipped past
  -- the client would poison every sum it appears in, silently and forever.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  ok := false;
  begin
    insert into public.expenses (user_id, title, original_amount, original_currency, exchange_rate_aud_eur)
      values (user_a, 'Nullausgabe', 0, 'AUD', 0.58);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an expense of zero was accepted'; end if;

  ok := false;
  begin
    insert into public.expenses (user_id, title, original_amount, original_currency, exchange_rate_aud_eur)
      values (user_a, 'Dollarausgabe', 10, 'USD', 0.58);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an expense in an unknown currency was accepted'; end if;

  ok := false;
  begin
    insert into public.expenses (user_id, title, original_amount, original_currency, exchange_rate_aud_eur)
      values (user_a, 'Ohne Kurs', 10, 'AUD', 0);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an expense with a rate of zero was accepted'; end if;

  ok := false;
  begin
    insert into public.expenses (user_id, title, original_amount, original_currency, exchange_rate_aud_eur)
      values (user_a, '   ', 10, 'AUD', 0.58);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a nameless expense was accepted'; end if;

  -- The date defaults to today, which is what "Transaktionsdatum automatisch
  -- auf das aktuelle Datum setzen" rests on when the client sends none.
  insert into public.expenses (user_id, title, original_amount, original_currency, exchange_rate_aud_eur)
    values (user_a, 'Ohne Datum', 10, 'AUD', 0.58);
  select count(*) into n from public.expenses
    where title = 'Ohne Datum' and transaction_date = current_date;
  if n <> 1 then raise exception 'FAIL: an expense without a date did not default to today'; end if;

  -- ── 10. Every personal table actually has RLS switched on ────────────────
  execute 'reset role';
  select count(*) into n
  from pg_tables t
  join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
  where t.schemaname = 'public' and not c.relrowsecurity;
  if n <> 0 then
    raise exception 'FAIL: % table(s) in public have no row level security', n;
  end if;

  raise notice 'RLS: all assertions passed';
end;
$$;

-- ── 11. Finanzen ────────────────────────────────────────────────────────────
-- Its own block, with its own two accounts: the finance module is the newest
-- and the most sensitive part of the schema, and keeping it self-contained
-- means an assertion added here can never disturb the ones above. Still inside
-- the same transaction, so the closing ROLLBACK takes it with everything else.
--
-- Three things are proved here that cannot be proved anywhere else, because all
-- three are database behaviour: the isolation between two accounts (18), that
-- learning a merchant writes all of merchant + pattern + rule + booking (16),
-- and that a learning call which fails halfway leaves nothing behind (17).
do $$
declare
  user_a      uuid := gen_random_uuid();
  user_b      uuid := gen_random_uuid();
  acc_a       uuid;
  acc_b       uuid;
  tx_a        uuid;
  tx_second   uuid;
  tx_locked   uuid;
  tx_override uuid;
  tx_taken    uuid;
  tx_b        uuid;
  merch_a     uuid;
  merch_b     uuid;
  cat_food    uuid;
  n           integer;
  ok          boolean;
  res         jsonb;
begin
  insert into auth.users (id, email) values
    (user_a, 'rls-fin-a@mindwhiteboard.test'),
    (user_b, 'rls-fin-b@mindwhiteboard.test');

  -- ── The seeded categories ────────────────────────────────────────────────
  -- Every account starts with the five agreed MVP categories, created by the
  -- signup trigger the way the profile is.
  select count(*) into n from public.finance_categories where user_id = user_a;
  if n <> 5 then
    raise exception 'FAIL: a new account got % finance categories, expected 5', n;
  end if;
  select count(*) into n from public.finance_categories
   where user_id = user_a
     and slug in ('lebensmittel', 'restaurant', 'klamotten', 'drogerie', 'sonstige');
  if n <> 5 then raise exception 'FAIL: the seeded categories are not the agreed five'; end if;

  -- The old Excel tracker had an "Events" column. It is not a category here,
  -- and nothing in this schema may quietly turn it into one.
  select count(*) into n from public.finance_categories where slug = 'events';
  if n <> 0 then raise exception 'FAIL: an "Events" category was seeded'; end if;

  -- ── A fills their account ────────────────────────────────────────────────
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  insert into public.finance_accounts (user_id, name, provider)
    values (user_a, 'DKB Giro', 'DKB') returning id into acc_a;

  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description)
    values (user_a, acc_a, '2026-09-05', -2483, 'EUR', 'REWE TROISDORF SAGT DANKE 8407')
    returning id into tx_a;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description)
    values (user_a, acc_a, '2026-09-06', -1207, 'EUR', 'REWE MARKT KOELN')
    returning id into tx_second;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, manual_lock)
    values (user_a, acc_a, '2026-09-07', -999, 'EUR', 'REWE CITY BONN', true)
    returning id into tx_locked;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description)
    values (user_a, acc_a, '2026-09-08', -1500, 'EUR', 'REWE SUED KOELN')
    returning id into tx_override;
  insert into public.finance_transaction_overrides (user_id, transaction_id, include_in_analytics)
    values (user_a, tx_override, false);

  select id into cat_food from public.finance_categories where user_id = user_a and slug = 'lebensmittel';

  -- A booking that already belongs to a merchant must not be re-labelled by a
  -- later rule run either.
  insert into public.finance_merchants (user_id, canonical_name) values (user_a, 'Drogerie')
    returning id into merch_a;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, merchant_id)
    values (user_a, acc_a, '2026-09-09', -700, 'EUR', 'REWE TO GO KOELN', merch_a)
    returning id into tx_taken;

  -- ── 16. Learning a merchant: one call, five consistent writes ────────────
  res := public.finance_learn_merchant_rule(
    p_transaction_id        => tx_a,
    p_category_slug         => 'lebensmittel',
    p_pattern_type          => 'exact_token',
    p_tokens                => array['REWE'],
    p_merchant_name         => 'REWE',
    p_apply_transaction_ids => array[tx_second, tx_locked, tx_override, tx_taken]
  );

  if not (res ->> 'merchant_created')::boolean then raise exception 'FAIL: the merchant was not created'; end if;
  if not (res ->> 'pattern_created')::boolean then raise exception 'FAIL: the pattern was not created'; end if;
  if not (res ->> 'rule_created')::boolean then raise exception 'FAIL: the category rule was not created'; end if;

  select count(*) into n from public.finance_merchants where user_id = user_a and canonical_name = 'REWE';
  if n <> 1 then raise exception 'FAIL: % merchants named REWE after learning, expected 1', n; end if;

  select count(*) into n from public.finance_merchant_patterns
   where user_id = user_a and tokens = array['REWE'] and pattern_type = 'exact_token' and active;
  if n <> 1 then raise exception 'FAIL: % active REWE patterns, expected 1', n; end if;

  select count(*) into n from public.finance_category_rules
   where user_id = user_a and category_id = cat_food
     and min_amount_minor is null and max_amount_minor is null and active;
  if n <> 1 then raise exception 'FAIL: % default rules for REWE, expected 1', n; end if;

  select count(*) into n from public.finance_transactions
   where id = tx_a and merchant_id = (res ->> 'merchant_id')::uuid and category_id = cat_food;
  if n <> 1 then raise exception 'FAIL: the booking the user acted on was not assigned'; end if;

  -- The booking the backtest found and nobody had touched.
  if (res ->> 'applied_count')::integer <> 1 then
    raise exception 'FAIL: % further bookings were re-labelled, expected exactly the untouched one',
      (res ->> 'applied_count')::integer;
  end if;
  select count(*) into n from public.finance_transactions where id = tx_second and category_id = cat_food;
  if n <> 1 then raise exception 'FAIL: an untouched booking was not re-labelled'; end if;

  -- 14 again, this time in the database: a decision a human made survives a
  -- rule run, whichever ids the client sends along.
  select count(*) into n from public.finance_transactions where id = tx_locked and merchant_id is null;
  if n <> 1 then raise exception 'FAIL: a manually locked booking was overwritten by a rule run'; end if;
  select count(*) into n from public.finance_transactions where id = tx_override and merchant_id is null;
  if n <> 1 then raise exception 'FAIL: a booking with a manual override was overwritten by a rule run'; end if;
  select count(*) into n from public.finance_transactions where id = tx_taken and merchant_id = merch_a;
  if n <> 1 then raise exception 'FAIL: a booking that already had a merchant was re-labelled'; end if;

  -- Running the same gesture twice changes nothing: no second merchant, no
  -- second pattern, no second rule.
  res := public.finance_learn_merchant_rule(
    p_transaction_id => tx_a,
    p_category_slug  => 'lebensmittel',
    p_pattern_type   => 'exact_token',
    p_tokens         => array['REWE'],
    p_merchant_name  => 'rewe'
  );
  if (res ->> 'merchant_created')::boolean or (res ->> 'pattern_created')::boolean
     or (res ->> 'rule_created')::boolean then
    raise exception 'FAIL: learning the same merchant twice created a second one';
  end if;

  -- ── 17. Atomicity: half a decision is never stored ───────────────────────
  -- The category slug does not exist, and the merchant name is new. If the
  -- writes were independent, the merchant would be sitting there afterwards
  -- with no pattern and no rule. (The BEGIN … EXCEPTION block below is a
  -- subtransaction, which is exactly what PostgREST gives every RPC call: the
  -- raise rolls the whole function back.)
  ok := false;
  begin
    perform public.finance_learn_merchant_rule(
      p_transaction_id => tx_second,
      p_category_slug  => 'events',
      p_pattern_type   => 'exact_token',
      p_tokens         => array['KOELN'],
      p_merchant_name  => 'Halb Angelegt'
    );
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: learning with an unknown category was accepted'; end if;

  select count(*) into n from public.finance_merchants where user_id = user_a and canonical_name = 'Halb Angelegt';
  if n <> 0 then raise exception 'FAIL: a failed learning call left a merchant behind'; end if;
  select count(*) into n from public.finance_merchant_patterns where user_id = user_a and tokens = array['KOELN'];
  if n <> 0 then raise exception 'FAIL: a failed learning call left a pattern behind'; end if;

  -- The same pattern under a second merchant would make every booking it
  -- matches ambiguous forever — refused, with the merchant that would have
  -- been created rolled back with it.
  ok := false;
  begin
    perform public.finance_learn_merchant_rule(
      p_transaction_id => tx_second,
      p_category_slug  => 'restaurant',
      p_pattern_type   => 'exact_token',
      p_tokens         => array['REWE'],
      p_merchant_name  => 'REWE Bistro'
    );
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: the same pattern was accepted for a second merchant'; end if;
  select count(*) into n from public.finance_merchants where user_id = user_a and canonical_name = 'REWE Bistro';
  if n <> 0 then raise exception 'FAIL: a refused pattern still created its merchant'; end if;

  -- A pattern that is not normalised is one the matcher could never match.
  ok := false;
  begin
    perform public.finance_learn_merchant_rule(
      p_transaction_id => tx_second,
      p_category_slug  => 'restaurant',
      p_pattern_type   => 'exact_token',
      p_tokens         => array['rewe markt'],
      p_merchant_name  => 'Kleingeschrieben'
    );
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a pattern that is not normalised was stored'; end if;

  -- ── The constraints the engine relies on ─────────────────────────────────
  select id into merch_a from public.finance_merchants where user_id = user_a and canonical_name = 'REWE';

  ok := false;
  begin
    insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
      values (user_a, merch_a, 'exact_token', array['REWE', 'MARKT']);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an exact_token pattern with two tokens was accepted'; end if;

  ok := false;
  begin
    insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
      values (user_a, merch_a, 'exact_phrase', array['REWE']);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an exact_phrase pattern with one token was accepted'; end if;

  -- An amount bound is a number in a currency.
  ok := false;
  begin
    insert into public.finance_category_rules (user_id, merchant_id, category_id, max_amount_minor)
      values (user_a, merch_a, cat_food, 1200);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an amount bound without a currency was accepted'; end if;

  -- Two default rules for one merchant would be a coin flip the resolver
  -- refuses to make, so the database does not allow the situation to arise.
  ok := false;
  begin
    insert into public.finance_category_rules (user_id, merchant_id, category_id)
      values (user_a, merch_a, cat_food);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a merchant got a second default rule'; end if;

  -- A Retoure is its own booking; the link only exists on one.
  ok := false;
  begin
    insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, transaction_type, refunds_transaction_id)
      values (user_a, acc_a, '2026-09-10', 500, 'EUR', 'RUECKZAHLUNG', 'purchase', tx_a);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a purchase was allowed to be a refund of another booking'; end if;

  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, transaction_type, refunds_transaction_id)
    values (user_a, acc_a, '2026-09-10', 500, 'EUR', 'RUECKZAHLUNG REWE', 'refund', tx_a);
  select count(*) into n from public.finance_transactions where id = tx_a and amount_minor = -2483;
  if n <> 1 then raise exception 'FAIL: booking a Retoure changed the original booking'; end if;

  -- ── The original booking is frozen ───────────────────────────────────────
  -- The invariant the whole module is built on, enforced where it cannot be
  -- argued with. A classification still goes through; the fact does not.
  ok := false;
  begin
    update public.finance_transactions set raw_description = 'ETWAS GANZ ANDERES' where id = tx_a;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: the original text of a booking could be rewritten'; end if;

  ok := false;
  begin
    update public.finance_transactions set amount_minor = -1 where id = tx_a;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: the original amount of a booking could be rewritten'; end if;

  ok := false;
  begin
    update public.finance_transactions set booking_date = '2020-01-01' where id = tx_a;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: the booking date could be rewritten'; end if;

  update public.finance_transactions set include_in_analytics = false, manual_lock = true where id = tx_a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the interpretation of a booking could not be changed'; end if;
  select count(*) into n from public.finance_transactions
   where id = tx_a and raw_description = 'REWE TROISDORF SAGT DANKE 8407' and amount_minor = -2483;
  if n <> 1 then raise exception 'FAIL: classifying a booking changed the booking'; end if;

  -- ── 18. Two accounts, and the wall between them ──────────────────────────
  execute 'reset role';
  insert into public.finance_accounts (user_id, name) values (user_b, 'Konto von B') returning id into acc_b;
  insert into public.finance_merchants (user_id, canonical_name) values (user_b, 'ALDI') returning id into merch_b;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description)
    values (user_b, acc_b, '2026-09-05', -1000, 'EUR', 'ALDI SUED KOELN') returning id into tx_b;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  -- A bank statement is the most personal thing this app holds. B sees none of
  -- it: not the bookings, not the merchants, not the rules that reveal where
  -- somebody shops.
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s bookings', n; end if;
  select count(*) into n from public.finance_accounts where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s finance accounts', n; end if;
  select count(*) into n from public.finance_merchants where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s merchants', n; end if;
  select count(*) into n from public.finance_merchant_patterns where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s merchant patterns', n; end if;
  select count(*) into n from public.finance_category_rules where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s category rules', n; end if;
  select count(*) into n from public.finance_categories where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s categories', n; end if;
  select count(*) into n from public.finance_transaction_overrides where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s manual decisions', n; end if;
  select count(*) into n from public.finance_imports where user_id = user_a;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s imports', n; end if;

  update public.finance_transactions set category_id = null, merchant_id = null where id = tx_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B changed % of A''s bookings', n; end if;

  delete from public.finance_transactions where id = tx_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s bookings', n; end if;

  delete from public.finance_merchants where id = merch_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s merchants', n; end if;

  -- The learning call runs as whoever is signed in, under the same policies.
  ok := false;
  begin
    perform public.finance_learn_merchant_rule(
      p_transaction_id => tx_a,
      p_category_slug  => 'lebensmittel',
      p_pattern_type   => 'exact_token',
      p_tokens         => array['REWE'],
      p_merchant_name  => 'Uebernommen'
    );
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B could learn a rule on A''s booking'; end if;

  -- A correctly-owned row pointing at somebody else's parent is the one thing
  -- `user_id` alone would not catch.
  ok := false;
  begin
    insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
      values (user_b, merch_a, 'exact_token', array['UNTERGESCHOBEN']);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B hung a pattern under A''s merchant'; end if;

  ok := false;
  begin
    insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description)
      values (user_b, acc_a, '2026-09-05', -100, 'EUR', 'UNTERGESCHOBEN');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B parked a booking in A''s account'; end if;

  ok := false;
  begin
    update public.finance_transactions set merchant_id = merch_a where id = tx_b;
  exception when others then ok := true;
  end;
  if not ok then
    select count(*) into n from public.finance_transactions where id = tx_b and merchant_id = merch_a;
    if n > 0 then raise exception 'FAIL: B pointed their booking at A''s merchant'; end if;
  end if;

  ok := false;
  begin
    insert into public.finance_transaction_overrides (user_id, transaction_id)
      values (user_b, tx_a);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B wrote a manual decision on A''s booking'; end if;

  -- ── Without a session there is nothing at all ────────────────────────────
  execute 'set local role anon';
  perform set_config('request.jwt.claims', null, true);

  begin
    execute 'select count(*) from public.finance_transactions' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % bookings', n; end if;
  exception when insufficient_privilege then null;   -- no grant: also a pass
  end;

  begin
    execute 'select count(*) from public.finance_merchants' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % merchants', n; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select count(*) from public.finance_categories' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % finance categories', n; end if;
  exception when insufficient_privilege then null;
  end;

  ok := false;
  begin
    execute format(
      'select public.finance_learn_merchant_rule(%L::uuid, %L, %L, array[%L], null, %L)',
      tx_a, 'lebensmittel', 'exact_token', 'REWE', 'Von anon');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an unauthenticated client could learn a rule'; end if;

  execute 'reset role';
  raise notice 'RLS: finance assertions passed';
end;
$$;

-- Printed rather than only raised, so a runner can see the result on stdout.
select 'RLS: all assertions passed' as result;

rollback;
