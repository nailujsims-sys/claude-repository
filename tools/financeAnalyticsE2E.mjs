// „Zählt diese Buchung?" — asked of the database and of the app, side by side.
//
// 0010 implements the effective-inclusion rule in SQL, for the view a future
// chart will read; src/lib/finance/analytics.js implements it in JavaScript, for
// the screen. Two implementations of one rule is one of them waiting to be
// wrong — so this suite does not test them separately. It builds a database
// full of awkward cases and asserts, row by row, that
// `finance_analytics_transactions` and `resolveAnalyticsInclusion` select
// exactly the same bookings.
//
// It also proves the two things a note has to survive: a reload, and a later
// save that was about something else entirely.
//
// Skips (exit 0) when no Postgres is on the machine, like tools/rlsTest.mjs.
import { build } from 'esbuild'
import { execFileSync, spawnSync } from 'node:child_process'
import { chownSync, mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BIN_CANDIDATES = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin', '']
const findBin = () => {
  for (const dir of BIN_CANDIDATES) {
    const probe = spawnSync(dir ? join(dir, 'initdb') : 'initdb', ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return dir
  }
  return null
}
const bin = findBin()
if (!bin && !process.env.RLS_TEST_REQUIRED) {
  console.log('finance analytics e2e: kein lokales Postgres gefunden — übersprungen.')
  process.exit(0)
}

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
const sudoUser = asRoot
  ? (() => {
      for (const name of ['postgres', 'ubuntu', 'runner', 'node']) {
        const probe = spawnSync('id', ['-u', name], { encoding: 'utf8' })
        if (probe.status === 0) return { name, uid: Number(probe.stdout.trim()) }
      }
      return null
    })()
  : null
if (asRoot && !sudoUser) {
  console.log('finance analytics e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
  process.exit(0)
}

const exe = (n) => (bin ? join(bin, n) : n)
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const pg = (cmd, args, opts = {}) =>
  sudoUser
    ? run('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', cmd, ...args], opts)
    : run(cmd, args, opts)

// ── the finance modules, bundled once ───────────────────────────────────────
const bundled = await build({
  stdin: {
    contents: `
      export { buildClassificationQueue } from './src/lib/finance/classificationQueue.js'
      export { buildOverride, descriptionSegments, normalizeNote, patternTypeFor, rangeTokens }
        from './src/lib/finance/classificationFlow.js'
      export { analyticsTransactions, resolveAnalyticsInclusion } from './src/lib/finance/analytics.js'
      export { matchMerchant } from './src/lib/finance/merchantMatching.js'
      export { buildLearnRequest } from './src/lib/finance/learning.js'
      export { tokenize } from './src/lib/finance/normalize.js'
    `,
    resolveDir: process.cwd(),
    sourcefile: 'classifyE2E.mjs',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})
const modulePath = `${process.env.SCRATCH || '/tmp'}/financeAnalyticsE2E.bundled.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const {
  buildClassificationQueue, buildOverride, descriptionSegments, normalizeNote, patternTypeFor,
  rangeTokens, analyticsTransactions, resolveAnalyticsInclusion, matchMerchant,
  buildLearnRequest, tokenize,
} = await import(pathToFileURL(modulePath).href)

let pass = 0
let fail = 0
const ok = (name, cond) => {
  if (cond) pass++
  else {
    fail++
    console.log('  ✗ ' + name)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mw-ana-'))
const data = join(dir, 'data')
let started = false
const sqlFile = join(dir, 'q.sql')

try {
  if (sudoUser) chownSync(dir, sudoUser.uid, sudoUser.uid)
  pg(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
  pg(exe('pg_ctl'), ['-D', data, '-o', `-k ${dir} -h '' -c fsync=off`, '-w', '-l', join(dir, 'log'), 'start'])
  started = true

  const psql = (args) =>
    pg(exe('psql'), ['-h', dir, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], {
      cwd: process.cwd(),
    })

  psql(['-f', 'tools/pgtest/supabase-stub.sql'])
  for (const file of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    psql(['-f', join('supabase/migrations', file)])
  }

  const asUser = (userId, sql) => {
    const script = `set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
${sql}`
    writeFileSync(sqlFile, script)
    if (sudoUser) chownSync(sqlFile, sudoUser.uid, sudoUser.uid)
    return psql(['-t', '-A', '-f', sqlFile])
  }
  const jsonAsUser = (userId, sql) => {
    const writes = /^\s*(insert|update|delete)\b/i.test(sql)
    const wrapped = writes
      ? `with t as (${sql}) select coalesce(jsonb_agg(t), '[]'::jsonb)::text from t;`
      : `select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (${sql}) t;`
    const out = asUser(userId, wrapped)
    const line = out.trim().split('\n').filter(Boolean).pop()
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`psql gab nichts Lesbares zurueck:\n${out}`)
    }
  }

  const userId = '11111111-2222-4333-8444-888888888888'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'analytics@mindwhiteboard.test')`])
  const accountId = jsonAsUser(
    userId,
    `insert into public.finance_accounts (user_id, name, provider, currency)
     values ('${userId}', 'DKB Girokonto', 'DKB', 'EUR') returning id`
  )[0].id

  const lit = (value) => `$json$${JSON.stringify(value)}$json$`

  // Bookings are inserted the way an import writes them: the text and the
  // tokens together, tokenised by the very module the app uses.
  let day = 0
  const insertBooking = (raw, { lock = false, amountMinor = -1234 } = {}) => {
    day += 1
    return jsonAsUser(
      userId,
      `insert into public.finance_transactions
         (user_id, account_id, booking_date, amount_minor, currency, raw_description,
          normalized_tokens, manual_lock)
       values ('${userId}', '${accountId}', '2026-09-${String((day % 28) + 1).padStart(2, '0')}',
               ${amountMinor}, 'EUR', ${lit(raw)}::jsonb #>> '{}',
               (select array_agg(x) from jsonb_array_elements_text(${lit(tokenize(raw))}::jsonb) as t(x)),
               ${lock})
       returning id`
    )[0].id
  }

  // ── EXACTLY what FinanceContext loads, and nothing else ──────────────────
  // Every assertion after a save goes through this. If the queue needs
  // something these five reads do not return, it shows up here and nowhere
  // else.
  const reload = () => ({
    transactions: jsonAsUser(
      userId,
      `select id, account_id, booking_date, amount_minor, currency, raw_description,
              normalized_tokens, merchant_id, category_id, manual_lock, include_in_analytics
       from public.finance_transactions where user_id = '${userId}'
       order by booking_date desc, created_at desc`
    ),
    merchants: jsonAsUser(userId,
      `select id, canonical_name, review_mode, default_include_in_analytics
       from public.finance_merchants where user_id = '${userId}' order by canonical_name`),
    patterns: jsonAsUser(userId,
      `select id, merchant_id, pattern_type, tokens, active from public.finance_merchant_patterns
       where user_id = '${userId}' and active`),
    categoryRules: jsonAsUser(userId,
      `select id, merchant_id, category_id, min_amount_minor, max_amount_minor,
              min_inclusive, max_inclusive, currency, active
       from public.finance_category_rules where user_id = '${userId}' and active`),
    categories: jsonAsUser(userId,
      `select id, slug, label, sort_order from public.finance_categories
       where user_id = '${userId}' order by sort_order`),
    overrides: jsonAsUser(userId,
      `select transaction_id, merchant_id, category_id, include_in_analytics, note
       from public.finance_transaction_overrides where user_id = '${userId}'`),
  })

  const learn = (request) => {
    const args = [
      `'${request.p_transaction_id}'`,
      `${lit(request.p_category_slug)}::jsonb #>> '{}'`,
      `${lit(request.p_pattern_type)}::jsonb #>> '{}'`,
      `(select array_agg(x) from jsonb_array_elements_text(${lit(request.p_tokens)}::jsonb) as t(x))`,
      request.p_merchant_id ? `'${request.p_merchant_id}'` : 'null',
      request.p_merchant_name ? `${lit(request.p_merchant_name)}::jsonb #>> '{}'` : 'null',
      request.p_review_mode ? `'${request.p_review_mode}'` : 'null',
      request.p_min_amount_minor ?? 'null',
      request.p_min_inclusive,
      request.p_max_amount_minor ?? 'null',
      request.p_max_inclusive,
      request.p_rule_currency ? `'${request.p_rule_currency}'` : 'null',
      `(select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(${lit(request.p_apply_transaction_ids)}::jsonb) as t(x))`,
    ]
    return jsonAsUser(userId, `select public.finance_learn_merchant_rule(${args.join(', ')}) as r`)[0].r
  }

  // One booking decided by hand — the same upsert financeRepository.saveOverride
  // performs, on the same unique index.
  // The same upsert financeRepository.saveOverride performs, over the same
  // columns — including the two this version added.
  const writeOverride = (transactionId, decision) =>
    jsonAsUser(
      userId,
      `insert into public.finance_transaction_overrides
         (user_id, transaction_id, merchant_id, category_id, include_in_analytics, note)
       values ('${userId}', '${transactionId}',
               ${decision.merchant_id ? `'${decision.merchant_id}'` : 'null'},
               ${decision.category_id ? `'${decision.category_id}'` : 'null'},
               ${typeof decision.include_in_analytics === 'boolean' ? decision.include_in_analytics : 'null'},
               ${decision.note ? `${lit(decision.note)}::jsonb #>> '{}'` : 'null'})
       on conflict (transaction_id) do update
         set merchant_id = excluded.merchant_id, category_id = excluded.category_id,
             include_in_analytics = excluded.include_in_analytics, note = excluded.note,
             updated_at = now()
       returning transaction_id`
    )[0].transaction_id

  const queueOf = (state) => buildClassificationQueue({
    transactions: state.transactions, patterns: state.patterns, merchants: state.merchants,
    rules: state.categoryRules, overrides: state.overrides,
  })

  // The gesture, exactly as the sheet performs it: mark a range of words in the
  // booking in front of the user, then hand buildLearnRequest the state a
  // reload just returned.
  const gesture = (state, transactionId, range, { categorySlug, merchantId = null, merchantName = '' }) => {
    const transaction = state.transactions.find((t) => t.id === transactionId)
    const { segments } = descriptionSegments(transaction)
    const tokens = rangeTokens(segments, range)
    const built = buildLearnRequest({
      transaction,
      selection: tokens,
      patternType: patternTypeFor(tokens),
      categorySlug,
      categories: state.categories,
      merchantId,
      merchantName,
      transactions: state.transactions,
      patterns: state.patterns,
      overrides: state.overrides,
    })
    return { built, tokens, transaction }
  }

  // The two halves of the same rule, on the same rows.
  const includedBySql = () =>
    jsonAsUser(userId, `select id from public.finance_analytics_transactions`).map((r) => r.id).sort()

  const includedByJs = (state) =>
    analyticsTransactions({
      transactions: state.transactions, overrides: state.overrides,
      patterns: state.patterns, merchants: state.merchants,
    }).map((t) => t.id).sort()

  const agree = (label, state) => {
    const sql = includedBySql()
    const js = includedByJs(state)
    ok(label, sql.join(',') === js.join(','))
    if (sql.join(',') !== js.join(',')) {
      console.log('      SQL:', JSON.stringify(sql))
      console.log('      JS :', JSON.stringify(js))
    }
    return sql
  }

  // ══ 1. The migration is additive ═════════════════════════════════════════
  {
    const columns = jsonAsUser(
      userId,
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'finance_merchants'
       order by column_name`
    )
    const added = columns.find((c) => c.column_name === 'default_include_in_analytics')
    ok('the merchant carries an analytics default', Boolean(added))
    ok('…as a boolean', added.data_type === 'boolean')
    ok('…that is never null', added.is_nullable === 'NO')
    ok('…and defaults to counting', String(added.column_default).includes('true'))
    ok('no other merchant column was touched',
       columns.map((c) => c.column_name).sort().join(',') ===
       'canonical_name,created_at,default_include_in_analytics,id,review_mode,updated_at,user_id')

    // RLS is untouched: the four policies of 0008 still stand, and anon still
    // sees nothing.
    const policies = jsonAsUser(userId,
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'finance_merchants'`)[0].n
    ok('the merchant keeps its four policies', policies === 4)
    ok('anon cannot read merchants',
       jsonAsUser(userId, `select has_table_privilege('anon', 'public.finance_merchants', 'select') as p`)[0].p === false)
  }

  // ══ 2. Nothing decided: everything counts ════════════════════════════════
  const rewe1 = insertBooking('REWE TROISDORF SAGT DANKE 8407')
  const rewe2 = insertBooking('REWE Frankfurt Hauptwache')
  const scalable1 = insertBooking('Scalable Capital Verrechnungskonto')
  const aldi = insertBooking('ALDI SUED Esslingen')
  {
    const state = reload()
    const sql = agree('an untouched account counts every booking', state)
    ok('…which is all four of them', sql.length === 4)
  }

  // ══ 3. One booking, decided by hand ══════════════════════════════════════
  {
    writeOverride(rewe2, { include_in_analytics: false })
    const state = reload()
    const sql = agree('an excluded booking disappears from both', state)
    ok('…and it is the one that was excluded', !sql.includes(rewe2))
    ok('…while the booking itself is untouched',
       state.transactions.find((t) => t.id === rewe2).include_in_analytics === true)
    ok('„nicht berücksichtigen" is not „gelöscht"', state.transactions.length === 4)
  }

  // ══ 4. A whole merchant ══════════════════════════════════════════════════
  {
    // Teach Scalable Capital so the engine recognises it, then switch it off.
    const state = reload()
    const g = gesture(state, scalable1, { from: 0, to: 0 }, {
      categorySlug: 'sonstige', merchantName: 'Scalable Capital',
    })
    learn(g.built.request)
    const taught = reload()
    const scalable = taught.merchants.find((m) => m.canonical_name === 'Scalable Capital')

    jsonAsUser(userId,
      `update public.finance_merchants set default_include_in_analytics = false
       where id = '${scalable.id}' and user_id = '${userId}' returning id`)

    const off = reload()
    const sql = agree('a merchant switched off drops out of both', off)
    ok('…the Scalable booking is gone from the total', !sql.includes(scalable1))
    ok('…REWE is not affected', sql.includes(rewe1))
    ok('…and the excluded REWE booking is still excluded', !sql.includes(rewe2))

    // THE case the column exists for: a booking imported AFTER the decision,
    // carrying no merchant_id at all.
    const future = insertBooking('Scalable Capital Sparplan Januar')
    const later = reload()
    const row = later.transactions.find((t) => t.id === future)
    ok('a newly imported booking has no merchant id', row.merchant_id === null)
    const afterImport = agree('…and is excluded all the same, by both halves', later)
    ok('…so the merchant decision reaches forward', !afterImport.includes(future))
    ok('…because the pattern engine recognises it',
       matchMerchant({ transaction: row, patterns: later.patterns, merchants: later.merchants })
         .merchantId === scalable.id)

    // A booking of that merchant can still be brought back one at a time.
    writeOverride(future, { include_in_analytics: true })
    const back = reload()
    const withBack = agree('an override overrules the merchant, in both halves', back)
    ok('…and the booking counts again', withBack.includes(future))

    // Reversible: switching the merchant back on restores the rest.
    jsonAsUser(userId,
      `update public.finance_merchants set default_include_in_analytics = true
       where id = '${scalable.id}' and user_id = '${userId}' returning id`)
    const restored = reload()
    const all = agree('switching the merchant back on restores both', restored)
    ok('…and the first Scalable booking counts again', all.includes(scalable1))
  }

  // ══ 5. A conflict inherits no default ════════════════════════════════════
  {
    const tx = insertBooking('KAUFHOF GALERIA Musterstadt Filiale')
    let state = reload()
    const first = gesture(state, tx, { from: 0, to: 0 }, {
      categorySlug: 'klamotten', merchantName: 'Kaufhof',
    })
    learn(first.built.request)
    state = reload()
    const second = gesture(state, tx, { from: 1, to: 1 }, {
      categorySlug: 'sonstige', merchantName: 'Galeria',
    })
    learn(second.built.request)

    // Both merchants are switched off. The booking still counts, because there
    // is no single merchant whose default it could inherit.
    const conflicted = reload()
    for (const name of ['Kaufhof', 'Galeria']) {
      const m = conflicted.merchants.find((x) => x.canonical_name === name)
      jsonAsUser(userId,
        `update public.finance_merchants set default_include_in_analytics = false
         where id = '${m.id}' and user_id = '${userId}' returning id`)
    }
    const state2 = reload()
    const sql = agree('a conflicted booking is judged the same way by both', state2)
    ok('…and inherits neither default', sql.includes(tx))
    ok('…because the engine calls it a conflict',
       matchMerchant({
         transaction: state2.transactions.find((t) => t.id === tx),
         patterns: state2.patterns, merchants: state2.merchants,
       }).status === 'conflict')

    // Its own override still decides it.
    writeOverride(tx, { include_in_analytics: false })
    const decided = reload()
    ok('…while an override about it still counts', !agree('conflict + override agree', decided).includes(tx))
  }

  // ══ 6. A note, and what it must not destroy ══════════════════════════════
  {
    const state = reload()
    const kaufhof = state.merchants.find((m) => m.canonical_name === 'Kaufhof')
    const klamotten = state.categories.find((c) => c.slug === 'klamotten').id
    const tx = state.transactions.find((t) => t.raw_description.startsWith('KAUFHOF')).id

    // A full decision first: merchant, category, and that it does not count.
    writeOverride(tx, {
      merchant_id: kaufhof.id, category_id: klamotten, include_in_analytics: false,
      note: null,
    })
    const decided = reload()
    const before = decided.overrides.find((o) => o.transaction_id === tx)
    ok('the decision is stored',
       before.merchant_id === kaufhof.id && before.category_id === klamotten &&
       before.include_in_analytics === false)

    // Then a note, sent the way the repository sends it: merged with what is
    // already there.
    const merged = { ...before, note: normalizeNote('  Jacke umgetauscht  ') }
    writeOverride(tx, merged)

    const after = reload()
    const row = after.overrides.find((o) => o.transaction_id === tx)
    ok('the note is stored', row.note === 'Jacke umgetauscht')
    ok('…and the merchant survived it', row.merchant_id === kaufhof.id)
    ok('…and the category', row.category_id === klamotten)
    ok('…and the analytics decision', row.include_in_analytics === false)
    ok('…and there is still exactly one override for this booking',
       after.overrides.filter((o) => o.transaction_id === tx).length === 1)
    agree('the total is unchanged by a note', after)

    // 500 characters are storable; 501 are not.
    writeOverride(tx, { ...row, note: 'x'.repeat(500) })
    ok('a 500-character note is stored',
       reload().overrides.find((o) => o.transaction_id === tx).note.length === 500)
    let refused = null
    try { writeOverride(tx, { ...row, note: 'x'.repeat(501) }) }
    catch (err) { refused = String(err.stderr || err.message) }
    ok('a longer one is refused by the database', refused !== null)
    ok('…by the constraint that says so',
       refused !== null && refused.includes('note_len'))
    ok('…and the stored note is untouched',
       reload().overrides.find((o) => o.transaction_id === tx).note.length === 500)

    // Clearing it leaves everything else alone.
    writeOverride(tx, { ...row, note: null })
    const cleared = reload().overrides.find((o) => o.transaction_id === tx)
    ok('a cleared note is null', cleared.note === null)
    ok('…and the decision is still there',
       cleared.merchant_id === kaufhof.id && cleared.include_in_analytics === false)
  }

  // ══ 7. Superseded bookings stay out, whatever anybody thinks ═════════════
  {
    const state = reload()
    const sql = includedBySql()
    ok('the view still excludes nothing it should include', sql.length > 0)
    // The supersession filter 0009 added is still in the view.
    const definition = jsonAsUser(userId,
      `select pg_get_viewdef('public.finance_analytics_transactions'::regclass, true) as d`)[0].d
    ok('the supersession filter survived the replacement',
       definition.includes('supersession') && definition.includes('predecessor'))
    ok('…and so did security_invoker',
       jsonAsUser(userId,
         `select 'security_invoker=true' = any(c.reloptions) as si
          from pg_class c where c.relname = 'finance_analytics_transactions'`)[0].si === true)
    agree('and the two halves still agree at the end', state)
  }

  // ══ 8. Another user sees none of it ══════════════════════════════════════
  {
    const other = '11111111-2222-4333-8444-999999999999'
    psql(['-c', `insert into auth.users (id, email) values ('${other}', 'fremd2@mindwhiteboard.test')`])
    ok('a stranger sees no merchants',
       jsonAsUser(other, `select count(*)::int as n from public.finance_merchants`)[0].n === 0)
    ok('…and nothing in the analytics view',
       jsonAsUser(other, `select count(*)::int as n from public.finance_analytics_transactions`)[0].n === 0)
    ok('…and cannot read a foreign merchant default through the helper',
       jsonAsUser(other, `select public.finance_unique_merchant(array['REWE']) is null as n`)[0].n === true)
  }

  console.log(`finance analytics e2e: ${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} catch (err) {
  console.error('finance analytics e2e: FEHLGESCHLAGEN\n')
  console.error(err.stdout || '')
  console.error(err.stderr || err.message)
  process.exitCode = 1
} finally {
  if (started) {
    const stop = [exe('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']]
    if (sudoUser)
      spawnSync('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', stop[0], ...stop[1]], { stdio: 'ignore' })
    else spawnSync(stop[0], stop[1], { stdio: 'ignore' })
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
