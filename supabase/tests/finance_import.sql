-- Mind Whiteboard — applying a reconciliation plan, verified against the real schema.
--
-- 0009 makes three promises that cannot be checked in JavaScript, because they
-- are properties of a database:
--
--   • ALL OR NOTHING — a plan that fails halfway leaves nothing behind.
--   • APPLIED ONCE — the same export, applied again, adds no second booking, no
--     second relation, no second observation and no second review item.
--   • MANUAL BEATS AUTOMATIC — an import never quietly deactivates a booking a
--     human decided about, and never lets both sides of a supersession count.
--
-- Everything happens inside one transaction that ends in ROLLBACK, so running
-- this against production leaves no users, accounts or bookings behind.
--
-- Two ways to run it:
--   • Supabase Dashboard → SQL Editor → paste → Run.
--   • Locally against a throwaway Postgres: `npm run test:rls`.

begin;

do $$
declare
  user_a    uuid := gen_random_uuid();
  user_b    uuid := gen_random_uuid();
  acct_a    uuid;
  acct_a2   uuid;
  acct_b    uuid;
  imp       uuid;
  imp2      uuid;
  imp3      uuid;
  imp4      uuid;
  tx_a      uuid;
  tx_b      uuid;
  tx_c      uuid;
  tx_p1     uuid;
  tx_p2     uuid;
  tx_foreign uuid;
  res       jsonb;
  n         integer;
  m         integer;
  caught    text;
  rel       uuid;
begin
  insert into auth.users (id, email) values
    (user_a, 'fin-a@mindwhiteboard.test'),
    (user_b, 'fin-b@mindwhiteboard.test');

  -- ── user B, so that "somebody else's row" is a real row ───────────────────
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  insert into public.finance_accounts (user_id, name) values (user_b, 'Konto B') returning id into acct_b;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_b, acct_b, '2026-09-10', -1438, 'EUR', 'Fremde Buchung', array['FREMDE','BUCHUNG'])
    returning id into tx_foreign;

  -- ── user A ────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.finance_accounts (user_id, name) values (user_a, 'DKB Giro') returning id into acct_a;
  insert into public.finance_accounts (user_id, name) values (user_a, 'Zweitkonto') returning id into acct_a2;

  -- ══ 1. A first import: three genuinely new bookings ═══════════════════════
  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash)
    values (user_a, acct_a, 'pdf', 'Auszug-1.pdf', 'hash-1') returning id into imp;

  res := public.finance_apply_reconciliation_plan(
    imp, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
        'raw_description', E'Deutsche Bahn\nnull2026-09-12T17:06 Debitk. 0 2099-12 Zahl.System VISA De bit\n(POS)',
        'normalized_tokens', jsonb_build_array('DEUTSCHE','BAHN','POS'),
        'source_variant','timestamped_card',
        'source_metadata', jsonb_build_object('page',1,'card_timestamp','2026-09-12T17:06','card_transaction_date',null,'reference',null)),
      jsonb_build_object('booking_date','2026-09-10','amount_minor',-1438,'currency','EUR',
        'raw_description', E'REWE\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 09.09.2026',
        'normalized_tokens', jsonb_build_array('REWE','VISA'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('page',1,'card_transaction_date','2026-09-09','reference',null)),
      jsonb_build_object('booking_date','2026-09-11','amount_minor',-5005,'currency','EUR',
        'raw_description', E'Deutsche Bahn\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 10.09.2026',
        'normalized_tokens', jsonb_build_array('DEUTSCHE','BAHN'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('page',1,'card_transaction_date','2026-09-10','reference',null))
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object()),
      jsonb_build_object('index',1,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object()),
      jsonb_build_object('index',2,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object())
    )
  );

  if (res->>'transactions_created')::int <> 3 then
    raise exception 'FAIL: first import created % bookings, expected 3', res->>'transactions_created';
  end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 3 then raise exception 'FAIL: % bookings after the first import, expected 3', n; end if;
  select status into caught from public.finance_imports where id = imp;
  if caught <> 'imported' then raise exception 'FAIL: import status is %, expected imported', caught; end if;

  select id into tx_a from public.finance_transactions where user_id = user_a and amount_minor = -6065;

  -- ══ 2. THE SAME IMPORT, APPLIED AGAIN ════════════════════════════════════
  -- The lock plus the status make this a replay, not a second import. Nothing
  -- economic may appear — this is the double-click case.
  res := public.finance_apply_reconciliation_plan(
    imp, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
        'raw_description','Deutsche Bahn','normalized_tokens',jsonb_build_array('DEUTSCHE','BAHN'),
        'source_variant','standard','source_metadata',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object())
    )
  );
  if coalesce((res->>'replayed')::boolean, false) is not true then
    raise exception 'FAIL: re-applying an imported import was not reported as a replay';
  end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 3 then raise exception 'FAIL: the replay created bookings (% instead of 3)', n; end if;

  -- ══ 3. ATOMICITY: a plan that fails halfway writes nothing ═══════════════
  -- The second booking carries an amount the schema refuses. The first one is
  -- inserted before the failure is reached, so if anything survived, the
  -- promise "no half imports" would be broken.
  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash)
    values (user_a, acct_a, 'pdf', 'Auszug-kaputt.pdf', 'hash-broken') returning id into imp2;
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(
      imp2, acct_a,
      jsonb_build_array(
        jsonb_build_object('booking_date','2026-09-13','amount_minor',-100,'currency','EUR',
          'raw_description','Erste Buchung','normalized_tokens',jsonb_build_array('ERSTE'),
          'source_variant','standard','source_metadata',jsonb_build_object()),
        jsonb_build_object('booking_date','2026-09-13','amount_minor',9007199254740999,'currency','EUR',
          'raw_description','Zu grosser Betrag','normalized_tokens',jsonb_build_array('ZU'),
          'source_variant','standard','source_metadata',jsonb_build_object())
      ),
      jsonb_build_array(
        jsonb_build_object('index',0,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object()),
        jsonb_build_object('index',1,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object())
      )
    );
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: an impossible amount was accepted'; end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 3 then raise exception 'FAIL: a failed import left % bookings behind (expected 3)', n; end if;
  select count(*) into n from public.finance_transactions where import_id = imp2;
  if n <> 0 then raise exception 'FAIL: the failed import left % of its own bookings behind', n; end if;
  select status into caught from public.finance_imports where id = imp2;
  if caught <> 'pending' then raise exception 'FAIL: the failed import is marked %, expected pending', caught; end if;

  -- ══ 4. RETRY AFTER THE FAILURE ═══════════════════════════════════════════
  -- The same import row, now with a plan that holds. It has to work: the
  -- rollback left no trace that could block it.
  res := public.finance_apply_reconciliation_plan(
    imp2, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-13','amount_minor',-100,'currency','EUR',
        'raw_description','Erste Buchung','normalized_tokens',jsonb_build_array('ERSTE'),
        'source_variant','standard','source_metadata',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object())
    )
  );
  if (res->>'transactions_created')::int <> 1 then
    raise exception 'FAIL: the retry after a failure created % bookings, expected 1', res->>'transactions_created';
  end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 4 then raise exception 'FAIL: % bookings after the retry, expected 4', n; end if;

  -- ══ 5. A → B: the provisional booking is superseded ══════════════════════
  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash)
    values (user_a, acct_a, 'pdf', 'Auszug-2.pdf', 'hash-2') returning id into imp3;

  res := public.finance_apply_reconciliation_plan(
    imp3, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
        'raw_description', E'DB.Vertrieb.GmbH/508354771568\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 12.09.2026',
        'normalized_tokens', jsonb_build_array('DB','VERTRIEB','GMBH'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('card_transaction_date','2026-09-12','reference','508354771568')),
      -- The −14,38 € booking again, with the richer text of the second export.
      jsonb_build_object('booking_date','2026-09-10','amount_minor',-1438,'currency','EUR',
        'raw_description', E'REWE.Mohamed.Boufo/Frankfurt\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 09.09.2026',
        'normalized_tokens', jsonb_build_array('REWE','MOHAMED','BOUFO','FRANKFURT'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('card_transaction_date','2026-09-09','reference',null))
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','supersedes','tier',3,
        'existing_ids', jsonb_build_array(tx_a), 'reason','Löst die vorgemerkte Buchung ab.','evidence',jsonb_build_object()),
      jsonb_build_object('index',1,'outcome','enriched','tier',2,
        'existing_ids', jsonb_build_array((select id from public.finance_transactions where user_id = user_a and amount_minor = -1438)),
        'reason','Dieselbe Buchung mit ausführlicherem Text.','evidence',jsonb_build_object())
    )
  );

  if (res->>'supersessions_confirmed')::int <> 1 then
    raise exception 'FAIL: % confirmed supersessions, expected 1', res->>'supersessions_confirmed';
  end if;
  if (res->>'observations_created')::int <> 1 then
    raise exception 'FAIL: % observations, expected 1', res->>'observations_created';
  end if;

  select id into tx_b from public.finance_transactions
   where user_id = user_a and amount_minor = -6065 and import_id = imp3;

  -- The original is untouched. This is the promise the freeze trigger keeps and
  -- the reason observations exist at all.
  select count(*) into n from public.finance_transactions
   where id = tx_a and raw_description like 'Deutsche Bahn%';
  if n <> 1 then raise exception 'FAIL: the superseded booking lost its original text'; end if;

  -- The predecessor no longer counts; the replacement does.
  select count(*) into n from public.finance_analytics_transactions where id = tx_a;
  if n <> 0 then raise exception 'FAIL: the superseded booking still counts in the analytics'; end if;
  select count(*) into n from public.finance_analytics_transactions where id = tx_b;
  if n <> 1 then raise exception 'FAIL: the settled booking does not count in the analytics'; end if;

  -- The richer text landed next to the booking, not inside it.
  select count(*) into n from public.finance_transaction_observations o
   join public.finance_transactions t on t.id = o.transaction_id
   where t.user_id = user_a and o.observed_description like 'REWE.Mohamed%';
  if n <> 1 then raise exception 'FAIL: the richer text was not recorded as an observation'; end if;
  select count(*) into n from public.finance_transactions
   where user_id = user_a and amount_minor = -1438 and raw_description like 'REWE.Mohamed%';
  if n <> 0 then raise exception 'FAIL: an import overwrote the original text of a booking'; end if;

  -- Which rows the import took out of the analytics, by id. A later "reject
  -- this supersession" step has to put exactly these back — and nothing else.
  select r.evidence->'analytics_deactivated' into res
  from public.finance_transaction_relations r
  where r.user_id = user_a and r.relation_type = 'supersession';
  if res is null or jsonb_array_length(res) <> 1 or (res->>0)::uuid <> tx_a then
    raise exception 'FAIL: the relation does not record which booking it deactivated (%)', res;
  end if;

  -- ══ 6. A → B → B: the same second export once more ═══════════════════════
  -- A new import row, the same content, every arrival recognised as a duplicate.
  -- Nothing economic, and the observation is recognised as one already held.
  insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash)
    values (user_a, acct_a, 'pdf', 'Auszug-2-nochmal.pdf', 'hash-2b') returning id into imp4;

  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
        'raw_description', E'DB.Vertrieb.GmbH/508354771568\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 12.09.2026',
        'normalized_tokens', jsonb_build_array('DB','VERTRIEB','GMBH'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('card_transaction_date','2026-09-12','reference','508354771568')),
      jsonb_build_object('booking_date','2026-09-10','amount_minor',-1438,'currency','EUR',
        'raw_description', E'REWE.Mohamed.Boufo/Frankfurt\nIBAN DE96 1203 0000 9005 2909 04\nVISA Debitkartenumsatz vom 09.09.2026',
        'normalized_tokens', jsonb_build_array('REWE','MOHAMED','BOUFO','FRANKFURT'),
        'source_variant','standard',
        'source_metadata', jsonb_build_object('card_transaction_date','2026-09-09','reference',null))
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','duplicate','tier',0,'existing_ids',jsonb_build_array(tx_b),'reason','Wortgleich bereits importiert.','evidence',jsonb_build_object()),
      jsonb_build_object('index',1,'outcome','enriched','tier',2,
        'existing_ids', jsonb_build_array((select id from public.finance_transactions where user_id = user_a and amount_minor = -1438)),
        'reason','Dieselbe Buchung mit ausführlicherem Text.','evidence',jsonb_build_object())
    )
  );

  if (res->>'transactions_created')::int <> 0 then
    raise exception 'FAIL: re-importing an equivalent export created % bookings', res->>'transactions_created';
  end if;
  if (res->>'observations_created')::int <> 0 then
    raise exception 'FAIL: the same observation was stored twice';
  end if;
  select count(*) into n from public.finance_transaction_observations where user_id = user_a;
  if n <> 1 then raise exception 'FAIL: % observations, expected 1', n; end if;
  select count(*) into n from public.finance_transaction_relations where user_id = user_a and relation_type = 'supersession';
  if n <> 1 then raise exception 'FAIL: % supersessions, expected 1', n; end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 5 then raise exception 'FAIL: % bookings after the repeat import, expected 5', n; end if;

  -- ══ 7. A STALE PLAN: superseding what is already superseded ══════════════
  update public.finance_imports set status = 'parsed', apply_result = null where id = imp4;
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(
      imp4, acct_a,
      jsonb_build_array(jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
        'raw_description','Noch eine Ablösung','normalized_tokens',jsonb_build_array('NOCH'),
        'source_variant','standard','source_metadata',jsonb_build_object())),
      jsonb_build_array(jsonb_build_object('index',0,'outcome','supersedes','tier',3,
        'existing_ids', jsonb_build_array(tx_a), 'reason','Löst ab.','evidence',jsonb_build_object()))
    );
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: a booking was superseded twice'; end if;
  select count(*) into n from public.finance_transactions where user_id = user_a;
  if n <> 5 then raise exception 'FAIL: the stale plan left % bookings behind, expected 5', n; end if;
  update public.finance_imports set status = 'imported' where id = imp4;

  -- ══ 8. A → B → C: a chain is allowed ═════════════════════════════════════
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-3') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-14','amount_minor',-6065,'currency','EUR',
      'raw_description','DB.Vertrieb.GmbH/508354771568 korrigiert','normalized_tokens',jsonb_build_array('DB','KORRIGIERT'),
      'source_variant','standard','source_metadata',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','supersedes','tier',3,
      'existing_ids', jsonb_build_array(tx_b), 'reason','Löst ab.','evidence',jsonb_build_object()))
  );
  select id into tx_c from public.finance_transactions where user_id = user_a and import_id = imp4;
  select count(*) into n from public.finance_analytics_transactions where id in (tx_a, tx_b, tx_c);
  if n <> 1 then raise exception 'FAIL: % of the three chain members count, expected exactly 1', n; end if;
  select count(*) into n from public.finance_analytics_transactions where id = tx_c;
  if n <> 1 then raise exception 'FAIL: the last member of the chain does not count'; end if;
  -- B is a replacement in the first relation and a predecessor in the second.
  select count(*) into n from public.finance_transaction_relation_members where transaction_id = tx_b;
  if n <> 2 then raise exception 'FAIL: the middle of the chain has % memberships, expected 2', n; end if;

  -- ══ 9. n ↔ n: two provisional, two settled, no invented pairing ══════════
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, '2026-09-20', -2000, 'EUR', E'Bahn\nnull2026-09-19T17:02 Debitk. 0 2099-12 Zahl.System VISA De bit', array['BAHN'])
    returning id into tx_p1;
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, '2026-09-20', -2000, 'EUR', E'Bahn\nnull2026-09-19T17:06 Debitk. 0 2099-12 Zahl.System VISA De bit', array['BAHN'])
    returning id into tx_p2;

  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-4') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(
      jsonb_build_object('booking_date','2026-09-20','amount_minor',-2000,'currency','EUR',
        'raw_description','DB.Vertrieb.GmbH/111111111111','normalized_tokens',jsonb_build_array('DB'),
        'source_variant','standard','source_metadata',jsonb_build_object('card_transaction_date','2026-09-19')),
      jsonb_build_object('booking_date','2026-09-20','amount_minor',-2000,'currency','EUR',
        'raw_description','DB.Vertrieb.GmbH/222222222222','normalized_tokens',jsonb_build_array('DB'),
        'source_variant','standard','source_metadata',jsonb_build_object('card_transaction_date','2026-09-19'))
    ),
    jsonb_build_array(
      jsonb_build_object('index',0,'outcome','supersedes_group','tier',3,
        'existing_ids', jsonb_build_array(tx_p1, tx_p2), 'reason','Zwei gegen zwei.','evidence',jsonb_build_object('ambiguous_group',true)),
      jsonb_build_object('index',1,'outcome','supersedes_group','tier',3,
        'existing_ids', jsonb_build_array(tx_p1, tx_p2), 'reason','Zwei gegen zwei.','evidence',jsonb_build_object('ambiguous_group',true))
    )
  );

  if (res->>'transactions_created')::int <> 2 then
    raise exception 'FAIL: the n↔n group created % bookings, expected 2', res->>'transactions_created';
  end if;
  if (res->>'supersessions_confirmed')::int <> 1 then
    raise exception 'FAIL: the n↔n group produced % relations, expected 1', res->>'supersessions_confirmed';
  end if;
  select id into rel from public.finance_transaction_relations
   where user_id = user_a and relation_type = 'supersession' and import_id = imp4;
  select count(*) into n from public.finance_transaction_relation_members where relation_id = rel and role = 'predecessor';
  select count(*) into m from public.finance_transaction_relation_members where relation_id = rel and role = 'replacement';
  if n <> 2 or m <> 2 then
    raise exception 'FAIL: the n↔n relation has %/% members, expected 2/2', n, m;
  end if;
  -- Both old ones are out, both new ones are in — the count is preserved and no
  -- individual assignment was invented.
  select count(*) into n from public.finance_analytics_transactions where id in (tx_p1, tx_p2);
  if n <> 0 then raise exception 'FAIL: % of the two provisional bookings still count', n; end if;
  select count(*) into n from public.finance_analytics_transactions where import_id = imp4;
  if n <> 2 then raise exception 'FAIL: % of the two settled bookings count, expected 2', n; end if;

  -- ══ 10. manual_lock: the import stands down ══════════════════════════════
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens, manual_lock)
    values (user_a, acct_a, '2026-09-21', -3000, 'EUR', E'Gesperrt\nnull2026-09-20T10:00 Debitk. 0 2099-12 Zahl.System VISA De bit', array['GESPERRT'], true)
    returning id into tx_p1;
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-5') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-21','amount_minor',-3000,'currency','EUR',
      'raw_description','Abgerechnet gegen gesperrt','normalized_tokens',jsonb_build_array('ABGERECHNET'),
      'source_variant','standard','source_metadata',jsonb_build_object())),
    -- The plan claims a plain supersession. The database knows better.
    jsonb_build_array(jsonb_build_object('index',0,'outcome','supersedes','tier',3,
      'existing_ids', jsonb_build_array(tx_p1), 'reason','Löst ab.','evidence',jsonb_build_object()))
  );
  if (res->>'supersessions_confirmed')::int <> 0 or (res->>'supersessions_proposed')::int <> 1 then
    raise exception 'FAIL: a locked booking was superseded automatically (% confirmed)', res->>'supersessions_confirmed';
  end if;
  select count(*) into n from public.finance_transactions where id = tx_p1 and include_in_analytics;
  if n <> 1 then raise exception 'FAIL: a locked booking was deactivated by an import'; end if;
  -- Exactly one of the two counts — the protected one — so nothing is counted twice.
  select count(*) into n from public.finance_analytics_transactions where id = tx_p1 or import_id = imp4;
  if n <> 1 then raise exception 'FAIL: % of the locked pair count, expected exactly 1', n; end if;
  select count(*) into n from public.finance_import_review_items
   where user_id = user_a and item_type = 'manual_lock_conflict' and status = 'open';
  if n <> 1 then raise exception 'FAIL: no review item for the locked booking'; end if;

  -- ══ 11. override: the same protection, from the other source ═════════════
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, '2026-09-22', -4000, 'EUR', E'Ueberschrieben\nnull2026-09-21T10:00 Debitk. 0 2099-12 Zahl.System VISA De bit', array['UEBERSCHRIEBEN'])
    returning id into tx_p2;
  insert into public.finance_transaction_overrides (user_id, transaction_id, include_in_analytics)
    values (user_a, tx_p2, true);
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-6') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-22','amount_minor',-4000,'currency','EUR',
      'raw_description','Abgerechnet gegen Override','normalized_tokens',jsonb_build_array('OVERRIDE'),
      'source_variant','standard','source_metadata',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','supersedes','tier',3,
      'existing_ids', jsonb_build_array(tx_p2), 'reason','Löst ab.','evidence',jsonb_build_object()))
  );
  if (res->>'supersessions_proposed')::int <> 1 then
    raise exception 'FAIL: an overridden booking was superseded automatically';
  end if;
  select count(*) into n from public.finance_transactions where id = tx_p2 and include_in_analytics;
  if n <> 1 then raise exception 'FAIL: an overridden booking was deactivated by an import'; end if;

  -- ══ 11b. a booking already excluded by hand is not claimed by the import ═
  -- It is superseded like any other, but it does not appear in
  -- analytics_deactivated — undoing the supersession must not switch on
  -- something the user had switched off themselves.
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens, include_in_analytics)
    values (user_a, acct_a, '2026-09-27', -800, 'EUR', E'Schon aus\nnull2026-09-26T10:00 Debitk. 0 2099-12 Zahl.System VISA De bit', array['SCHON'], false)
    returning id into tx_p1;
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-6b') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-27','amount_minor',-800,'currency','EUR',
      'raw_description','Abgerechnet gegen schon-aus','normalized_tokens',jsonb_build_array('SCHON'),
      'source_variant','standard','source_metadata',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','supersedes','tier',3,
      'existing_ids', jsonb_build_array(tx_p1), 'reason','Löst ab.','evidence',jsonb_build_object()))
  );
  if (res->>'supersessions_confirmed')::int <> 1 then
    raise exception 'FAIL: the supersession of an already-excluded booking was not confirmed';
  end if;
  select r.evidence->'analytics_deactivated' into res
  from public.finance_transaction_relations r where r.user_id = user_a and r.import_id = imp4;
  if jsonb_array_length(res) <> 0 then
    raise exception 'FAIL: the import claims to have deactivated a booking it did not touch (%)', res;
  end if;

  -- ══ 12. unresolved and review are kept, not dropped ══════════════════════
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-7') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-23','amount_minor',-1234,'currency','EUR',
      'raw_description','Unklarer Fall','normalized_tokens',jsonb_build_array('UNKLARER'),
      'source_variant','standard','source_metadata',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','unresolved','tier',3,
      'existing_ids', jsonb_build_array(tx_a), 'reason','2 gegen 1 — keine eindeutige Zuordnung.','evidence',jsonb_build_object()))
  );
  if (res->>'transactions_created')::int <> 0 then
    raise exception 'FAIL: an unresolved booking was imported anyway';
  end if;
  select count(*) into n from public.finance_import_review_items
   where user_id = user_a and item_type = 'unresolved_match' and status = 'open'
     and payload->'booking'->>'raw_description' = 'Unklarer Fall';
  if n <> 1 then raise exception 'FAIL: the unresolved booking was not kept for review'; end if;

  -- ══ 13. refund candidate ═════════════════════════════════════════════════
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a, '2026-09-24', -5005, 'EUR', 'Kauf mit Referenz 564851284265', array['KAUF'])
    returning id into tx_p1;
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-8') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-25','amount_minor',5005,'currency','EUR',
      'raw_description','Retoure 564851284265','normalized_tokens',jsonb_build_array('RETOURE'),
      'source_variant','standard','source_metadata',jsonb_build_object('reference','564851284265'))),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','new','tier',4,'existing_ids',jsonb_build_array(),'reason','Neu.','evidence',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object(
      'reference','564851284265',
      'charge', jsonb_build_object('source','existing','id',tx_p1),
      'refund', jsonb_build_object('source','incoming','index',0),
      'reason','Gleiche Referenz, entgegengesetzter Betrag.'))
  );
  if (res->>'refund_candidates_created')::int <> 1 then
    raise exception 'FAIL: % refund candidates, expected 1', res->>'refund_candidates_created';
  end if;
  select id into rel from public.finance_transaction_relations
   where user_id = user_a and relation_type = 'refund_candidate' and import_id = imp4;
  select count(*) into n from public.finance_transaction_relation_members
   where relation_id = rel and role = 'purchase' and transaction_id = tx_p1;
  if n <> 1 then raise exception 'FAIL: the refund candidate does not name the purchase'; end if;
  -- Both sides of a refund are real money and both keep counting.
  select count(*) into n from public.finance_analytics_transactions where id = tx_p1 or import_id = imp4;
  if n <> 2 then raise exception 'FAIL: a refund candidate removed a booking from the analytics'; end if;
  -- And it is a proposal: nothing was typed as a refund behind the user's back.
  select count(*) into n from public.finance_transactions
   where user_id = user_a and (transaction_type = 'refund' or refunds_transaction_id is not null);
  if n <> 0 then raise exception 'FAIL: an import typed a booking as a refund on its own'; end if;

  -- ══ 13b. the same refund candidate, proposed again ══════════════════════
  -- Its identity is the pair of bookings, not the import that noticed it. A
  -- later export that sees the same pair adds no second proposal.
  select id into rel from public.finance_transactions
   where user_id = user_a and amount_minor = 5005;
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-8b') returning id into imp4;
  res := public.finance_apply_reconciliation_plan(
    imp4, acct_a,
    jsonb_build_array(jsonb_build_object('booking_date','2026-09-25','amount_minor',5005,'currency','EUR',
      'raw_description','Retoure 564851284265','normalized_tokens',jsonb_build_array('RETOURE'),
      'source_variant','standard','source_metadata',jsonb_build_object('reference','564851284265'))),
    jsonb_build_array(jsonb_build_object('index',0,'outcome','duplicate','tier',0,
      'existing_ids', jsonb_build_array(rel),'reason','Schon da.','evidence',jsonb_build_object())),
    jsonb_build_array(jsonb_build_object(
      'reference','564851284265',
      'charge', jsonb_build_object('source','existing','id',tx_p1),
      'refund', jsonb_build_object('source','existing','id',rel),
      'reason','Gleiche Referenz, entgegengesetzter Betrag.'))
  );
  select count(*) into n from public.finance_transaction_relations
   where user_id = user_a and relation_type = 'refund_candidate';
  if n <> 1 then raise exception 'FAIL: % refund candidate relations, expected 1', n; end if;

  -- ══ 14. ACCOUNT SEPARATION ═══════════════════════════════════════════════
  -- An own booking, filed under another own account, named in this account's
  -- plan. Refused — the account is part of the boundary, not a detail.
  insert into public.finance_transactions (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
    values (user_a, acct_a2, '2026-09-26', -700, 'EUR', 'Buchung auf dem Zweitkonto', array['ZWEITKONTO'])
    returning id into tx_p2;
  insert into public.finance_imports (user_id, account_id, source_type, source_hash)
    values (user_a, acct_a, 'pdf', 'hash-9') returning id into imp4;
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(
      imp4, acct_a,
      jsonb_build_array(jsonb_build_object('booking_date','2026-09-26','amount_minor',-700,'currency','EUR',
        'raw_description','Kontogrenze','normalized_tokens',jsonb_build_array('KONTOGRENZE'),
        'source_variant','standard','source_metadata',jsonb_build_object())),
      jsonb_build_array(jsonb_build_object('index',0,'outcome','duplicate','tier',0,
        'existing_ids', jsonb_build_array(tx_p2), 'reason','Angeblich schon da.','evidence',jsonb_build_object()))
    );
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: a plan reached across account boundaries'; end if;

  -- An import row whose account does not match the one being applied.
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(
      imp4, acct_a2,
      jsonb_build_array(), jsonb_build_array()
    );
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: a plan was applied to the wrong account'; end if;

  -- ══ 15. ANOTHER USER'S BOOKING ═══════════════════════════════════════════
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(
      imp4, acct_a,
      jsonb_build_array(jsonb_build_object('booking_date','2026-09-26','amount_minor',-1438,'currency','EUR',
        'raw_description','Fremd','normalized_tokens',jsonb_build_array('FREMD'),
        'source_variant','standard','source_metadata',jsonb_build_object())),
      jsonb_build_array(jsonb_build_object('index',0,'outcome','duplicate','tier',0,
        'existing_ids', jsonb_build_array(tx_foreign), 'reason','Angeblich schon da.','evidence',jsonb_build_object()))
    );
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: a plan named another user''s booking'; end if;

  -- ══ 16. OBSERVATIONS ARE APPEND-ONLY ═════════════════════════════════════
  -- Two layers, and both are checked. As the signed-in user the UPDATE has no
  -- policy to pass at all, so it changes nothing. As the owner of the table —
  -- which is what a migration, a job or a hand-written statement runs as — RLS
  -- is out of the way and the trigger is the only thing left; it has to refuse.
  select count(*) into n from public.finance_transaction_observations where user_id = user_a;
  if n <> 1 then raise exception 'FAIL: no observation to test append-only with (% found)', n; end if;

  update public.finance_transaction_observations
  set observed_description = 'umgeschrieben'
  where user_id = user_a;
  select count(*) into n from public.finance_transaction_observations
   where user_id = user_a and observed_description = 'umgeschrieben';
  if n <> 0 then raise exception 'FAIL: an observation could be rewritten through the policies'; end if;

  execute 'reset role';
  caught := null;
  begin
    update public.finance_transaction_observations set observed_description = 'umgeschrieben';
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: the append-only trigger let an observation be rewritten'; end if;
  execute 'set local role authenticated';

  -- ══ 17. ISOLATION: user B sees none of it ════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.finance_transaction_observations;
  if n <> 0 then raise exception 'FAIL: user B sees % observations of user A', n; end if;
  select count(*) into n from public.finance_transaction_relations;
  if n <> 0 then raise exception 'FAIL: user B sees % relations of user A', n; end if;
  select count(*) into n from public.finance_transaction_relation_members;
  if n <> 0 then raise exception 'FAIL: user B sees % relation members of user A', n; end if;
  select count(*) into n from public.finance_import_review_items;
  if n <> 0 then raise exception 'FAIL: user B sees % review items of user A', n; end if;
  select count(*) into n from public.finance_analytics_transactions;
  if n <> 1 then raise exception 'FAIL: user B sees % analytics rows, expected only their own 1', n; end if;

  -- User B cannot apply user A's import either.
  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(imp4, acct_a, jsonb_build_array(), jsonb_build_array());
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: user B could apply a plan against user A''s import'; end if;

  -- And cannot file a review item under user A's id.
  caught := null;
  begin
    insert into public.finance_import_review_items (user_id, account_id, item_type, reason, item_key)
      values (user_a, acct_a, 'manual_review', 'geschmuggelt', 'x');
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: user B could write a review item for user A'; end if;

  -- ══ 18. anon has no access at all ════════════════════════════════════════
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  foreach caught in array array[
    'public.finance_transaction_observations',
    'public.finance_transaction_relations',
    'public.finance_transaction_relation_members',
    'public.finance_import_review_items',
    'public.finance_analytics_transactions'
  ]
  loop
    n := -1;
    begin
      execute format('select count(*) from %s', caught) into n;
    exception when others then
      n := -1;
    end;
    if n >= 0 then
      raise exception 'FAIL: anon can read %', caught;
    end if;
  end loop;

  caught := null;
  begin
    perform public.finance_apply_reconciliation_plan(imp4, acct_a, jsonb_build_array(), jsonb_build_array());
  exception when others then
    caught := sqlerrm;
  end;
  if caught is null then raise exception 'FAIL: anon could apply a reconciliation plan'; end if;

  execute 'reset role';
end
$$;

select 'FINANCE-IMPORT: all assertions passed' as result;

rollback;
