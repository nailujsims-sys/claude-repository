// The classification, end to end, against a real database.
//
// The logic suite proves what the sheet computes. This proves what SURVIVES:
// the rule is written by the real finance_learn_merchant_rule inside a real
// transaction, and every assertion afterwards reads the account back out of SQL
// — no JavaScript value from before the save is used to answer a question about
// after it. That is what „Save + Reload → weiterhin korrekt" means.
//
// It is also the only place the promise the sheet makes can be checked against
// what actually happened: the number in „5 Umsätze werden REWE · Lebensmittel"
// and the `applied_count` the database returns have to be the same number.
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
  console.log('finance classify e2e: kein lokales Postgres gefunden — übersprungen.')
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
  console.log('finance classify e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
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
      export { DECISION, backtestNumbers, buildOverride, confirmationLines, decisionExplanation,
               decisionKindOf, descriptionSegments, patternLabelOf, patternTypeFor,
               rangeTokens } from './src/lib/finance/classificationFlow.js'
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
const modulePath = `${process.env.SCRATCH || '/tmp'}/financeClassifyE2E.bundled.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const {
  buildClassificationQueue, DECISION, backtestNumbers, buildOverride, confirmationLines,
  decisionExplanation, decisionKindOf, descriptionSegments, patternLabelOf, patternTypeFor,
  rangeTokens, buildLearnRequest, tokenize,
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

const dir = mkdtempSync(join(tmpdir(), 'mw-cls-'))
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

  const userId = '11111111-2222-4333-8444-666666666666'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'classify@mindwhiteboard.test')`])
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
      `select id, canonical_name, review_mode from public.finance_merchants
       where user_id = '${userId}' order by canonical_name`),
    patterns: jsonAsUser(userId,
      `select id, merchant_id, pattern_type, tokens, active from public.finance_merchant_patterns
       where user_id = '${userId}' and active`),
    categoryRules: jsonAsUser(userId,
      `select id, merchant_id, category_id, min_amount_minor, max_amount_minor,
              min_inclusive, max_inclusive, currency, active
       from public.finance_category_rules where user_id = '${userId}' and active`),
    categories: jsonAsUser(userId,
      `select id, slug, label, sort_order, parent_id from public.finance_categories
       where user_id = '${userId}' order by sort_order`),
    overrides: jsonAsUser(userId,
      `select transaction_id, merchant_id, category_id from public.finance_transaction_overrides
       where user_id = '${userId}'`),
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
  const writeOverride = (transactionId, decision) =>
    jsonAsUser(
      userId,
      `insert into public.finance_transaction_overrides
         (user_id, transaction_id, merchant_id, category_id)
       values ('${userId}', '${transactionId}',
               ${decision.merchant_id ? `'${decision.merchant_id}'` : 'null'},
               ${decision.category_id ? `'${decision.category_id}'` : 'null'})
       on conflict (transaction_id) do update
         set merchant_id = excluded.merchant_id, category_id = excluded.category_id,
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

  // ══ 1. REWE: mark one word, and every open REWE booking follows ══════════
  const rewe = [
    insertBooking('REWE TROISDORF SAGT DANKE 8407'),
    insertBooking('REWE.Mohamed.Boufo/Frankfurt'),
    insertBooking('REWE SAGT DANKE 1122'),
    insertBooking('REWE Markt GmbH Troisdorf'),
    insertBooking('REWE CITY 4455'),
  ]
  insertBooking('ALDI SUED Esslingen')
  insertBooking('Scalable Capital Verrechnungskonto')

  const before = reload()
  // Seit v1.26 ist die Taxonomie zweistufig — und `parent_id` wird hier
  // ausdrücklich mitgelesen: ohne die Spalte sähe jede Zeile wie eine
  // Oberkategorie aus, und keine einzige wäre zuordenbar. Genau das hat dieser
  // Test gemeldet, als die Abfrage sie noch wegließ.
  ok('ein frisches Konto hat die vollständige Taxonomie', before.categories.length === 35)
  ok('…davon 26 zuordenbare Unterkategorien',
     before.categories.filter((c) => c.parent_id !== null).length === 26)
  ok('nothing is classified yet', buildClassificationQueue({
    transactions: before.transactions, patterns: before.patterns, merchants: before.merchants,
    rules: before.categoryRules, overrides: before.overrides,
  }).open.length === 7)

  const g1 = gesture(before, rewe[0], { from: 0, to: 0 }, {
    categorySlug: 'lebensmittel', merchantName: 'REWE',
  })
  ok('marking the first word yields REWE', g1.tokens.join(' ') === 'REWE')
  ok('the gesture is valid against the stored rows', g1.built.valid === true)

  const promised = backtestNumbers({ backtest: g1.built.backtest, transaction: g1.transaction })
  const sentence = confirmationLines({
    numbers: promised, patternLabel: patternLabelOf(g1.tokens),
    merchantName: 'REWE', categoryName: 'Lebensmittel',
  })
  ok('the sheet promises four further bookings',
     sentence[0] === '„REWE" erkennt 4 weitere offene Umsätze.')

  const r1 = learn(g1.built.request)
  ok('the merchant was created', r1.merchant_created === true)
  ok('the pattern was created', r1.pattern_created === true)
  ok('the rule was created', r1.rule_created === true)
  ok('the booking in hand was assigned', r1.transaction_updated === true)
  // THE assertion this file exists for: what the user was promised is what
  // happened, measured by the database rather than by the preview.
  ok('the database applied exactly what the preview promised',
     r1.applied_count + 1 === promised.gesamt)
  ok('…and did not touch more than it was asked for',
     r1.applied_count === r1.requested_count)

  // ── RELOAD. Every value above is now history. ──
  const afterRewe = reload()
  const q1 = buildClassificationQueue({
    transactions: afterRewe.transactions, patterns: afterRewe.patterns,
    merchants: afterRewe.merchants, rules: afterRewe.categoryRules, overrides: afterRewe.overrides,
  })
  ok('after a reload the rule is there', afterRewe.patterns.length === 1)
  ok('…and no REWE booking is open any more',
     !q1.open.some((e) => e.transaction.raw_description.toUpperCase().includes('REWE')))
  ok('…every one of them resolved', q1.entries.filter(
     (e) => e.transaction.raw_description.toUpperCase().includes('REWE')
   ).length === 5)
  const lebensmittel = afterRewe.categories.find((c) => c.slug === 'lebensmittel').id
  ok('…to Lebensmittel', q1.entries.filter(
     (e) => e.transaction.raw_description.toUpperCase().includes('REWE')
   ).every((e) => e.categoryId === lebensmittel))
  ok('the two other bookings are still open', q1.open.length === 2)

  // A booking that arrives LATER is recognised without anybody classifying it.
  const late = insertBooking('REWE TROISDORF SAGT DANKE 9999')
  const afterLate = reload()
  const q2 = buildClassificationQueue({
    transactions: afterLate.transactions, patterns: afterLate.patterns,
    merchants: afterLate.merchants, rules: afterLate.categoryRules, overrides: afterLate.overrides,
  })
  ok('a booking imported after the rule is recognised by the engine',
     !q2.open.some((e) => e.transaction.id === late))
  // …and that recognition does not depend on the column having been written.
  const lateRow = afterLate.transactions.find((t) => t.id === late)
  ok('…although the import wrote no merchant into its row', lateRow.merchant_id === null)

  // ══ 2. An alias: a second pattern, never a second merchant ═══════════════
  const aldiId = insertBooking('ALDI SUED SAGT DANKE / ESSLINGEN AM NECKAR')
  {
    const state = reload()
    const first = gesture(state, state.transactions.find((t) => t.raw_description === 'ALDI SUED Esslingen').id,
      { from: 0, to: 1 }, { categorySlug: 'lebensmittel', merchantName: 'ALDI Süd' })
    ok('the plain spelling becomes a phrase', first.built.request.p_pattern_type === 'exact_phrase')
    learn(first.built.request)

    const withAldi = reload()
    const aldi = withAldi.merchants.find((m) => m.canonical_name === 'ALDI Süd')
    ok('ALDI Süd exists once', withAldi.merchants.filter((m) => m.canonical_name === 'ALDI Süd').length === 1)

    const second = gesture(withAldi, aldiId, { from: 0, to: 0 }, {
      categorySlug: 'lebensmittel', merchantId: aldi.id,
    })
    ok('a second spelling is taught to the merchant that exists',
       second.built.request.p_merchant_id === aldi.id && second.built.request.p_merchant_name === null)
    const r = learn(second.built.request)
    ok('…as a new pattern', r.pattern_created === true)
    ok('…without creating a merchant', r.merchant_created === false)

    const after = reload()
    ok('there is still exactly one ALDI Süd',
       after.merchants.filter((m) => m.canonical_name === 'ALDI Süd').length === 1)
    ok('…now with two patterns',
       after.patterns.filter((p) => p.merchant_id === aldi.id).length === 2)
    const q = buildClassificationQueue({
      transactions: after.transactions, patterns: after.patterns, merchants: after.merchants,
      rules: after.categoryRules, overrides: after.overrides,
    })
    ok('two patterns of one merchant are not a conflict',
       after.transactions.filter((t) => t.raw_description.startsWith('ALDI')).every(
         (t) => q.entries.find((e) => e.transaction.id === t.id).merchantId === aldi.id))
  }

  // ══ 3. The identical pattern under another merchant is refused ═══════════
  {
    const state = reload()
    const tx = state.transactions.find((t) => t.raw_description === 'REWE CITY 4455')
    const { segments } = descriptionSegments(tx)
    const tokens = rangeTokens(segments, { from: 0, to: 0 })
    const built = buildLearnRequest({
      transaction: tx, selection: tokens, patternType: 'exact_token',
      categorySlug: 'restaurant', categories: state.categories, merchantName: 'Ein anderer Laden',
      transactions: state.transactions, patterns: state.patterns, overrides: state.overrides,
    })
    let refused = null
    try { learn(built.request) } catch (err) { refused = String(err.stderr || err.message) }
    ok('a pattern that belongs to another merchant is refused', refused !== null)
    ok('…with a sentence, not a constraint name',
       refused !== null && refused.includes('gehört bereits zu einem anderen Händler'))

    const after = reload()
    ok('…and nothing was written', after.merchants.every((m) => m.canonical_name !== 'Ein anderer Laden'))
    ok('…not even the merchant', after.patterns.filter((p) => p.tokens.join(' ') === 'REWE').length === 1)
  }

  // ══ 4. A decision made by hand is never overwritten ══════════════════════
  {
    const locked = insertBooking('EDEKA Musterstadt gesperrt', { lock: true })
    const overridden = insertBooking('EDEKA Musterstadt override')
    const open1 = insertBooking('EDEKA Musterstadt frei 1')
    const open2 = insertBooking('EDEKA Musterstadt frei 2')
    const sonstige = jsonAsUser(userId,
      `select id from public.finance_categories where user_id = '${userId}' and slug = 'sonstige'`)[0].id
    jsonAsUser(userId,
      `insert into public.finance_transaction_overrides (user_id, transaction_id, category_id)
       values ('${userId}', '${overridden}', '${sonstige}') returning transaction_id`)

    const state = reload()
    const g = gesture(state, open1, { from: 0, to: 0 }, {
      categorySlug: 'lebensmittel', merchantName: 'EDEKA',
    })
    const numbers = backtestNumbers({ backtest: g.built.backtest, transaction: g.transaction })
    ok('the preview counts all four bookings as hits', numbers.treffer === 4)
    ok('…but promises only the two free ones', numbers.gesamt === 2)

    const r = learn(g.built.request)
    ok('the database changed exactly two', r.applied_count + 1 === 2)
    ok('…the promise and the outcome are the same number', r.applied_count + 1 === numbers.gesamt)

    const after = reload()
    const row = (id) => after.transactions.find((t) => t.id === id)
    ok('the locked booking still has no merchant', row(locked).merchant_id === null)
    ok('the overridden booking still has no merchant', row(overridden).merchant_id === null)
    ok('the two free ones were assigned',
       row(open1).merchant_id !== null && row(open2).merchant_id !== null)

    const q = buildClassificationQueue({
      transactions: after.transactions, patterns: after.patterns, merchants: after.merchants,
      rules: after.categoryRules, overrides: after.overrides,
    })
    ok('the locked booking is not asked about again',
       !q.open.some((e) => e.transaction.id === locked))
    ok('…nor is the overridden one', !q.open.some((e) => e.transaction.id === overridden))
    ok('…and the free ones are done', !q.open.some((e) => e.transaction.id === open1 || e.transaction.id === open2))
  }

  // ══ 5. A damaged word cannot be learned, even by hand ════════════════════
  {
    const RC = String.fromCharCode(0xfffd)
    const broken = insertBooking(`Lo${RC}e's Coffee Stu${RC}gart`)
    const state = reload()
    const tx = state.transactions.find((t) => t.id === broken)
    const built = buildLearnRequest({
      transaction: tx, selection: ['LO'], patternType: 'exact_token',
      categorySlug: 'restaurant', categories: state.categories, merchantName: 'Lotte',
      transactions: state.transactions, patterns: state.patterns, overrides: state.overrides,
    })
    ok('a fragment never reaches the database', built.valid === false && built.request === null)

    const good = buildLearnRequest({
      transaction: tx, selection: ['COFFEE'], patternType: 'exact_token',
      categorySlug: 'restaurant', categories: state.categories, merchantName: 'Coffee',
      transactions: state.transactions, patterns: state.patterns, overrides: state.overrides,
    })
    ok('the intact word of the same booking can be learned', good.valid === true)
    const r = learn(good.request)
    ok('…and the database accepts it', r.pattern_created === true)
  }

  // ══ 6. A pattern that was never in the booking is refused by the DB ══════
  {
    const state = reload()
    const tx = state.transactions.find((t) => t.raw_description === 'Scalable Capital Verrechnungskonto')
    let refused = null
    try {
      learn({
        p_transaction_id: tx.id, p_category_slug: 'sonstige', p_pattern_type: 'exact_token',
        p_tokens: ['REWE'], p_merchant_id: null, p_merchant_name: 'Erfunden', p_review_mode: null,
        p_min_amount_minor: null, p_min_inclusive: true, p_max_amount_minor: null,
        p_max_inclusive: true, p_rule_currency: null, p_apply_transaction_ids: [],
      })
    } catch (err) { refused = String(err.stderr || err.message) }
    ok('a pattern the booking does not contain is refused by the database', refused !== null)
    ok('…and the client would never have sent it either',
       buildLearnRequest({
         transaction: tx, selection: ['REWE'], patternType: 'exact_token',
         categorySlug: 'sonstige', categories: state.categories, merchantName: 'Erfunden',
         transactions: state.transactions, patterns: state.patterns, overrides: state.overrides,
       }).valid === false)
  }

  // ══ 7. Nothing left anybody else's account ══════════════════════════════
  {
    const other = '11111111-2222-4333-8444-777777777777'
    psql(['-c', `insert into auth.users (id, email) values ('${other}', 'fremd@mindwhiteboard.test')`])
    const seen = jsonAsUser(other,
      `select count(*)::int as n from public.finance_merchant_patterns`)[0].n
    ok('another user sees none of these patterns', seen === 0)
    const merchants = jsonAsUser(other, `select count(*)::int as n from public.finance_merchants`)[0].n
    ok('…and none of these merchants', merchants === 0)
  }

  // ══ 8. REGRESSION: a booking whose columns are stamped but unexplained ═══
  //
  // The preview counted the booking in front of the user as unchanged whenever
  // it already had a merchant_id. finance_learn_merchant_rule does not: for THAT
  // booking it requires only "not locked, no override". The gap is exactly the
  // supported case — a booking classified once, whose pattern was later
  // deactivated, is put back in front of the user with its old ids still in the
  // row. Here the promise and the write are compared against the real function.
  {
    const dm1 = insertBooking('DM DROGERIEMARKT Troisdorf 111')
    const dm2 = insertBooking('DM DROGERIEMARKT Frankfurt 222')

    // Classify once, so the rows really are stamped by the real function.
    const before = reload()
    const g = gesture(before, dm1, { from: 0, to: 0 }, {
      categorySlug: 'drogerie', merchantName: 'dm',
    })
    learn(g.built.request)

    // Now deactivate the pattern, exactly as a later rule-management screen
    // would. Nothing else changes; the rows keep their ids.
    const stamped = reload()
    const dmPattern = stamped.patterns.find((p) => p.tokens.join(' ') === 'DM')
    jsonAsUser(userId,
      `update public.finance_merchant_patterns set active = false
       where id = '${dmPattern.id}' and user_id = '${userId}' returning id`)

    const reopened = reload()
    const row1 = reopened.transactions.find((t) => t.id === dm1)
    ok('the deactivated pattern is gone from the active set',
       !reopened.patterns.some((p) => p.id === dmPattern.id))
    ok('…while the booking still carries its old ids',
       row1.merchant_id !== null && row1.category_id !== null)
    const q = queueOf(reopened)
    ok('…and the engine has put both bookings back in the queue',
       q.open.some((e) => e.transaction.id === dm1) && q.open.some((e) => e.transaction.id === dm2))

    // Learn it again, under a different category, and compare promise to write.
    const again = gesture(reopened, dm1, { from: 0, to: 0 }, {
      categorySlug: 'sonstige', merchantName: 'dm Drogerie',
    })
    const promised = backtestNumbers({ backtest: again.built.backtest, transaction: again.transaction })
    ok('the stamped booking is promised as changing', promised.aktuelleAendertSich === true)
    // Exactly one, and the asymmetry is the function's, not a rounding of it:
    // the booking in hand is written whatever its columns hold, while a stamped
    // booking that is merely swept up is protected by `merchant_id is null`.
    ok('…and only that one, because the other is stamped too', promised.gesamt === 1)
    ok('…the other is a hit that stays unchanged',
       promised.treffer === 2 && promised.unveraendert === 1)
    ok('…so nothing else is even requested', again.built.request.p_apply_transaction_ids.length === 0)

    const r = learn(again.built.request)
    ok('the database updated the stamped booking', r.transaction_updated === true)
    ok('the promise equals applied_count + transaction_updated',
       promised.gesamt === r.applied_count + (r.transaction_updated ? 1 : 0))

    const after = reload()
    const updated = after.transactions.find((t) => t.id === dm1)
    const sonstige = after.categories.find((c) => c.slug === 'sonstige').id
    ok('…the row really carries the new category now', updated.category_id === sonstige)
    ok('…and the stamped one it was not allowed to touch still holds the old one',
       after.transactions.find((t) => t.id === dm2).category_id !== sonstige)
    const qAfter = queueOf(after)
    ok('…and after the reload the engine calls it resolved',
       !qAfter.open.some((e) => e.transaction.id === dm1))
    ok('…as it does the second one, through the new pattern rather than its column',
       !qAfter.open.some((e) => e.transaction.id === dm2))
  }

  // ══ 9. REGRESSION: a conflict is decided, not out-patterned ══════════════
  {
    const tx = insertBooking('KAUFHOF GALERIA Musterstadt Filiale')
    const state0 = reload()

    // Two merchants, each taught from this very booking — the honest way to
    // create a conflict, since a pattern must occur in the booking it is
    // learned from.
    const first = gesture(state0, tx, { from: 0, to: 0 }, {
      categorySlug: 'klamotten', merchantName: 'Kaufhof',
    })
    learn(first.built.request)
    const state1 = reload()
    const second = gesture(state1, tx, { from: 1, to: 1 }, {
      categorySlug: 'sonstige', merchantName: 'Galeria',
    })
    learn(second.built.request)

    const conflicted = reload()
    const q = queueOf(conflicted)
    const entry = q.entries.find((e) => e.transaction.id === tx)
    ok('two merchants claiming one booking is a conflict', entry.status === 'conflict')
    ok('…and it is back in the queue', q.open.some((e) => e.transaction.id === tx))
    ok('…recognised as a decision, not as a lesson',
       decisionKindOf(entry) === DECISION.RESOLVE_CONFLICT)
    const explanation = decisionExplanation(entry, conflicted.merchants)
    ok('…naming both claimants',
       explanation.lines.join(' ').includes('Kaufhof') && explanation.lines.join(' ').includes('Galeria'))
    ok('…and promising nothing about a more specific pattern',
       !explanation.lines.join(' ').includes('genaueres Muster'))

    // Proof against the real engine: a third, more specific pattern does NOT
    // resolve it. Learned from the same booking, so the database accepts it.
    const third = gesture(conflicted, tx, { from: 0, to: 1 }, {
      categorySlug: 'klamotten',
      merchantId: conflicted.merchants.find((m) => m.canonical_name === 'Kaufhof').id,
    })
    learn(third.built.request)
    const stillConflicted = reload()
    ok('a more specific pattern leaves the conflict exactly as it was',
       queueOf(stillConflicted).entries.find((e) => e.transaction.id === tx).status === 'conflict')

    // What does settle it: one decision about this one booking.
    const patternsBefore = stillConflicted.patterns.map((p) => p.id).sort().join(',')
    const rowBefore = stillConflicted.transactions.find((t) => t.id === tx)
    const kaufhof = stillConflicted.merchants.find((m) => m.canonical_name === 'Kaufhof')
    const klamotten = stillConflicted.categories.find((c) => c.slug === 'klamotten').id
    writeOverride(tx, buildOverride({ merchantId: kaufhof.id, categoryId: klamotten }))

    const decided = reload()
    const entryAfter = queueOf(decided).entries.find((e) => e.transaction.id === tx)
    ok('after the decision the booking is settled', entryAfter.status === 'resolved')
    ok('…as the merchant the user picked', entryAfter.merchantId === kaufhof.id)
    ok('…in the category they picked', entryAfter.categoryId === klamotten)
    ok('…marked as decided by hand', entryAfter.locked === true)
    ok('…and out of the queue', !queueOf(decided).open.some((e) => e.transaction.id === tx))
    ok('every global pattern is exactly as it was',
       decided.patterns.map((p) => p.id).sort().join(',') === patternsBefore)
    ok('…and none was deactivated', decided.patterns.every((p) => p.active === true))
    // The decision lives in the override table, not in the booking: the row is
    // byte for byte what it was, and the answer changed all the same.
    const rowAfter = decided.transactions.find((t) => t.id === tx)
    ok('the booking row itself was not touched',
       rowAfter.merchant_id === rowBefore.merchant_id &&
       rowAfter.category_id === rowBefore.category_id)
    ok('…so what settled it is the override, nothing else',
       decided.overrides.filter((o) => o.transaction_id === tx).length === 1)
  }

  // ══ 10. REGRESSION: always_review is answered per booking ════════════════
  {
    const first = insertBooking('PayPal Europe Sarl et Cie SCA 1052906804694')
    const state = reload()

    // A new merchant, created as always_review through the existing request —
    // one call, no second write.
    const g = gesture(state, first, { from: 0, to: 0 }, {
      categorySlug: 'sonstige', merchantName: 'PayPal',
    })
    g.built.request.p_review_mode = 'always_review'
    const r = learn(g.built.request)
    ok('the merchant was created in the same call', r.merchant_created === true)

    const withPaypal = reload()
    const paypal = withPaypal.merchants.find((m) => m.canonical_name === 'PayPal')
    ok('…and it really is always_review', paypal.review_mode === 'always_review')

    const q = queueOf(withPaypal)
    const entry = q.entries.find((e) => e.transaction.id === first)
    ok('the booking is put up for review, not filed away', entry.status === 'review_required')
    ok('…the merchant is recognised all the same', entry.merchantMatch.merchantId === paypal.id)
    ok('…and no category was applied', entry.categoryId === null)
    ok('…so the flow asks for a decision, not for a merchant',
       decisionKindOf(entry) === DECISION.REVIEW)

    const restaurant = withPaypal.categories.find((c) => c.slug === 'restaurant').id
    writeOverride(first, buildOverride({ merchantId: paypal.id, categoryId: restaurant }))

    const decided = reload()
    ok('the decided booking leaves the queue',
       !queueOf(decided).open.some((e) => e.transaction.id === first))
    ok('…with the chosen category',
       queueOf(decided).entries.find((e) => e.transaction.id === first).categoryId === restaurant)

    // THE point of always_review: the next one is asked about again.
    const second = insertBooking('PayPal Europe Sarl et Cie SCA 9999999999999')
    const next = reload()
    ok('a new PayPal booking is put up for review again',
       queueOf(next).open.some((e) => e.transaction.id === second))
    ok('…as a review, not as unknown',
       queueOf(next).entries.find((e) => e.transaction.id === second).status === 'review_required')
    ok('the merchant is still always_review',
       next.merchants.find((m) => m.id === paypal.id).review_mode === 'always_review')
  }

  // ══ 11. An existing merchant's review mode is never changed in passing ═══
  {
    const state = reload()
    const paypal = state.merchants.find((m) => m.canonical_name === 'PayPal')
    const tx = insertBooking('PayPal Europe Sarl et Cie SCA 4711 Zahlung')
    const fresh = reload()

    // The sheet sends no mode when an existing merchant was chosen. Learning
    // another pattern for PayPal must therefore leave it always_review.
    const g = gesture(fresh, tx, { from: 4, to: 5 }, {
      categorySlug: 'sonstige', merchantId: paypal.id,
    })
    ok('no review mode is sent for an existing merchant', g.built.request.p_review_mode === null)
    learn(g.built.request)

    const after = reload()
    ok('PayPal is still always_review',
       after.merchants.find((m) => m.id === paypal.id).review_mode === 'always_review')
    ok('…and its bookings are still put up for review',
       queueOf(after).entries.find((e) => e.transaction.id === tx).status === 'review_required')
  }

  // ══ 12. REGRESSION: the OTHER reason for review_required ════════════════
  //
  // resolveCategory reports REVIEW_REQUIRED for a merchant the user asked to see
  // every time AND for a booking whose amount no rule covered. The override
  // path is the same; the sentence must not be.
  {
    // A merchant nothing else in this file has taught, so `merchant_created`
    // really is about this call.
    const small = insertBooking('BACKHAUS Musterstadt Filiale klein', { amountMinor: -1234 })
    const large = insertBooking('BACKHAUS Musterstadt Filiale gross', { amountMinor: -6000 })
    const state = reload()

    // A conditional merchant with a default rule, created in one call.
    const g = gesture(state, small, { from: 0, to: 0 }, {
      categorySlug: 'lebensmittel', merchantName: 'Backhaus',
    })
    g.built.request.p_review_mode = 'conditional'
    const created = learn(g.built.request)
    ok('the conditional merchant was created', created.merchant_created === true)

    const withEdeka = reload()
    const edeka = withEdeka.merchants.find((m) => m.canonical_name === 'Backhaus')
    ok('…and it really is conditional', edeka.review_mode === 'conditional')

    // An amount rule that covers only the large booking, through the same call.
    const g2 = gesture(withEdeka, large, { from: 0, to: 0 }, {
      categorySlug: 'restaurant', merchantId: edeka.id,
    })
    g2.built.request.p_min_amount_minor = 5000
    g2.built.request.p_rule_currency = 'EUR'
    const ruled = learn(g2.built.request)
    ok('the amount rule was added as its own rule', ruled.rule_created === true)

    const ready = reload()
    ok('the merchant now has two rules',
       ready.categoryRules.filter((r) => r.merchant_id === edeka.id).length === 2)

    const q = queueOf(ready)
    const smallEntry = q.entries.find((e) => e.transaction.id === small)
    const largeEntry = q.entries.find((e) => e.transaction.id === large)

    ok('the covered booking is decided automatically', largeEntry.status === 'resolved')
    ok('…by the amount rule',
       largeEntry.categoryId === ready.categories.find((c) => c.slug === 'restaurant').id)
    ok('the uncovered one is put up once', smallEntry.status === 'review_required')
    ok('…for the other reason', smallEntry.category.reason === 'merchant_conditional_default')
    ok('…and it is in the queue', q.open.some((e) => e.transaction.id === small))

    const explanation = decisionExplanation(smallEntry, ready.merchants)
    ok('the screen does not claim this merchant is checked every time',
       !explanation.headline.includes('jedes Mal') && !explanation.lines.join(' ').includes('jedes Mal'))
    ok('…it explains that no rule covered this booking',
       explanation.headline.includes('greift keine Regel'))

    // The rule's own answer is offered, preselected.
    const lebensmittel = ready.categories.find((c) => c.slug === 'lebensmittel').id
    ok('the fallback the rule would have used is offered as the suggestion',
       smallEntry.category.suggestedCategoryId === lebensmittel)
    ok('…without having been applied', smallEntry.categoryId === null)

    // Decide it, and the same override path settles it.
    const drogerie = ready.categories.find((c) => c.slug === 'drogerie').id
    writeOverride(small, buildOverride({ merchantId: edeka.id, categoryId: drogerie }))

    const decided = reload()
    const after = queueOf(decided)
    ok('the decided booking is resolved', after.entries.find((e) => e.transaction.id === small).status === 'resolved')
    ok('…in the category the user picked',
       after.entries.find((e) => e.transaction.id === small).categoryId === drogerie)
    ok('…and out of the queue', !after.open.some((e) => e.transaction.id === small))
    ok('the merchant keeps its conditional mode',
       decided.merchants.find((m) => m.id === edeka.id).review_mode === 'conditional')
    ok('…and both of its rules are untouched',
       decided.categoryRules.filter((r) => r.merchant_id === edeka.id).length === 2)
  }

  console.log(`finance classify e2e: ${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} catch (err) {
  console.error('finance classify e2e: FEHLGESCHLAGEN\n')
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
