// Das Gedächtnis gegen eine echte Datenbank.
//
// Die reinen Module beweisen, was sie ablehnen, bevor etwas gespeichert wird.
// Was sie nicht beweisen können, ist die Hälfte, die in Postgres liegt — und
// genau dort stehen die Zusagen, an denen v1.24 hängt:
//
//   • Buchung, Vorschlag, Entscheidung UND Erinnerung sind eine Transaktion.
//   • Ein wiederholter Import erzeugt keine zweite Erinnerung.
//   • Pro Händler gibt es höchstens eine aktive starke Regel — eine neue
//     ersetzt die alte, und Händlerregel und Dienstleister schließen sich aus.
//   • Gemerkt wird nur, was der Mensch korrigiert hat. Nie eine Notiz, nie eine
//     Buchungsart, die nur zufällig stehen blieb.
//   • Und was hier liegt, gehört genau einem Benutzer.
//
// Echte Migrationen (inklusive 0012), echte RPCs, echte Policies, echter
// Prompt-Builder auf den zurückgelesenen Zeilen.
//
// Überspringt (exit 0), wenn kein Postgres auf der Maschine ist.
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
  console.log('finance learning e2e: kein lokales Postgres gefunden — übersprungen.')
  process.exit(0)
}

// RLS_TEST_REQUIRED ist gesetzt — dann ist ein fehlendes PostgreSQL kein Grund
// zu überspringen, sondern ein Fehler. Ohne diese Zeilen liefe der Lauf weiter
// und scheiterte irgendwo weiter unten an einem ENOENT, dessen Meldung nichts
// darüber sagt, was eigentlich fehlt.
if (!bin) {
  console.error('finance learning e2e: RLS_TEST_REQUIRED ist gesetzt, aber es wurde kein unterstütztes PostgreSQL (16, 15 oder 14) gefunden.')
  process.exit(1)
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
  // PostgreSQL läuft nicht als root, also braucht dieser Lauf ein
  // unprivilegiertes Konto. Auf einem Entwicklungsrechner ist das ein Grund zu
  // überspringen; im Deployment ist es ein Fehler — ein Gate, das sich selbst
  // abschalten kann, ist kein Gate.
  if (process.env.RLS_TEST_REQUIRED) {
    console.error('finance learning e2e: läuft als root und findet kein unprivilegiertes Konto — im Deployment ist das ein Fehler.')
    process.exit(1)
  }
  console.log('finance learning e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
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
      export { buildAIImportPlan, buildAIApplyPayload, applyRowEdit } from './src/lib/finance/ai/plan.js'
      export { buildAIContextPrompt } from './src/lib/finance/ai/prompt.js'
      export { memoryKey, promptMemories, memoryGroups } from './src/lib/finance/ai/memories.js'
    `,
    resolveDir: process.cwd(),
    sourcefile: 'learningE2E.mjs',
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
const modulePath = `${process.env.SCRATCH || '/tmp'}/financeLearningE2E.bundled.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const {
  buildAIImportPlan, buildAIApplyPayload, applyRowEdit, buildAIContextPrompt,
  memoryKey, promptMemories, memoryGroups,
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

const dir = mkdtempSync(join(tmpdir(), 'mw-learn-e2e-'))
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
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) psql(['-f', join('supabase/migrations', file)])
  ok('alle Migrationen inklusive 0012 laufen durch', files.includes('0012_finance_ai_learning.sql'))

  // Zweimal einspielen: eine additive Migration muss idempotent sein.
  psql(['-f', join('supabase/migrations', '0012_finance_ai_learning.sql')])
  ok('0012 lässt sich zweimal einspielen', true)

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
  const callRpc = (owner, sql) => {
    const out = asUser(owner, `select ${sql};`)
    const line = out.trim().split('\n').filter(Boolean).pop()
    return JSON.parse(line)
  }

  const userId = '11111111-2222-4333-8444-555555555555'
  const otherUser = '99999999-2222-4333-8444-555555555555'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'lernen@mindwhiteboard.test')`])
  psql(['-c', `insert into auth.users (id, email) values ('${otherUser}', 'fremd@mindwhiteboard.test')`])

  const giro = jsonAsUser(
    userId,
    `insert into public.finance_accounts (user_id, name, provider, currency)
     values ('${userId}', 'Girokonto', null, 'EUR') returning id`
  )[0].id

  const categories = jsonAsUser(
    userId,
    `select id, slug, label, sort_order from public.finance_categories
     where user_id = '${userId}' order by sort_order`
  )
  const lebensmittel = categories.find((c) => c.slug === 'lebensmittel')
  const restaurant = categories.find((c) => c.slug === 'restaurant')
  const sonstige = categories.find((c) => c.slug === 'sonstige')

  // ── Werkzeug: ein Import, eine Zeile, eine Entscheidung ───────────────────
  let block = 0
  const openImport = (accountId) => {
    block += 1
    return jsonAsUser(
      userId,
      `insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash, status)
       values ('${userId}', '${accountId}', 'ai', 'KI-Import', 'hash-${block}', 'parsed') returning id`
    )[0].id
  }

  const planFor = (entry) =>
    buildAIImportPlan({
      entries: [{
        index: 1,
        bookingDate: entry.date ?? '2026-09-18',
        amountMinor: entry.amountMinor ?? -2495,
        currency: 'EUR',
        rawDescription: entry.description,
        normalizedTokens: entry.tokens ?? entry.description.toUpperCase().split(/[^A-Z0-9ÄÖÜ]+/i).filter(Boolean),
        merchantName: entry.suggestedMerchant ?? null,
        categoryId: entry.suggestedCategory ?? null,
        categorySlug: null,
        transactionType: entry.suggestedType ?? 'purchase',
        includeInAnalytics: entry.suggestedInclude ?? true,
        note: null,
        needsReview: true,
        reviewReasons: ['model_unsure'],
      }],
      existing: [],
      observations: [],
      accountId: giro,
    }).rows

  const applyAi = (owner, id, accountId, bookings) =>
    callRpc(
      owner,
      `public.finance_apply_ai_import('${id}'::uuid, '${accountId}'::uuid, $json$${JSON.stringify(bookings)}$json$::jsonb)`
    )

  // Ein ganzer Durchlauf: Zeile bauen, korrigieren, Umfang wählen, anwenden.
  const importWith = (entry, patch, mode, owner = userId) => {
    const rows = planFor(entry).map((row) => applyRowEdit(row, { ...patch, learningMode: mode }))
    const id = openImport(giro)
    const payload = buildAIApplyPayload({ importId: id, accountId: giro, rows })
    return { id, payload, result: applyAi(owner, id, giro, payload.bookings), rows }
  }

  const memories = () =>
    jsonAsUser(
      userId,
      `select id, kind, merchant_name, merchant_key, category_id, transaction_type,
              include_in_analytics, source_description, source_transaction_id,
              source_suggestion_id, suggested_merchant_name, suggested_category_id,
              suggested_transaction_type, suggested_include_in_analytics, active, example_key
       from public.finance_ai_learning_memories
       where user_id = '${userId}' order by created_at, id`
    )

  // ── 1. Nur diese Buchung ─────────────────────────────────────────────────
  {
    const run = importWith(
      { description: 'REWE TROISDORF SAGT DANKE 8407', suggestedMerchant: 'Troisdorf', suggestedCategory: sonstige.id },
      { merchantName: 'REWE', categoryId: lebensmittel.id },
      'none'
    )
    ok('die Buchung wird gespeichert', run.result.created === 1)
    ok('… die Korrektur steht als Entscheidung daneben', run.result.decisions === 1)
    ok('… und nichts wird gemerkt', run.result.memories === 0 && memories().length === 0)
    ok('… der Vorschlag bleibt trotzdem als korrigiert erkennbar',
       jsonAsUser(userId, `select human_review from public.finance_transaction_ai_suggestions
         where import_id = '${run.id}'`)[0].human_review === 'corrected')
  }

  // ── 2. Ähnliche Buchungen ────────────────────────────────────────────────
  {
    const run = importWith(
      { description: 'REWE TROISDORF SAGT DANKE 8407', suggestedMerchant: 'Troisdorf', suggestedCategory: sonstige.id },
      { merchantName: 'REWE', categoryId: lebensmittel.id },
      'similar'
    )
    ok('ein Beispiel entsteht', run.result.memories === 1)
    const all = memories()
    ok('… genau eines', all.length === 1)
    const example = all[0]
    ok('… als Beispiel', example.kind === 'similar_example')
    ok('… mit dem Originaltext', example.source_description === 'REWE TROISDORF SAGT DANKE 8407')
    ok('… mit dem, was das Modell sagte',
       example.suggested_merchant_name === 'Troisdorf' && example.suggested_category_id === sonstige.id)
    ok('… und mit dem, was der Mensch daraus machte',
       example.merchant_name === 'REWE' && example.category_id === lebensmittel.id)
    ok('… es zeigt auf die Buchung, aus der es stammt', Boolean(example.source_transaction_id))
    ok('… und auf den Vorschlag', Boolean(example.source_suggestion_id))
    ok('… der Vergleichsschlüssel ist der der App',
       example.merchant_key === memoryKey('REWE'))

    // Derselbe Fall ein zweites Mal — als eigener Import, damit es nicht die
    // Wiederholungssperre ist, die ihn abfängt.
    const again = importWith(
      { description: 'REWE TROISDORF SAGT DANKE 8407', suggestedMerchant: 'Troisdorf', suggestedCategory: sonstige.id },
      { merchantName: 'REWE', categoryId: lebensmittel.id },
      'similar'
    )
    ok('derselbe Fall zweimal gemerkt ist einmal gemerkt',
       again.result.memories === 0 && memories().length === 1)

    // Ein anderer Fall ist ein zweites Beispiel.
    const anderer = importWith(
      { description: 'EDEKA MUELLER 1122', suggestedMerchant: 'Mueller', suggestedCategory: sonstige.id },
      { merchantName: 'EDEKA', categoryId: lebensmittel.id },
      'similar'
    )
    ok('ein anderer Fall ist ein zweites Beispiel',
       anderer.result.memories === 1 && memories().length === 2)
  }

  // ── 3. Immer für [Händler] ───────────────────────────────────────────────
  {
    const run = importWith(
      { description: 'REWE CITY KOELN 33', suggestedMerchant: 'Koeln', suggestedCategory: sonstige.id },
      { merchantName: 'REWE', categoryId: lebensmittel.id },
      'merchant_rule'
    )
    ok('eine feste Regel entsteht', run.result.memories === 1)
    const rule = memories().find((m) => m.kind === 'merchant_rule')
    ok('… für den korrigierten Händler', rule.merchant_name === 'REWE')
    ok('… mit der Kategorie der Entscheidung', rule.category_id === lebensmittel.id)
    ok('… und ohne Buchungsart, weil sie nicht abwich', rule.transaction_type === null)
    ok('… und ohne Auswertungsangabe, weil sie nicht abwich',
       rule.include_in_analytics === null)

    // Dieselbe Regel, andere Meinung: ersetzen statt verdoppeln.
    const geaendert = importWith(
      { description: 'REWE TO GO BONN', suggestedMerchant: 'Bonn', suggestedCategory: sonstige.id },
      { merchantName: 'rewe', categoryId: restaurant.id },
      'merchant_rule'
    )
    const rules = memories().filter((m) => m.kind === 'merchant_rule' && m.active)
    ok('eine geänderte Meinung ersetzt die Regel', rules.length === 1)
    ok('… mit der neuen Kategorie', rules[0].category_id === restaurant.id)
    ok('… unter demselben Schlüssel', rules[0].merchant_key === memoryKey('REWE'))
    ok('… und die Funktion zählt sie als eine', geaendert.result.memories === 1)

    // Ein anderer Händler ist eine zweite Regel.
    const zweiter = importWith(
      { description: 'ALDI SUED 9', suggestedMerchant: null, suggestedCategory: sonstige.id },
      { merchantName: 'ALDI', categoryId: lebensmittel.id },
      'merchant_rule'
    )
    ok('ein anderer Händler bekommt seine eigene Regel',
       zweiter.result.memories === 1 &&
       memories().filter((m) => m.kind === 'merchant_rule' && m.active).length === 2)
  }

  // ── 4. Zahlungsdienstleister ─────────────────────────────────────────────
  {
    const run = importWith(
      { description: 'PAYPAL .Zalando SE 4711', suggestedMerchant: 'PayPal', suggestedCategory: sonstige.id },
      { merchantName: 'PayPal', categoryId: null },
      'payment_provider'
    )
    ok('ein Dienstleister wird gemerkt', run.result.memories === 1)
    const provider = memories().find((m) => m.kind === 'payment_provider' && m.active)
    ok('… mit dem Namen', provider.merchant_name === 'PayPal')
    ok('… und ausdrücklich ohne Kategorie',
       provider.category_id === null && provider.transaction_type === null &&
       provider.include_in_analytics === null)

    // Widerspruch: erst Dienstleister, dann feste Regel für denselben Namen.
    const regel = importWith(
      { description: 'PAYPAL EUROPE 99', suggestedMerchant: 'Paypal', suggestedCategory: sonstige.id },
      { merchantName: 'PayPal', categoryId: restaurant.id },
      'merchant_rule'
    )
    const nachRegel = memories().filter((m) => m.active && m.merchant_key === memoryKey('PayPal'))
    ok('eine feste Regel verdrängt den Dienstleister',
       nachRegel.length === 1 && nachRegel[0].kind === 'merchant_rule')
    ok('… und die alte Zeile bleibt als deaktivierte lesbar',
       memories().some((m) => m.kind === 'payment_provider' && m.active === false))
    ok('… die Funktion zählt auch das als eine Erinnerung', regel.result.memories === 1)

    // Und zurück.
    const wieder = importWith(
      { description: 'PAYPAL .About You', suggestedMerchant: 'Paypal', suggestedCategory: sonstige.id },
      { merchantName: 'PayPal', categoryId: null },
      'payment_provider'
    )
    const nachProvider = memories().filter((m) => m.active && m.merchant_key === memoryKey('PayPal'))
    ok('… und umgekehrt genauso',
       wieder.result.memories === 1 && nachProvider.length === 1 &&
       nachProvider[0].kind === 'payment_provider')
    ok('zwei unvereinbare Wahrheiten sind nie gleichzeitig aktiv',
       jsonAsUser(userId, `select merchant_key from public.finance_ai_learning_memories
         where user_id = '${userId}' and active and kind in ('merchant_rule','payment_provider')
         group by merchant_key having count(*) > 1`).length === 0)
  }

  // ── 5. Was die Datenbank nicht mitmacht ──────────────────────────────────
  {
    const bookingWith = (learning, extra = {}) => {
      const rows = planFor({
        description: 'TESTZEILE 1', suggestedMerchant: 'Vorschlag', suggestedCategory: sonstige.id,
      }).map((row) => applyRowEdit(row, extra))
      const payload = buildAIApplyPayload({
        importId: '00000000-0000-4000-8000-000000000000', accountId: giro, rows,
      })
      const booking = payload.bookings[0]
      booking.learning = learning
      return booking
    }
    const tryApply = (booking) => {
      const id = openImport(giro)
      return failsAsUser(
        userId,
        `select public.finance_apply_ai_import('${id}'::uuid, '${giro}'::uuid,
           $json$${JSON.stringify([booking])}$json$::jsonb);`
      )
    }

    ok('eine Händlerregel ohne Händler wird verweigert',
       tryApply(bookingWith({ mode: 'merchant_rule' }, { categoryId: lebensmittel.id, merchantName: '' })))
    ok('ein Dienstleister ohne Händler wird verweigert',
       tryApply(bookingWith({ mode: 'payment_provider' }, { merchantName: '', categoryId: lebensmittel.id })))
    ok('eine Händlerregel, die nichts aussagt, wird verweigert',
       tryApply(bookingWith({ mode: 'merchant_rule' },
                            { merchantName: 'Neuer Name', categoryId: null })))
    ok('ein unbekannter Umfang wird verweigert',
       tryApply(bookingWith({ mode: 'irgendwas' }, { merchantName: 'REWE', categoryId: lebensmittel.id })))

    // Eine Bestätigung ist keine Korrektur — und darf deshalb nichts merken,
    // auch wenn jemand am Client vorbei genau das schickt.
    const bestaetigt = bookingWith({ mode: 'merchant_rule' }, {})
    bestaetigt.suggestion.human_review = 'confirmed'
    bestaetigt.user_decision = {
      merchant_id: null, merchant_name: 'Vorschlag', category_id: sonstige.id,
      transaction_type: 'purchase', include_in_analytics: true, note: null,
    }
    ok('aus einer Bestätigung wird auch von Hand keine Regel', tryApply(bestaetigt))

    const unberuehrt = bookingWith({ mode: 'similar' }, {})
    unberuehrt.suggestion.human_review = 'none'
    ok('aus einer unberührten Zeile erst recht nicht', tryApply(unberuehrt))
  }

  // ── 5b. „Korrigiert" ist nicht „lernbar" ─────────────────────────────────
  //
  // Eine geänderte Notiz macht eine Zeile zurecht zu `corrected`. Lernen lässt
  // sich daraus nichts — und die Datenbank prüft das selbst, statt sich auf den
  // Client zu verlassen.
  {
    const nurNotiz = (mode) => {
      const rows = planFor({
        description: 'RESTAURANT ZUM LOEWEN 12', suggestedMerchant: 'Zum Loewen',
        suggestedCategory: restaurant.id,
      }).map((row) => applyRowEdit(row, { note: 'Geschäftsessen' }))
      const id = openImport(giro)
      const payload = buildAIApplyPayload({ importId: id, accountId: giro, rows })
      const booking = payload.bookings[0]
      // Der Client schickt hier von sich aus schon 'none' — für den Test wird
      // der Umfang von Hand gesetzt, also genau das, was ein manipulierter
      // Aufruf täte.
      booking.learning = { mode }
      return { id, booking }
    }

    const geschickt = nurNotiz('none')
    ok('der Client schickt bei einer reinen Notizänderung von sich aus nichts',
       buildAIApplyPayload({
         importId: geschickt.id, accountId: giro,
         rows: planFor({
           description: 'RESTAURANT ZUM LOEWEN 12', suggestedMerchant: 'Zum Loewen',
           suggestedCategory: restaurant.id,
         }).map((row) => applyRowEdit(row, { note: 'Geschäftsessen' })),
       }).bookings[0].learning.mode === 'none')

    const vorher = memories().length
    const ohne = applyAi(userId, geschickt.id, giro, [geschickt.booking])
    ok('… die Buchung wird trotzdem gespeichert', ohne.created === 1)
    ok('… die Notiz auch',
       jsonAsUser(userId, `select note from public.finance_transaction_overrides
         where transaction_id = (select id from public.finance_transactions
           where import_id = '${geschickt.id}')`)[0].note === 'Geschäftsessen')
    ok('… die Zeile gilt als korrigiert',
       jsonAsUser(userId, `select human_review from public.finance_transaction_ai_suggestions
         where import_id = '${geschickt.id}'`)[0].human_review === 'corrected')
    ok('… und es entsteht keine Erinnerung',
       ohne.memories === 0 && memories().length === vorher)

    for (const mode of ['similar', 'merchant_rule', 'payment_provider']) {
      const manipuliert = nurNotiz(mode)
      ok(`ein von Hand gesetzter Umfang „${mode}" wird bei reiner Notizänderung abgelehnt`,
         failsAsUser(userId, `select public.finance_apply_ai_import('${manipuliert.id}'::uuid,
           '${giro}'::uuid, $json$${JSON.stringify([manipuliert.booking])}$json$::jsonb);`))
    }
    ok('… und nichts davon hat etwas hinterlassen', memories().length === vorher)

    // Ein Merk-Wunsch ganz ohne Entscheidung behauptet eine Korrektur, die
    // nirgends steht.
    const ohneEntscheidung = nurNotiz('similar')
    ohneEntscheidung.booking.user_decision = null
    ok('ein Merk-Wunsch ohne Nutzerentscheidung wird abgelehnt',
       failsAsUser(userId, `select public.finance_apply_ai_import('${ohneEntscheidung.id}'::uuid,
         '${giro}'::uuid, $json$${JSON.stringify([ohneEntscheidung.booking])}$json$::jsonb);`))

    // F) Notiz UND Kategorie: lernbar wegen der Kategorie — und die Notiz
    // trotzdem nirgends in der Erinnerung.
    const beides = importWith(
      { description: 'CAFE CENTRAL 9', suggestedMerchant: 'Central', suggestedCategory: sonstige.id },
      { merchantName: 'Café Central', categoryId: restaurant.id, note: 'Geschäftsessen' },
      'merchant_rule'
    )
    ok('F: Notiz plus Kategorie ist lernbar', beides.result.memories === 1)
    const regel = memories().find((m) => m.active && m.merchant_key === memoryKey('Café Central'))
    ok('F: … die Regel trägt die Kategorie', regel.category_id === restaurant.id)
    ok('F: … und nirgends die Notiz', JSON.stringify(regel).indexOf('Geschäftsessen') === -1)
    ok('F: … die Notiz steht bei der Buchung',
       jsonAsUser(userId, `select note from public.finance_transaction_overrides
         where transaction_id = '${regel.source_transaction_id}'`)[0].note === 'Geschäftsessen')

    // D) und E): eine Abweichung allein trägt die Lernberechtigung.
    const nurArt = importWith(
      { description: 'RUECKZAHLUNG STROM 4', suggestedMerchant: 'Stadtwerke',
        suggestedCategory: sonstige.id, suggestedType: 'purchase' },
      { merchantName: 'Stadtwerke', categoryId: sonstige.id, transactionType: 'refund' },
      'merchant_rule'
    )
    ok('D: eine reine Art-Korrektur ist lernbar', nurArt.result.memories === 1)
    const artRegel = memories().find((m) => m.active && m.merchant_key === memoryKey('Stadtwerke'))
    ok('D: … und wird gelernt', artRegel.transaction_type === 'refund')
  }

  // ── 6. Was nie gelernt wird ──────────────────────────────────────────────
  {
    const vorher = memories().length
    const mitNotiz = importWith(
      { description: 'BAECKEREI SCHMIDT 5', suggestedMerchant: 'Schmidt', suggestedCategory: sonstige.id },
      { merchantName: 'Bäckerei Schmidt', categoryId: lebensmittel.id, note: 'Für die Steuer aufheben' },
      'merchant_rule'
    )
    ok('die Notiz wird gespeichert',
       jsonAsUser(userId, `select note from public.finance_transaction_overrides
         where transaction_id = (select source_transaction_id from public.finance_ai_learning_memories
           where merchant_key = '${memoryKey('Bäckerei Schmidt')}' and active)`)[0].note ===
       'Für die Steuer aufheben')
    const regel = memories().find((m) => m.active && m.merchant_key === memoryKey('Bäckerei Schmidt'))
    ok('… steht aber in keiner Erinnerung',
       JSON.stringify(regel).indexOf('Steuer') === -1)
    ok('… und die Regel entsteht trotzdem', mitNotiz.result.memories === 1 &&
       memories().length === vorher + 1)

    // Buchungsart und Auswertung nur bei echter Abweichung.
    const abweichung = importWith(
      { description: 'SCALABLE CAPITAL SPARPLAN', suggestedMerchant: 'Scalable', suggestedCategory: sonstige.id,
        suggestedType: 'purchase', suggestedInclude: true },
      { merchantName: 'Scalable Capital', categoryId: null, transactionType: 'transfer',
        includeInAnalytics: false },
      'merchant_rule'
    )
    const sparplan = memories().find((m) => m.active && m.merchant_key === memoryKey('Scalable Capital'))
    ok('eine abweichende Buchungsart wird gelernt', sparplan.transaction_type === 'transfer')
    ok('… und ein abweichendes „zählt nicht" auch', sparplan.include_in_analytics === false)
    ok('… und eine Regel ohne Kategorie ist dann erlaubt',
       sparplan.category_id === null && abweichung.result.memories === 1)

    const ohneAbweichung = importWith(
      { description: 'DM DROGERIE 77', suggestedMerchant: 'Drogerie', suggestedCategory: sonstige.id,
        suggestedType: 'purchase', suggestedInclude: true },
      { merchantName: 'dm', categoryId: lebensmittel.id, transactionType: 'purchase',
        includeInAnalytics: true },
      'merchant_rule'
    )
    const dm = memories().find((m) => m.active && m.merchant_key === memoryKey('dm'))
    ok('was nicht abweicht, wird nicht gelernt',
       dm.transaction_type === null && dm.include_in_analytics === null)
    ok('… die Kategorie schon', dm.category_id === lebensmittel.id &&
       ohneAbweichung.result.memories === 1)
  }

  // ── 7. Wiederholung ──────────────────────────────────────────────────────
  {
    const rows = planFor({
      description: 'ROSSMANN 4711', suggestedMerchant: 'Rossmann Filiale', suggestedCategory: sonstige.id,
    }).map((row) => applyRowEdit(row, {
      merchantName: 'Rossmann', categoryId: lebensmittel.id, learningMode: 'merchant_rule',
    }))
    const id = openImport(giro)
    const payload = buildAIApplyPayload({ importId: id, accountId: giro, rows })
    const first = applyAi(userId, id, giro, payload.bookings)
    const vorher = memories().length
    const second = applyAi(userId, id, giro, payload.bookings)
    ok('derselbe Import ein zweites Mal ist eine Wiederholung', second.replayed === true)
    ok('… und legt keine zweite Erinnerung an', memories().length === vorher)
    ok('… und keine zweite Buchung',
       jsonAsUser(userId, `select id from public.finance_transactions where import_id = '${id}'`).length ===
       first.created)
  }

  // ── 8. Der Prompt liest das Gedächtnis ───────────────────────────────────
  {
    const stored = memories()
    const prompt = buildAIContextPrompt({ categories, memories: stored, accountName: 'Girokonto' })
    const regel = stored.find((m) => m.active && m.kind === 'merchant_rule' && m.merchant_name === 'ALDI')
    ok('eine gespeicherte Regel steht im Prompt',
       prompt.indexOf('ALDI: Wenn du ALDI als Händler erkennst') > -1)
    ok('… mit dem Slug der Kategorie, nicht ihrer Id',
       prompt.indexOf('Kategorie = lebensmittel') > -1 && prompt.indexOf(regel.category_id) === -1)
    ok('ein gespeicherter Dienstleister steht im Prompt',
       prompt.indexOf('PayPal: nicht zwingend der Händler') > -1)
    ok('ein gespeichertes Beispiel steht im Prompt',
       prompt.indexOf('Original: REWE TROISDORF SAGT DANKE 8407') > -1)
    ok('… mit beiden Seiten',
       prompt.indexOf('Du hattest: Händler Troisdorf, Kategorie sonstige') > -1 &&
       prompt.indexOf('Richtig ist: Händler REWE, Kategorie lebensmittel') > -1)

    // Deaktivieren — der Weg, den das Sheet geht.
    const aldi = regel.id
    jsonAsUser(userId, `update public.finance_ai_learning_memories
      set active = false, updated_at = now() where id = '${aldi}' returning id`)
    const ohne = buildAIContextPrompt({ categories, memories: memories(), accountName: 'Girokonto' })
    ok('eine deaktivierte Regel verschwindet sofort aus dem Kontext',
       ohne.indexOf('ALDI: Wenn du ALDI als Händler erkennst') === -1)
    ok('… und die anderen bleiben', ohne.indexOf('PayPal: nicht zwingend der Händler') > -1)

    jsonAsUser(userId, `update public.finance_ai_learning_memories
      set active = true, updated_at = now() where id = '${aldi}' returning id`)
    const zurueck = buildAIContextPrompt({ categories, memories: memories(), accountName: 'Girokonto' })
    ok('Rückgängig bringt sie zurück',
       zurueck.indexOf('ALDI: Wenn du ALDI als Händler erkennst') > -1)

    // Die Liste, die der Nutzer sieht, zeigt dasselbe.
    const groups = memoryGroups(memories(), categories)
    ok('die Liste gruppiert, was der Prompt sagt',
       groups.map((g) => g.title).join('|') === 'Feste Regeln|Zahlungsdienstleister|Beispiele')
    ok('… und zählt nur aktive',
       groups.reduce((n, g) => n + g.items.length, 0) ===
       memories().filter((m) => m.active).length)
    ok('der Prompt-Topf und die Datenbank sind sich einig',
       promptMemories(memories()).rules.length ===
       memories().filter((m) => m.active && m.kind === 'merchant_rule').length)
  }

  // ── 9. Fremde Erinnerungen ───────────────────────────────────────────────
  {
    ok('ein fremder Nutzer sieht keine Erinnerung',
       jsonAsUser(otherUser, `select id from public.finance_ai_learning_memories`).length === 0)
    const mine = memories()[0]
    ok('… kann keine deaktivieren',
       jsonAsUser(otherUser, `update public.finance_ai_learning_memories
         set active = false where id = '${mine.id}' returning id`).length === 0)
    ok('… und sie ist noch aktiv',
       memories().find((m) => m.id === mine.id).active === true)
    ok('… kann keine löschen',
       jsonAsUser(otherUser, `delete from public.finance_ai_learning_memories
         where id = '${mine.id}' returning id`).length === 0)
    ok('… und keine auf meinen Namen anlegen',
       failsAsUser(otherUser, `insert into public.finance_ai_learning_memories
         (user_id, kind, merchant_name, merchant_key, category_id)
         values ('${userId}', 'merchant_rule', 'Fremd', 'FREMD', null);`))

    // anon: kein Recht, nicht einmal ein leises.
    ok('anon darf die Tabelle nicht lesen',
       psql(['-t', '-A', '-c',
         `select has_table_privilege('anon', 'public.finance_ai_learning_memories', 'SELECT')`
       ]).trim() === 'f')
    ok('anon darf nicht schreiben',
       psql(['-t', '-A', '-c',
         `select has_table_privilege('anon', 'public.finance_ai_learning_memories', 'INSERT')
             or has_table_privilege('anon', 'public.finance_ai_learning_memories', 'UPDATE')`
       ]).trim() === 'f')
    ok('authenticated darf lesen, schreiben, ändern und löschen',
       psql(['-t', '-A', '-c',
         `select has_table_privilege('authenticated', 'public.finance_ai_learning_memories', 'SELECT')
             and has_table_privilege('authenticated', 'public.finance_ai_learning_memories', 'INSERT')
             and has_table_privilege('authenticated', 'public.finance_ai_learning_memories', 'UPDATE')
             and has_table_privilege('authenticated', 'public.finance_ai_learning_memories', 'DELETE')`
       ]).trim() === 't')
    ok('RLS ist eingeschaltet',
       psql(['-t', '-A', '-c',
         `select relrowsecurity from pg_class where oid = 'public.finance_ai_learning_memories'::regclass`
       ]).trim() === 't')
  }

  // ── 10. Der Schlüssel ist derselbe wie in der App ────────────────────────
  {
    const cases = ['REWE', 'rewe', 'Rewe  Markt!', ' rewe-markt ', 'Bäckerei Müller', 'Aral 4711']
    for (const name of cases) {
      const db = psql(['-t', '-A', '-c',
        `select coalesce(public.finance_memory_key($k$${name}$k$), '')`
      ]).trim()
      ok(`der Schlüssel von „${name}" ist in App und Datenbank derselbe`,
         db === (memoryKey(name) ?? ''))
    }
  }

  // ── 11. Die alte Engine bleibt unberührt ─────────────────────────────────
  {
    ok('aus keiner Korrektur ist ein Händler geworden',
       jsonAsUser(userId, `select id from public.finance_merchants where user_id = '${userId}'`).length === 0)
    ok('… und kein Muster',
       jsonAsUser(userId, `select id from public.finance_merchant_patterns where user_id = '${userId}'`).length === 0)
    ok('… und keine Kategorieregel',
       jsonAsUser(userId, `select id from public.finance_category_rules where user_id = '${userId}'`).length === 0)
  }
} finally {
  if (started) {
    try {
      pg(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'])
    } catch {
      // Der Server ist gleich ohnehin weg.
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(`finance learning e2e: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
