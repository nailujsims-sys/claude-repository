// The import, end to end, against a real database.
//
// Every other suite proves one layer. This one proves the seam nobody can test
// in isolation: what happens when the app is closed between two imports and the
// next reconciliation has nothing but the database to work from.
//
// REAL EVERYTHING. A throwaway Postgres with the real migrations and the real
// `finance_apply_reconciliation_plan`; the real parser, the real matcher and the
// real payload builder, bundled out of src/. The only thing simulated is the
// browser reload — and it is simulated by throwing away every JavaScript value
// and reading the account back out of SQL, which is exactly what a reload does.
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
  console.log('finance e2e: kein lokales Postgres gefunden — übersprungen.')
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
  console.log('finance e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
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
      export { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
      export { buildPlan, buildPayload, summarizePlan, previewRows, hydrateForMatching } from './src/lib/finance/importFlow.js'
      export { referenceDocument, secondExportDocument } from './tools/fixtures/dkbUmsatzexport.mjs'
    `,
    resolveDir: process.cwd(),
    sourcefile: 'e2e.mjs',
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
const modulePath = `${process.env.SCRATCH || '/tmp'}/financeImportE2E.bundled.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const {
  parseDkbUmsatzexport, buildPlan, buildPayload, summarizePlan, previewRows, hydrateForMatching,
  referenceDocument, secondExportDocument,
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

const dir = mkdtempSync(join(tmpdir(), 'mw-e2e-'))
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

  // Every statement runs as the signed-in user, through the same policies the
  // browser does — the connection is the only thing the test owns.
  const asUser = (userId, sql) => {
    const script = `set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
${sql}`
    writeFileSync(sqlFile, script)
    if (sudoUser) chownSync(sqlFile, sudoUser.uid, sudoUser.uid)
    return psql(['-t', '-A', '-f', sqlFile])
  }
  // A plain SELECT goes in a subquery; a writing statement has to be a CTE,
  // because `insert ... returning` is not a table expression.
  const jsonAsUser = (userId, sql) => {
    const writes = /^\s*(insert|update|delete)\b/i.test(sql)
    // jsonb, not json: `json_agg` pretty-prints with a newline between every
    // element, and this bridge reads one line back out of psql.
    const wrapped = writes
      ? `with t as (${sql}) select coalesce(jsonb_agg(t), '[]'::jsonb)::text from t;`
      : `select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (${sql}) t;`
    const out = asUser(userId, wrapped)
    const line = out.trim().split('\n').filter(Boolean).pop()
    try {
      return JSON.parse(line)
    } catch (err) {
      throw new Error(`psql gab nichts Lesbares zurueck:\n--- Ausgabe ---\n${out}\n--- Zeile ---\n${line}`)
    }
  }

  const userId = '11111111-2222-4333-8444-555555555555'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'e2e@mindwhiteboard.test')`])
  const accountId = jsonAsUser(
    userId,
    `insert into public.finance_accounts (user_id, name, provider, currency)
     values ('${userId}', 'DKB Girokonto', 'DKB', 'EUR') returning id`
  )[0].id

  // ── what a reload gives the client back ──────────────────────────────────
  // Exactly the two reads FinanceContext performs, and nothing else. If the
  // matcher needs something these do not return, this is where it shows.
  const reload = () => ({
    transactions: jsonAsUser(
      userId,
      `select id, account_id, booking_date, amount_minor, currency, raw_description,
              external_reference, manual_lock, include_in_analytics
       from public.finance_transactions where user_id = '${userId}'
       order by booking_date desc, created_at desc`
    ),
    overrides: jsonAsUser(
      userId,
      `select transaction_id from public.finance_transaction_overrides where user_id = '${userId}'`
    ),
    observations: jsonAsUser(
      userId,
      `select transaction_id, observed_description, observed_reference, created_at
       from public.finance_transaction_observations where user_id = '${userId}'
       order by created_at`
    ),
  })

  // The best evidence the database holds about each booking — the stored text,
  // or the richer one a later export contributed. This is the comparison that
  // decides whether reloading loses anything.
  const reloadWithObservations = () => {
    const rows = jsonAsUser(
      userId,
      `select t.id, t.account_id, t.booking_date, t.amount_minor, t.currency,
              coalesce(o.observed_description, t.raw_description) as raw_description,
              coalesce(o.observed_reference, t.external_reference) as external_reference,
              t.manual_lock
       from public.finance_transactions t
       left join lateral (
         select observed_description, observed_reference
         from public.finance_transaction_observations obs
         where obs.transaction_id = t.id
         order by obs.created_at desc limit 1
       ) o on true
       where t.user_id = '${userId}'
       order by t.booking_date desc, t.created_at desc`
    )
    return rows
  }

  let importCounter = 0
  const applyStatement = (parsed, state, { label }) => {
    const plan = buildPlan({
      parsed,
      existing: state.transactions.filter((t) => t.account_id === accountId),
      observations: state.observations,
      overrideTransactionIds: state.overrides.map((o) => o.transaction_id),
      accountId,
    })
    const totals = summarizePlan(plan)
    importCounter += 1
    const importId = jsonAsUser(
      userId,
      `insert into public.finance_imports
         (user_id, account_id, source_type, source_name, source_hash, status, period_start, period_end)
       values ('${userId}', '${accountId}', 'pdf', '${label}.pdf', 'hash-${label}', 'parsed',
               ${parsed.header.period_start ? `'${parsed.header.period_start}'` : 'null'},
               ${parsed.header.period_end ? `'${parsed.header.period_end}'` : 'null'})
       returning id`
    )[0].id
    const payload = buildPayload({ importId, accountId, parsed, plan })
    // Dollar-quoted: a bank statement is full of quotes and backslashes, and
    // escaping them by hand is how a test starts testing its own escaping.
    const lit = (value) => `$json$${JSON.stringify(value)}$json$`
    const result = jsonAsUser(
      userId,
      `select public.finance_apply_reconciliation_plan(
         '${importId}', '${accountId}',
         ${lit(payload.bookings)}::jsonb,
         ${lit(payload.decisions)}::jsonb,
         ${lit(payload.refund_candidates)}::jsonb
       ) as r`
    )[0].r
    return { plan, totals, result, payload }
  }

  const A = parseDkbUmsatzexport(referenceDocument())
  const B = parseDkbUmsatzexport(secondExportDocument())
  ok('both fixtures parse', A.ok && B.ok)

  // ══ 1. A → Reload → B → Reload → C ═══════════════════════════════════════
  const first = applyStatement(A, reload(), { label: 'a' })
  ok('the first import creates every booking of the file',
     first.result.transactions_created === A.transactions.length)

  // RELOAD. Everything the JavaScript above computed is now out of scope; the
  // next step reads the account back out of SQL.
  const afterA = reload()
  ok('a reload returns what was written', afterA.transactions.length === A.transactions.length)
  ok('…with the original texts intact',
     afterA.transactions.every((t) => typeof t.raw_description === 'string' && t.raw_description.length > 0))

  const second = applyStatement(B, afterA, { label: 'b' })
  ok('the second export is not taken as all new',
     second.totals.neu < B.transactions.length)
  ok('…and recognises what is already stored',
     second.totals.vorhanden + second.totals.aktualisiert + second.totals.ersetzt > 0)
  ok('…and supersedes the provisional bookings', second.result.supersessions_confirmed > 0)
  ok('…creating exactly what the preview promised',
     second.result.transactions_created === second.totals.gespeichert)

  // RELOAD again, then the same export a third time.
  const afterB = reload()
  // Note the label: a DIFFERENT source_hash for the SAME bookings. A new byte
  // hash is a new file, never a new economic identity — that judgement belongs
  // to the reconciliation, and this is where it has to hold.
  const third = applyStatement(B, afterB, { label: 'c' })
  ok('the same bookings from a differently-hashed file create nothing',
     third.result.transactions_created === 0)
  ok('…and the preview said so', third.totals.gespeichert === 0)
  ok('…and no second supersession is proposed', third.result.supersessions_confirmed === 0)
  ok('…and no second observation is stored', third.result.observations_created === 0)

  const afterC = reload()
  ok('the account holds no duplicate bookings',
     afterC.transactions.length === afterA.transactions.length + second.result.transactions_created)

  // ══ 2. Does the reload lose evidence the matcher needs? ══════════════════
  // The same reconciliation twice: once from what FinanceContext loads, once
  // from what the database could tell it if observations were hydrated too.
  // A difference here is a matching regression caused by reloading.
  {
    const plain = buildPlan({
      parsed: B,
      existing: afterB.transactions.filter((t) => t.account_id === accountId),
      observations: afterB.observations,
      accountId,
    })
    const enriched = buildPlan({
      parsed: B,
      existing: reloadWithObservations().filter((t) => t.account_id === accountId),
      accountId,
    })
    const shape = (p) => p.decisions.map((d) => d.outcome).join(',')
    ok('reloading loses no matching quality', shape(plain) === shape(enriched))
    if (shape(plain) !== shape(enriched)) {
      console.log(`      ohne Beobachtungen: ${shape(plain)}`)
      console.log(`      mit  Beobachtungen: ${shape(enriched)}`)
    }
  }

  // ══ 3. A manual decision survives the reload and reaches the preview ══════
  {
    const target = afterC.transactions.find((t) => t.amount_minor === -1438)
    asUser(userId, `update public.finance_transactions set manual_lock = true where id = '${target.id}';`)
    const state = reload()
    ok('manual_lock comes back with the booking',
       state.transactions.find((t) => t.id === target.id)?.manual_lock === true)
    const plan = buildPlan({
      parsed: B,
      existing: state.transactions.filter((t) => t.account_id === accountId),
      observations: state.observations,
      accountId,
    })
    const rows = previewRows(B.transactions, plan)
    const touched = plan.decisions.filter((d) => (d.existing_ids ?? []).includes(target.id))
    ok('a locked booking is still matched', touched.length > 0)
    ok('…and never shown as silently replaced',
       touched.every((d) => d.outcome !== 'supersedes' && d.outcome !== 'supersedes_group'))
    ok('…it is shown as needing a look',
       touched.every((d) => rows.find((r) => r.index === d.index)?.status === 'Prüfen'))
    asUser(userId, `update public.finance_transactions set manual_lock = false where id = '${target.id}';`)
  }

  // ══ 4. An override survives the reload — does the preview know? ══════════
  {
    const target = reload().transactions.find((t) => t.amount_minor === -1438)
    asUser(
      userId,
      `insert into public.finance_transaction_overrides (user_id, transaction_id, note)
       values ('${userId}', '${target.id}', 'Von Hand entschieden.');`
    )
    const state = reload()
    ok('the override is readable after a reload', state.overrides.length === 1)
    const withOverrides = buildPlan({
      parsed: B,
      existing: state.transactions.filter((t) => t.account_id === accountId),
      observations: state.observations,
      overrideTransactionIds: state.overrides.map((o) => o.transaction_id),
      accountId,
    })
    const withoutOverrides = buildPlan({
      parsed: B,
      existing: state.transactions.filter((t) => t.account_id === accountId),
      observations: state.observations,
      accountId,
    })
    const touchedWith = withOverrides.decisions.filter((d) => (d.existing_ids ?? []).includes(target.id))
    const touchedWithout = withoutOverrides.decisions.filter((d) => (d.existing_ids ?? []).includes(target.id))
    ok('an overridden booking is protected when the overrides are passed',
       touchedWith.every((d) => d.outcome === 'review'))
    ok('…and the preview would be wrong without them',
       touchedWithout.some((d) => d.outcome !== 'review') || touchedWithout.length === 0)
    asUser(userId, `delete from public.finance_transaction_overrides where transaction_id = '${target.id}';`)
  }

  // ══ 5. The plan the preview showed is the plan that was applied ══════════
  {
    const state = reload()
    const plan = buildPlan({
      parsed: B,
      existing: state.transactions.filter((t) => t.account_id === accountId),
      observations: state.observations,
      accountId,
    })
    const totals = summarizePlan(plan)
    const rows = previewRows(B.transactions, plan)
    const payload = buildPayload({ importId: '11111111-2222-4333-8444-000000000009', accountId, parsed: B, plan })
    ok('every preview row has a decision in the payload',
       rows.every((r) => payload.decisions.some((d) => d.index === r.index)))
    ok('the payload decides exactly what the preview showed',
       rows.every((r) => {
         const d = payload.decisions.find((x) => x.index === r.index)
         return d.outcome === r.outcome
       }))
    ok('the promised count is the number of rows the payload creates',
       totals.gespeichert ===
         payload.decisions.filter((d) => ['new', 'supersedes', 'supersedes_group'].includes(d.outcome)).length)
  }

  // ══ 6. The answer that never arrived ════════════════════════════════════
  // The server committed, the client lost the response, the user tries again.
  // The import row is the same one, and the function replays instead of writing.
  {
    const before = reload()
    const parsed = B
    const plan = buildPlan({
      parsed,
      existing: before.transactions.filter((t) => t.account_id === accountId),
      observations: before.observations,
      accountId,
    })
    const importId = jsonAsUser(
      userId,
      `insert into public.finance_imports
         (user_id, account_id, source_type, source_hash, status, period_start, period_end)
       values ('${userId}', '${accountId}', 'pdf', 'hash-lost', 'parsed',
               '${parsed.header.period_start}', '${parsed.header.period_end}')
       returning id`
    )[0].id
    const payload = buildPayload({ importId, accountId, parsed, plan })
    const lit = (value) => `$json$${JSON.stringify(value)}$json$`
    const call = () =>
      jsonAsUser(
        userId,
        `select public.finance_apply_reconciliation_plan(
           '${importId}', '${accountId}',
           ${lit(payload.bookings)}::jsonb, ${lit(payload.decisions)}::jsonb,
           ${lit(payload.refund_candidates)}::jsonb) as r`
      )[0].r

    const committed = call()
    const countAfterFirst = reload().transactions.length
    const retried = call()
    ok('the retry is reported as a replay', retried.replayed === true)
    ok('…and writes nothing', reload().transactions.length === countAfterFirst)
    ok('…and the first call is what actually counted',
       committed.transactions_created === retried.transactions_created)

    // The same file picked again, after a reload: the row is found by its hash
    // and its status says the work is done.
    const known = jsonAsUser(
      userId,
      `select id, status from public.finance_imports
       where user_id = '${userId}' and source_hash = 'hash-lost'`
    )
    ok('the file is recognised by its hash after a reload', known.length === 1)
    ok('…and says it was already applied', known[0].status === 'imported')
  }

  // ══ 7. A failed apply must not lock the file out ═════════════════════════
  {
    const before = reload()
    const importId = jsonAsUser(
      userId,
      `insert into public.finance_imports
         (user_id, account_id, source_type, source_hash, status)
       values ('${userId}', '${accountId}', 'pdf', 'hash-retry', 'parsed')
       returning id`
    )[0].id
    const lit = (value) => `$json$${JSON.stringify(value)}$json$`

    // A plan the database refuses: a supersession over two different amounts.
    const victim = before.transactions[0]
    let refused = false
    try {
      jsonAsUser(
        userId,
        `select public.finance_apply_reconciliation_plan('${importId}', '${accountId}',
           ${lit([{ booking_date: '2026-09-14', amount_minor: -1, currency: 'EUR',
                    raw_description: 'Ein Cent', normalized_tokens: ['CENT'],
                    source_variant: 'standard', source_metadata: {} }])}::jsonb,
           ${lit([{ index: 0, outcome: 'supersedes', tier: 3, existing_ids: [victim.id],
                    reason: 'angeblich', evidence: {} }])}::jsonb,
           '[]'::jsonb) as r`
      )
    } catch {
      refused = true
    }
    ok('an impossible plan is refused', refused)
    const after = reload()
    ok('…and leaves no booking behind', after.transactions.length === before.transactions.length)
    const status = jsonAsUser(
      userId,
      `select status from public.finance_imports where id = '${importId}'`
    )[0].status
    ok('…and the import row stays retryable', status !== 'imported')

    // The same row, now with a plan that holds.
    const parsed = B
    const plan = buildPlan({
      parsed,
      existing: after.transactions.filter((t) => t.account_id === accountId),
      observations: after.observations,
      accountId,
    })
    const payload = buildPayload({ importId, accountId, parsed, plan })
    const result = jsonAsUser(
      userId,
      `select public.finance_apply_reconciliation_plan('${importId}', '${accountId}',
         ${lit(payload.bookings)}::jsonb, ${lit(payload.decisions)}::jsonb,
         ${lit(payload.refund_candidates)}::jsonb) as r`
    )[0].r
    ok('the retry of a failed import goes through', result.replayed === false)
    ok('…and still creates nothing it should not', result.transactions_created === plan.summary.new)
  }

  // ══ 8. One account, reused ══════════════════════════════════════════════
  {
    const accounts = jsonAsUser(
      userId,
      `select id, name from public.finance_accounts where user_id = '${userId}'`
    )
    ok('the whole run used exactly one account', accounts.length === 1)
    ok('…the one it started with', accounts[0].id === accountId)
    const foreign = jsonAsUser(
      userId,
      `select count(*)::int as n from public.finance_transactions
       where user_id = '${userId}' and account_id <> '${accountId}'`
    )[0].n
    ok('…and no booking landed anywhere else', foreign === 0)
  }

  console.log(`finance import e2e: ${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} catch (err) {
  console.error('finance e2e: FEHLGESCHLAGEN\n')
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
