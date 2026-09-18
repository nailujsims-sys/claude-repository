// Die manuelle Buchung und der KI-Import gegen eine echte Datenbank.
//
// Die reinen Module beweisen, was sie ablehnen. Was sie nicht beweisen können,
// ist die Hälfte, die in Postgres liegt — und das ist genau die Hälfte, an der
// ein Import wehtut:
//
//   • Eine manuelle Buchung ist Buchung UND Entscheidung, oder sie ist nichts.
//   • Ein angewendeter Import bleibt angewendet. Ein zweiter Aufruf schreibt
//     keine einzige Zeile mehr.
//   • Was ein Mensch entschieden hat, überschreibt kein Import.
//   • Dieselbe Buchung auf einem anderen Konto ist eine andere Buchung.
//   • Und was hier liegt, gehört genau einem Benutzer.
//
// Echte Migrationen, echte RPCs, echte Policies, echter Reload — simuliert
// dadurch, dass zwischendurch jeder JavaScript-Wert weggeworfen und der
// Kontostand aus SQL zurückgelesen wird.
//
// Überspringt (exit 0), wenn kein Postgres auf der Maschine ist, wie
// tools/rlsTest.mjs.
import { build } from 'esbuild'
import { execFileSync, spawnSync } from 'node:child_process'
import { chownSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  console.log('finance ai e2e: kein lokales Postgres gefunden — übersprungen.')
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
  console.log('finance ai e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
  process.exit(0)
}

const exe = (n) => (bin ? join(bin, n) : n)
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const pg = (cmd, args, opts = {}) =>
  sudoUser
    ? run('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', cmd, ...args], opts)
    : run(cmd, args, opts)

// ── die Module, einmal gebündelt ────────────────────────────────────────────
const bundled = await build({
  stdin: {
    contents: `
      export { parseAIImport, validateAIImport } from './src/lib/finance/ai/parse.js'
      export { buildAIImportPlan, buildAIApplyPayload, applyRowEdit } from './src/lib/finance/ai/plan.js'
      export { buildManualTransactionPayload } from './src/lib/finance/manualTransaction.js'
      export { buildClassificationQueue } from './src/lib/finance/classificationQueue.js'
      export { AI_CSV_HEADER } from './src/lib/finance/ai/format.js'
    `,
    resolveDir: process.cwd(),
    sourcefile: 'aiE2E.mjs',
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
const modulePath = `${process.env.SCRATCH || '/tmp'}/financeAiE2E.bundled.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const {
  parseAIImport, validateAIImport, buildAIImportPlan, buildAIApplyPayload, applyRowEdit,
  buildManualTransactionPayload, buildClassificationQueue, AI_CSV_HEADER,
} = await import(pathToFileURL(modulePath).href)

let pass = 0
let fail = 0
const ok = (name, cond) => {
  if (cond) pass += 1
  else {
    fail += 1
    console.log('  ✗ ' + name)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mw-ai-e2e-'))
const data = join(dir, 'data')
const sqlFile = join(dir, 'q.sql')
let started = false

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
  ok('alle Migrationen inklusive 0011 laufen durch', true)

  // Jede Anweisung läuft als der angemeldete Benutzer, durch dieselben Policies
  // wie der Browser.
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
  const failsAsUser = (userId, sql) => {
    try {
      asUser(userId, sql)
      return false
    } catch {
      return true
    }
  }

  const userId = '11111111-2222-4333-8444-555555555555'
  const otherUser = '99999999-2222-4333-8444-555555555555'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'ai@mindwhiteboard.test')`])
  psql(['-c', `insert into auth.users (id, email) values ('${otherUser}', 'fremd@mindwhiteboard.test')`])

  const newAccount = (owner, name) =>
    jsonAsUser(
      owner,
      `insert into public.finance_accounts (user_id, name, provider, currency)
       values ('${owner}', '${name}', null, 'EUR') returning id`
    )[0].id

  const giro = newAccount(userId, 'Girokonto')
  const karte = newAccount(userId, 'Kreditkarte')

  const categories = jsonAsUser(
    userId,
    `select id, slug, label, sort_order from public.finance_categories
     where user_id = '${userId}' order by sort_order`
  )
  ok('das Konto bringt seine Kategorien mit', categories.length === 5)
  const lebensmittel = categories.find((c) => c.slug === 'lebensmittel')
  const restaurant = categories.find((c) => c.slug === 'restaurant')

  const callRpc = (owner, sql) => {
    const out = asUser(owner, `select ${sql};`)
    const line = out.trim().split('\n').filter(Boolean).pop()
    return JSON.parse(line)
  }

  // ── 1. Eine Buchung von Hand ──────────────────────────────────────────────
  const manual = (form) => {
    const built = buildManualTransactionPayload(form)
    if (!built.ok) throw new Error('Payload abgelehnt: ' + built.errors.join(', '))
    const p = built.payload
    const tokens = p.p_normalized_tokens.length
      ? `array[${p.p_normalized_tokens.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`
      : `'{}'::text[]`
    return callRpc(
      userId,
      `public.finance_create_manual_transaction(
         '${p.p_account_id}'::uuid, '${p.p_booking_date}'::date, ${p.p_amount_minor}::bigint,
         '${p.p_currency}', $txt$${p.p_raw_description}$txt$, ${tokens},
         ${p.p_category_id ? `'${p.p_category_id}'::uuid` : 'null'},
         ${p.p_merchant_id ? `'${p.p_merchant_id}'::uuid` : 'null'},
         '${p.p_transaction_type}', ${p.p_include_in_analytics},
         ${p.p_note ? `$txt$${p.p_note}$txt$` : 'null'},
         $json$${JSON.stringify(p.p_source_metadata)}$json$::jsonb
       )`
    )
  }

  const ausgabe = manual({
    accountId: giro, amountInput: '24,95', direction: 'out', date: '2026-09-18',
    description: 'REWE Troisdorf', categoryId: lebensmittel.id, note: 'Wocheneinkauf',
  })
  const ausgabeRow = jsonAsUser(
    userId,
    `select amount_minor, currency, transaction_type, manual_lock, include_in_analytics,
            import_id, category_id, source_metadata->>'origin' as origin
     from public.finance_transactions where id = '${ausgabe.transaction_id}'`
  )[0]
  ok('eine Ausgabe wird negativ gespeichert', ausgabeRow.amount_minor === -2495)
  ok('… als Kauf', ausgabeRow.transaction_type === 'purchase')
  ok('… mit der gewählten Kategorie', ausgabeRow.category_id === lebensmittel.id)
  ok('… und gilt als von Hand entschieden', ausgabeRow.manual_lock === true)
  ok('… gehört zu keinem Import', ausgabeRow.import_id === null)
  ok('… und sagt ehrlich, woher sie kommt', ausgabeRow.origin === 'manual')

  const ausgabeOverride = jsonAsUser(
    userId,
    `select note, category_id, transaction_type, include_in_analytics
     from public.finance_transaction_overrides where transaction_id = '${ausgabe.transaction_id}'`
  )
  ok('die Entscheidung des Menschen steht in ihrer eigenen Zeile', ausgabeOverride.length === 1)
  ok('… mit der Notiz', ausgabeOverride[0].note === 'Wocheneinkauf')
  ok('… mit der Kategorie', ausgabeOverride[0].category_id === lebensmittel.id)

  const einnahme = manual({
    accountId: giro, amountInput: '1200', direction: 'in', date: '2026-09-01',
    description: 'Gehalt September',
  })
  const einnahmeRow = jsonAsUser(
    userId,
    `select amount_minor, transaction_type, category_id from public.finance_transactions
     where id = '${einnahme.transaction_id}'`
  )[0]
  ok('eine Einnahme wird positiv gespeichert', einnahmeRow.amount_minor === 120000)
  ok('… als Einnahme', einnahmeRow.transaction_type === 'income')
  ok('… und braucht keine Kategorie', einnahmeRow.category_id === null)

  const andereskonto = manual({
    accountId: karte, amountInput: '9,90', direction: 'out', date: '2026-09-18',
    description: 'Spotify',
  })
  ok('eine Buchung landet auf dem gewählten Konto',
     jsonAsUser(userId, `select account_id from public.finance_transactions where id = '${andereskonto.transaction_id}'`)[0].account_id === karte)

  const ausgeschlossen = manual({
    accountId: giro, amountInput: '500', direction: 'out', date: '2026-09-05',
    description: 'Umbuchung Tagesgeld', includeInAnalytics: false,
  })
  ok('„zählt nicht" wird gespeichert',
     jsonAsUser(userId, `select include_in_analytics from public.finance_transactions where id = '${ausgeschlossen.transaction_id}'`)[0].include_in_analytics === false)
  ok('… und die Auswertung übergeht die Buchung wirklich',
     jsonAsUser(userId, `select id from public.finance_analytics_transactions where id = '${ausgeschlossen.transaction_id}'`).length === 0)
  ok('… während die Ausgabe von vorhin weiter zählt',
     jsonAsUser(userId, `select id from public.finance_analytics_transactions where id = '${ausgabe.transaction_id}'`).length === 1)

  ok('eine manuelle Buchung ohne Konto wird verweigert',
     failsAsUser(userId, `select public.finance_create_manual_transaction(
       '00000000-0000-4000-8000-000000000000'::uuid, '2026-09-18'::date, -100::bigint,
       'EUR', 'Test', '{}'::text[]);`))
  ok('eine manuelle Buchung ohne Text wird verweigert',
     failsAsUser(userId, `select public.finance_create_manual_transaction(
       '${giro}'::uuid, '2026-09-18'::date, -100::bigint, 'EUR', '   ', '{}'::text[]);`))
  ok('eine manuelle Buchung in ein fremdes Konto wird verweigert',
     failsAsUser(otherUser, `select public.finance_create_manual_transaction(
       '${giro}'::uuid, '2026-09-18'::date, -100::bigint, 'EUR', 'Fremd', '{}'::text[]);`))

  // ── 2. Reload: was die App nach einem Neustart sieht ──────────────────────
  const reload = () =>
    jsonAsUser(
      userId,
      `select id, account_id, booking_date, amount_minor, currency, raw_description,
              manual_lock, category_id, include_in_analytics
       from public.finance_transactions where user_id = '${userId}'
       order by booking_date desc, created_at desc`
    )

  const afterManual = reload()
  ok('alle vier manuellen Buchungen überleben den Reload', afterManual.length === 4)
  ok('… und tragen ihren Text unverändert',
     afterManual.some((t) => t.raw_description === 'REWE Troisdorf'))
  ok('… und bleiben entschieden', afterManual.every((t) => t.manual_lock === true))

  // ── 3. Der KI-Import ──────────────────────────────────────────────────────
  const envelope = (transactions) =>
    JSON.stringify({ format: 'leben-finance-import', version: 1, transactions })

  const RECORDS = [
    {
      booking_date: '2026-09-18', amount: -24.95, currency: 'EUR',
      raw_description: 'REWE Troisdorf', merchant: 'REWE', category: 'lebensmittel',
      transaction_type: 'purchase', include_in_analytics: true, note: null, needs_review: false,
    },
    {
      booking_date: '2026-09-19', amount: -42.5, currency: 'EUR',
      raw_description: 'RESTAURANT ZUM LOEWEN', merchant: null, category: 'urlaub',
      transaction_type: 'purchase', include_in_analytics: true, note: null, needs_review: true,
    },
    {
      booking_date: '2026-09-20', amount: -8.99, currency: 'EUR',
      raw_description: 'PAYPAL .Zalando SE', merchant: 'Zalando', category: 'klamotten',
      transaction_type: 'purchase', include_in_analytics: true, note: null, needs_review: false,
    },
  ]

  const readPlan = (accountId, existing) => {
    const parsed = parseAIImport(envelope(RECORDS))
    if (!parsed.ok) throw new Error('Umschlag abgelehnt')
    const checked = validateAIImport(parsed.payload, { categories })
    if (!checked.ok) throw new Error('Zeilen abgelehnt: ' + JSON.stringify(checked.errors))
    return buildAIImportPlan({ entries: checked.entries, existing, accountId })
  }

  const plan = readPlan(giro, reload())
  ok('die schon von Hand gebuchte Zeile erkennt der Abgleich wieder',
     plan.rows[0].status === 'duplicate')
  ok('die beiden anderen sind neu', plan.rows[1].status === 'new' && plan.rows[2].status === 'new')
  ok('die Zeile mit der erfundenen Kategorie will geprüft werden',
     plan.rows[1].needsReview === true && plan.rows[1].categoryId === null)

  // Der Mensch korrigiert im Preview, was das Modell nicht wusste.
  const corrected = plan.rows.map((row) =>
    row.index === 1 ? applyRowEdit(row, { categoryId: restaurant.id, note: 'Geburtstag' }) : row
  )

  const openImport = (accountId, hash) =>
    jsonAsUser(
      userId,
      `insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash, status)
       values ('${userId}', '${accountId}', 'ai', 'KI-Import', '${hash}', 'parsed') returning id`
    )[0].id

  const importId = openImport(giro, 'hash-block-1')
  ok('ein Import darf die Herkunft „ai" tragen', Boolean(importId))

  const payload = buildAIApplyPayload({ importId, accountId: giro, rows: corrected })
  ok('nur die neuen Zeilen gehen an die Datenbank', payload.bookings.length === 2)

  const applyAi = (owner, id, accountId, bookings) =>
    callRpc(
      owner,
      `public.finance_apply_ai_import('${id}'::uuid, '${accountId}'::uuid, $json$${JSON.stringify(bookings)}$json$::jsonb)`
    )

  const result = applyAi(userId, importId, giro, payload.bookings)
  ok('der Import speichert genau die neuen Zeilen', result.created === 2)
  ok('… und er ist keine Wiederholung', result.replayed === false)
  ok('… und je Zeile einen Vorschlag', result.suggestions === 2)
  ok('… und genau eine Nutzerentscheidung', result.decisions === 1)

  const afterImport = reload()
  ok('nach dem Import stehen sechs Buchungen da', afterImport.length === 6)

  const zalando = afterImport.find((t) => t.raw_description === 'PAYPAL .Zalando SE')
  ok('der Originaltext wird nicht durch den erkannten Händler ersetzt', Boolean(zalando))
  ok('… und trägt die vorgeschlagene Kategorie',
     zalando.category_id === categories.find((c) => c.slug === 'klamotten').id)
  ok('… ist aber nicht als menschliche Entscheidung markiert', zalando.manual_lock === false)

  const zalandoSuggestion = jsonAsUser(
    userId,
    `select merchant_name, needs_review, user_edited, format_version
     from public.finance_transaction_ai_suggestions where transaction_id = '${zalando.id}'`
  )[0]
  ok('der Händlervorschlag der KI ist gespeichert', zalandoSuggestion.merchant_name === 'Zalando')
  ok('… mit seiner Formatversion', zalandoSuggestion.format_version === 1)
  ok('… und ohne Korrektur', zalandoSuggestion.user_edited === false)
  ok('… und der Vorschlag legt keinen Händler in der Lern-Engine an',
     jsonAsUser(userId, `select id from public.finance_merchants where user_id = '${userId}'`).length === 0)

  const loewe = afterImport.find((t) => t.raw_description === 'RESTAURANT ZUM LOEWEN')
  ok('die korrigierte Zeile trägt die Kategorie des Menschen', loewe.category_id === restaurant.id)
  ok('… und gilt als entschieden', loewe.manual_lock === true)
  const loeweSuggestion = jsonAsUser(
    userId,
    `select merchant_name, category_id, needs_review, user_edited
     from public.finance_transaction_ai_suggestions where transaction_id = '${loewe.id}'`
  )[0]
  ok('der Vorschlag bleibt daneben stehen, so wie er ankam',
     loeweSuggestion.category_id === null && loeweSuggestion.merchant_name === null)
  ok('… mit der Unsicherheit des Modells', loeweSuggestion.needs_review === true)
  ok('… und der Information, dass der Mensch ihn geändert hat', loeweSuggestion.user_edited === true)
  ok('die Korrektur steht als Entscheidung in der Override-Tabelle',
     jsonAsUser(userId, `select note from public.finance_transaction_overrides where transaction_id = '${loewe.id}'`)[0].note === 'Geburtstag')

  // ── 4. Derselbe Block ein zweites Mal ─────────────────────────────────────
  const replay = applyAi(userId, importId, giro, payload.bookings)
  ok('ein zweiter Aufruf desselben Imports ist eine Wiederholung', replay.replayed === true)
  ok('… und schreibt keine einzige Zeile mehr', reload().length === 6)

  const secondPlan = readPlan(giro, reload())
  ok('derselbe Block erneut eingefügt findet nichts Neues', secondPlan.summary.neu === 0)
  ok('… und alle drei Zeilen als vorhanden', secondPlan.summary.vorhanden === 3)

  // ── 5. Eine bestehende Entscheidung wird nie überschrieben ────────────────
  const beforeNote = jsonAsUser(
    userId,
    `select note, category_id from public.finance_transaction_overrides
     where transaction_id = '${ausgabe.transaction_id}'`
  )[0]
  const thirdImport = openImport(giro, 'hash-block-2')
  const thirdPayload = buildAIApplyPayload({
    importId: thirdImport, accountId: giro, rows: readPlan(giro, reload()).rows,
  })
  ok('ein Import, der nichts Neues bringt, schickt nichts', thirdPayload.bookings.length === 0)
  applyAi(userId, thirdImport, giro, thirdPayload.bookings)
  const afterNote = jsonAsUser(
    userId,
    `select note, category_id from public.finance_transaction_overrides
     where transaction_id = '${ausgabe.transaction_id}'`
  )[0]
  ok('die Notiz des Menschen steht unverändert da', afterNote.note === beforeNote.note)
  ok('… und seine Kategorie auch', afterNote.category_id === beforeNote.category_id)
  ok('… und es ist keine Buchung dazugekommen', reload().length === 6)

  // ── 5b. Die Warteschlange nach einem KI-Import ────────────────────────────
  // Die Regression, um die es v1.23 geht: ein vollständiger, sicherer Vorschlag
  // ordnet den Umsatz ein — und was das Modell vorschlug, bleibt trotzdem
  // nachlesbar, ohne dass irgendwo eine globale Regel entstanden wäre.
  const queueState = () => {
    const transactions = jsonAsUser(
      userId,
      `select id, account_id, booking_date, amount_minor, currency, raw_description,
              normalized_tokens, category_id, merchant_id, manual_lock, include_in_analytics
       from public.finance_transactions where user_id = '${userId}'`
    )
    const suggestions = jsonAsUser(
      userId,
      `select transaction_id, merchant_name, category_id, needs_review, user_edited, created_at
       from public.finance_transaction_ai_suggestions where user_id = '${userId}'`
    )
    const overrideRows = jsonAsUser(
      userId,
      `select transaction_id, merchant_id, category_id, include_in_analytics, transaction_type, note
       from public.finance_transaction_overrides where user_id = '${userId}'`
    )
    const patternRows = jsonAsUser(
      userId,
      `select id, merchant_id, pattern_type, tokens, active from public.finance_merchant_patterns
       where user_id = '${userId}'`
    )
    const merchantRows = jsonAsUser(
      userId,
      `select id, canonical_name, review_mode, default_include_in_analytics
       from public.finance_merchants where user_id = '${userId}'`
    )
    const ruleRows = jsonAsUser(
      userId,
      `select id, merchant_id, category_id, min_amount_minor, max_amount_minor, currency, active
       from public.finance_category_rules where user_id = '${userId}'`
    )
    return {
      queue: buildClassificationQueue({
        transactions, patterns: patternRows, merchants: merchantRows, rules: ruleRows,
        overrides: overrideRows, aiSuggestions: suggestions,
      }),
      suggestions,
      merchants: merchantRows,
      patterns: patternRows,
    }
  }

  const state = queueState()
  const openIds = state.queue.open.map((entry) => entry.transaction.id)
  ok('der vollständig erkannte Umsatz braucht keine Zuordnung mehr',
     !openIds.includes(zalando.id))
  ok('… und gilt als eingeordnet',
     state.queue.entries.find((e) => e.transaction.id === zalando.id).source === 'ai_suggestion')
  ok('… der Vorschlag dazu bleibt nachlesbar',
     state.suggestions.find((s) => s.transaction_id === zalando.id)?.merchant_name === 'Zalando')
  ok('… und es ist dafür kein Händler entstanden', state.merchants.length === 0)
  ok('… und kein Muster', state.patterns.length === 0)
  ok('die vom Menschen korrigierte Zeile ist ebenfalls erledigt', !openIds.includes(loewe.id))
  ok('die von Hand angelegten Buchungen sowieso', !openIds.includes(ausgabe.transaction_id))
  ok('nach dem Import wartet keine einzige Buchung auf eine Zuordnung',
     state.queue.summary.offen === 0)

  // Dieselbe Frage, andersherum: eine unsichere Zeile bleibt sichtbar.
  const unsicherImport = openImport(giro, 'hash-block-review')
  const unsicherResult = applyAi(userId, unsicherImport, giro, [
    {
      booking_date: '2026-09-21',
      amount_minor: -1799,
      currency: 'EUR',
      raw_description: 'SUMUP *IMBISS',
      normalized_tokens: ['SUMUP', 'IMBISS'],
      category_id: null,
      transaction_type: 'purchase',
      include_in_analytics: true,
      suggestion: {
        merchant_name: null, category_id: null, transaction_type: 'purchase',
        include_in_analytics: true, note: null, needs_review: true, user_edited: false,
        format_version: 1,
      },
      user_decision: null,
    },
  ])
  ok('eine unsichere Zeile wird gespeichert', unsicherResult.created === 1)
  const afterReview = queueState()
  ok('… und bleibt zur Prüfung sichtbar', afterReview.queue.summary.offen === 1)
  ok('… und zwar genau sie',
     afterReview.queue.open[0].transaction.raw_description === 'SUMUP *IMBISS')

  // ── 6. Ein anderes Konto ist ein anderes Konto ────────────────────────────
  // Und diesmal durch die andere Tür: dieselben drei Buchungen, als Tabelle.
  const cardTable = [
    AI_CSV_HEADER,
    '2026-09-18;REWE Troisdorf;-24,95;EUR;REWE;lebensmittel;purchase;true;;false',
    '2026-09-19;RESTAURANT ZUM LOEWEN;-42,50;EUR;;;purchase;true;;true',
    '2026-09-20;PAYPAL .Zalando SE;-8,99;EUR;Zalando;klamotten;purchase;true;;false',
  ].join('\n')
  const cardParsed = parseAIImport(cardTable)
  ok('die Tabelle kommt als Semikolon-Format an', cardParsed.format === 'semicolon')
  const cardChecked = validateAIImport(cardParsed.payload, { categories })
  ok('… und wird ohne Beanstandung geprüft', cardChecked.ok)
  const cardPlan = buildAIImportPlan({
    entries: cardChecked.entries, existing: reload(), observations: [], accountId: karte,
  })
  ok('derselbe Auszug in ein anderes Konto ist vollständig neu', cardPlan.summary.neu === 3)
  const cardImport = openImport(karte, 'hash-block-3')
  const cardResult = applyAi(
    userId, cardImport, karte,
    buildAIApplyPayload({ importId: cardImport, accountId: karte, rows: cardPlan.rows }).bookings
  )
  ok('… und wird auch so gespeichert', cardResult.created === 3)
  ok('… mit demselben Betrag, den die Tabelle nannte',
     jsonAsUser(userId, `select amount_minor from public.finance_transactions
       where account_id = '${karte}' and raw_description = 'REWE Troisdorf'`)[0].amount_minor === -2495)
  ok('… auf dem Konto, das der Mensch gewählt hat',
     jsonAsUser(userId, `select id from public.finance_transactions
       where account_id = '${karte}' and raw_description = 'REWE Troisdorf'`).length === 1)
  ok('… ohne die Buchung des anderen Kontos anzufassen',
     jsonAsUser(userId, `select id from public.finance_transactions
       where account_id = '${giro}' and raw_description = 'REWE Troisdorf'`).length === 1)

  // ── 7. Was die Datenbank nicht glaubt ─────────────────────────────────────
  const strayImport = openImport(giro, 'hash-block-4')
  ok('ein Import, der zu einem anderen Konto gehört, wird verweigert',
     failsAsUser(userId, `select public.finance_apply_ai_import('${strayImport}'::uuid, '${karte}'::uuid, '[]'::jsonb);`))
  ok('eine Zeile ohne Text wird verweigert',
     failsAsUser(userId, `select public.finance_apply_ai_import('${strayImport}'::uuid, '${giro}'::uuid,
       $json$[{"booking_date":"2026-09-18","amount_minor":-100,"raw_description":"  "}]$json$::jsonb);`))
  ok('eine Zeile ohne Datum wird verweigert',
     failsAsUser(userId, `select public.finance_apply_ai_import('${strayImport}'::uuid, '${giro}'::uuid,
       $json$[{"amount_minor":-100,"raw_description":"REWE"}]$json$::jsonb);`))
  ok('eine Zeile ohne Betrag wird verweigert',
     failsAsUser(userId, `select public.finance_apply_ai_import('${strayImport}'::uuid, '${giro}'::uuid,
       $json$[{"booking_date":"2026-09-18","raw_description":"REWE"}]$json$::jsonb);`))
  ok('nach jeder Verweigerung steht keine halbe Buchung da',
     jsonAsUser(userId, `select id from public.finance_transactions where import_id = '${strayImport}'`).length === 0)
  ok('ein fremder Import lässt sich nicht anwenden',
     failsAsUser(otherUser, `select public.finance_apply_ai_import('${strayImport}'::uuid, '${giro}'::uuid, '[]'::jsonb);`))

  // ── 8. Die Vorschläge gehören genau einem Menschen ────────────────────────
  ok('ein anderer Benutzer sieht keinen einzigen Vorschlag',
     jsonAsUser(otherUser, `select id from public.finance_transaction_ai_suggestions`).length === 0)
  ok('… und keine Buchung', jsonAsUser(otherUser, `select id from public.finance_transactions`).length === 0)
  ok('anon darf die Vorschlagstabelle gar nicht lesen',
     (() => {
       try {
         psql(['-c', `set role anon; select count(*) from public.finance_transaction_ai_suggestions;`])
         return false
       } catch {
         return true
       }
     })())
  ok('ein Vorschlag lässt sich nachträglich nicht umschreiben',
     failsAsUser(userId, `update public.finance_transaction_ai_suggestions
       set merchant_name = 'Etwas anderes' where transaction_id = '${zalando.id}';`))
} finally {
  if (started) {
    try {
      pg(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'])
    } catch {
      /* egal — das Verzeichnis geht gleich sowieso weg */
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(`finance ai e2e: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
