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
  n        integer;
  ok       boolean;
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

  -- ── 2. …and read them back ───────────────────────────────────────────────
  select count(*) into n from public.tasks;
  if n <> 1 then raise exception 'FAIL: A sees % of their own tasks, expected 1', n; end if;
  select count(*) into n from public.events;
  if n <> 1 then raise exception 'FAIL: A sees % of their own events, expected 1', n; end if;

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

  -- ── 5. The other user sees none of it ────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.tasks;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s tasks', n; end if;
  select count(*) into n from public.events;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s events', n; end if;
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

  -- ── 8. Every personal table actually has RLS switched on ─────────────────
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
