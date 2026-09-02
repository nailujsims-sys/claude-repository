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

  -- ── 2. …and read them back ───────────────────────────────────────────────
  select count(*) into n from public.tasks;
  if n <> 1 then raise exception 'FAIL: A sees % of their own tasks, expected 1', n; end if;
  select count(*) into n from public.events;
  if n <> 1 then raise exception 'FAIL: A sees % of their own events, expected 1', n; end if;
  select count(*) into n from public.lists;
  if n <> 1 then raise exception 'FAIL: A sees % of their own lists, expected 1', n; end if;
  select count(*) into n from public.list_items;
  if n <> 1 then raise exception 'FAIL: A sees % of their own list entries, expected 1', n; end if;

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

-- Printed rather than only raised, so a runner can see the result on stdout.
select 'RLS: all assertions passed' as result;

rollback;
