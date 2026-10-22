-- Mind Whiteboard — Trading-Setups: Row Level Security and storage policies.
--
-- Proves against the real schema (0016) that a signed-in user reaches their own
-- setups, assets and screenshots and nothing else. One transaction, ending in
-- ROLLBACK, so running it leaves nothing behind.
--
--   • Supabase Dashboard → SQL Editor → paste → Run.
--   • Locally: `npm run test:rls` (tools/rlsTest.mjs).
--
-- Each assertion states what an attacker would achieve if it failed.

begin;

do $$
declare
  user_a   uuid := gen_random_uuid();
  user_b   uuid := gen_random_uuid();
  asset_a  uuid;
  asset_b  uuid;
  setup_a  uuid;
  n        integer;
  ok       boolean;
begin
  insert into auth.users (id, email) values
    (user_a, 'trading-a@mindwhiteboard.test'),
    (user_b, 'trading-b@mindwhiteboard.test');

  -- ── 1. A may create and read their own rows and files ─────────────────────
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  insert into public.trading_assets (user_id, name) values (user_a, 'NQ') returning id into asset_a;
  insert into public.trading_setups (user_id, name, session, asset_id, timeframe, screenshot_path)
    values (user_a, 'London Breakout', 'london', asset_a, '15m', user_a::text || '/a.png')
    returning id into setup_a;
  insert into storage.objects (bucket_id, name, owner)
    values ('trading-screenshots', user_a::text || '/a.png', user_a);

  select count(*) into n from public.trading_setups;
  if n <> 1 then raise exception 'FAIL: A sees % of their own setups, expected 1', n; end if;
  select count(*) into n from public.trading_assets;
  if n <> 1 then raise exception 'FAIL: A sees % of their own assets, expected 1', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'trading-screenshots';
  if n <> 1 then raise exception 'FAIL: A sees % of their own screenshots, expected 1', n; end if;

  -- The same asset twice, differently spelled, would be two filter chips.
  ok := false;
  begin
    insert into public.trading_assets (user_id, name) values (user_a, ' nq ');
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: an asset was accepted twice in a different spelling'; end if;

  -- ── 2. B sees, changes and deletes nothing of A's ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.trading_setups;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s setups', n; end if;
  select count(*) into n from public.trading_assets;
  if n <> 0 then raise exception 'FAIL: B can read % of A''s assets', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'trading-screenshots';
  if n <> 0 then raise exception 'FAIL: B can read % of A''s screenshots', n; end if;

  update public.trading_setups set name = 'gekapert' where id = setup_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated % of A''s setups', n; end if;
  delete from public.trading_setups where id = setup_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s setups', n; end if;
  delete from storage.objects where name = user_a::text || '/a.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted % of A''s screenshots', n; end if;

  -- B may not plant a row in A's name …
  ok := false;
  begin
    insert into public.trading_setups (user_id, name) values (user_a, 'untergeschoben');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B created a setup owned by A'; end if;

  -- … nor a file in A's folder …
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner)
      values ('trading-screenshots', user_a::text || '/b.png', user_b);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B uploaded a file into A''s folder'; end if;

  -- … nor point their own setup at A's screenshot or A's asset.
  ok := false;
  begin
    insert into public.trading_setups (user_id, name, screenshot_path)
      values (user_b, 'fremdes Bild', user_a::text || '/a.png');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B''s setup points at a file in A''s folder'; end if;

  ok := false;
  begin
    insert into public.trading_setups (user_id, name, asset_id) values (user_b, 'fremdes Asset', asset_a);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: B''s setup references A''s asset'; end if;

  -- B's own things still work — the policies refuse A's data, not B.
  insert into public.trading_assets (user_id, name) values (user_b, 'NQ') returning id into asset_b;
  insert into storage.objects (bucket_id, name, owner)
    values ('trading-screenshots', user_b::text || '/b.png', user_b);
  insert into public.trading_setups (user_id, name, asset_id, screenshot_path)
    values (user_b, 'Eigenes Setup', asset_b, user_b::text || '/b.png');

  -- ── 3. Values the library could not show or filter ────────────────────────
  ok := false;
  begin
    insert into public.trading_setups (user_id, name, session) values (user_b, 'x', 'sydney');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an unknown session was accepted'; end if;

  ok := false;
  begin
    insert into public.trading_setups (user_id, name, timeframe) values (user_b, 'x', '7m');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an unknown timeframe was accepted'; end if;

  ok := false;
  begin
    insert into public.trading_setups (user_id, name) values (user_b, '   ');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a nameless setup was accepted'; end if;

  -- ── 4. Anonymous clients get nothing ──────────────────────────────────────
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'select count(*) from public.trading_setups' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % setups', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select count(*) from storage.objects' into n;
    if n <> 0 then raise exception 'FAIL: an unauthenticated client read % screenshots', n; end if;
  exception when insufficient_privilege then null;
  end;

  -- ── 5. The bucket is private and bounded ──────────────────────────────────
  execute 'reset role';
  select count(*) into n from storage.buckets
    where id = 'trading-screenshots' and public = false
      and file_size_limit = 10485760
      and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']
      and cardinality(allowed_mime_types) = 3;
  if n <> 1 then raise exception 'FAIL: the screenshot bucket is missing, public or unbounded'; end if;

  raise notice 'TRADING: all assertions passed';
end;
$$;

-- Printed rather than only raised, so a runner can see the result on stdout.
select 'TRADING: all assertions passed' as result;

rollback;
