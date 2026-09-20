// „Zählt diese Buchung?" — and the two writes that answer it.
//
// Three modules meet here and none of them may disagree: resolveAnalyticsInclusion
// decides, financeRepository.saveOverride persists a decision about one booking
// without losing the ones made before it, and setMerchantAnalyticsDefault
// persists a decision about a merchant. The SQL half of the same rule lives in
// 0010 and is checked against this one in tools/financeAnalyticsE2E.mjs.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
import { SUPABASE_URL, SUPABASE_ANON_KEY, installRealtimeStub } from './supabaseStub.mjs'

const TEST = `
import { analyticsInclusion, analyticsTransactions, excludedMerchants, resolveAnalyticsInclusion }
  from './src/lib/finance/analytics/index.js'
import { matchMerchant, FINANCE_STATUS } from './src/lib/finance/merchantMatching.js'
import { MAX_NOTE_LENGTH, compactPreview, describeSaveOutcome, normalizeNote, noteIsValid,
         shortDescription, DECISION } from './src/lib/finance/classificationFlow.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { financeRepository } from './src/data/financeRepository.js'
import { makeBackend } from './tools/supabaseStub.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')
const USER = '11111111-2222-4333-8444-555555555555'

let seq = 0
const booking = (raw, over = {}) => {
  seq += 1
  return {
    id: uuid(seq), account_id: uuid(2), booking_date: '2026-09-01', amount_minor: -1234,
    currency: 'EUR', raw_description: raw, normalized_tokens: tokenize(raw),
    manual_lock: false, merchant_id: null, category_id: null, include_in_analytics: true,
    ...over,
  }
}
const merchant = (id, name, over = {}) => ({
  id, canonical_name: name, review_mode: 'auto', default_include_in_analytics: true, ...over,
})
const pattern = (id, merchantId, tokens) => ({
  id, merchant_id: merchantId, pattern_type: tokens.length === 1 ? 'exact_token' : 'exact_phrase',
  tokens, active: true,
})

// ── 1. The four steps, in order ────────────────────────────────────────────
{
  const tx = booking('REWE TROISDORF')
  ok('a booking nobody has an opinion about counts',
     resolveAnalyticsInclusion({ transaction: { ...tx, include_in_analytics: undefined } }) === true)
  ok('…and so does one the import marked as counting',
     resolveAnalyticsInclusion({ transaction: tx }) === true)
  ok('what the import wrote is honoured when nothing else speaks',
     resolveAnalyticsInclusion({ transaction: { ...tx, include_in_analytics: false } }) === false)

  const M = uuid(50)
  const merchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })]
  const patterns = [pattern(uuid(300), M, ['SCALABLE'])]
  const scalable = booking('Scalable Capital Verrechnungskonto')
  const match = matchMerchant({ transaction: scalable, patterns, merchants })

  ok('a merchant default beats what the import wrote',
     resolveAnalyticsInclusion({ transaction: scalable, merchantMatch: match, merchants }) === false)
  ok('…and an override about this booking beats the merchant',
     resolveAnalyticsInclusion({
       transaction: scalable, override: { include_in_analytics: true }, merchantMatch: match, merchants,
     }) === true)
  ok('the other direction too: override false over merchant true',
     resolveAnalyticsInclusion({
       transaction: booking('REWE'), override: { include_in_analytics: false },
       merchantMatch: matchMerchant({ transaction: booking('REWE'), patterns: [pattern(uuid(301), uuid(51), ['REWE'])], merchants: [merchant(uuid(51), 'REWE')] }),
       merchants: [merchant(uuid(51), 'REWE')],
     }) === false)
  ok('a transaction marked false stays false without any rule about it',
     resolveAnalyticsInclusion({ transaction: booking('Irgendwas', { include_in_analytics: false }) }) === false)

  // The reason travels with the answer.
  ok('the source is named: override',
     analyticsInclusion({ transaction: scalable, override: { include_in_analytics: true } }).source === 'override')
  ok('…merchant',
     analyticsInclusion({ transaction: scalable, merchantMatch: match, merchants }).source === 'merchant')
  ok('…transaction',
     analyticsInclusion({ transaction: { ...tx, include_in_analytics: false } }).source === 'transaction')
  ok('…and the safe default',
     analyticsInclusion({ transaction: { ...tx, include_in_analytics: undefined } }).source === 'default')
  // An override that says nothing about analytics is not an opinion about it.
  ok('an override without the field does not count as a decision',
     analyticsInclusion({
       transaction: scalable, override: { note: 'nur eine Notiz' }, merchantMatch: match, merchants,
     }).source === 'merchant')
}

// ── 2. The engine decides which merchant, not the column ───────────────────
{
  const M = uuid(60)
  const merchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })]
  const patterns = [pattern(uuid(310), M, ['SCALABLE'])]

  // Imported before the merchant existed: no merchant_id on the row at all.
  const future = booking('Scalable Capital Verrechnungskonto 2027')
  ok('a freshly imported booking carries no merchant id', future.merchant_id === null)
  ok('…and still follows the merchant default',
     resolveAnalyticsInclusion({
       transaction: future, merchantMatch: matchMerchant({ transaction: future, patterns, merchants }), merchants,
     }) === false)

  // A booking stamped with a merchant id whose pattern no longer matches must
  // not inherit that merchant's default — the engine is the authority.
  const stale = booking('REWE TROISDORF', { merchant_id: M })
  ok('a stale merchant_id does not drag the default along',
     resolveAnalyticsInclusion({
       transaction: stale, merchantMatch: matchMerchant({ transaction: stale, patterns, merchants }), merchants,
     }) === true)

  // A conflict has no single merchant, so it has no default to inherit.
  const A = uuid(61), B = uuid(62)
  const two = [merchant(A, 'Edeka', { default_include_in_analytics: false }), merchant(B, 'Nahkauf')]
  const twoPatterns = [pattern(uuid(311), A, ['EDEKA']), pattern(uuid(312), B, ['MARKT'])]
  const clash = booking('EDEKA MARKT Bonn')
  const clashMatch = matchMerchant({ transaction: clash, patterns: twoPatterns, merchants: two })
  ok('a conflicted booking is a conflict', clashMatch.status === FINANCE_STATUS.CONFLICT)
  ok('…and inherits no merchant default',
     resolveAnalyticsInclusion({ transaction: clash, merchantMatch: clashMatch, merchants: two }) === true)
  ok('…while its own override still decides it',
     resolveAnalyticsInclusion({
       transaction: clash, override: { include_in_analytics: false }, merchantMatch: clashMatch, merchants: two,
     }) === false)

  // Another merchant is unaffected.
  const rewe = uuid(63)
  const mixed = [...merchants, merchant(rewe, 'REWE')]
  const mixedPatterns = [...patterns, pattern(uuid(313), rewe, ['REWE'])]
  const groceries = booking('REWE TROISDORF SAGT DANKE')
  ok('a different merchant keeps counting',
     resolveAnalyticsInclusion({
       transaction: groceries,
       merchantMatch: matchMerchant({ transaction: groceries, patterns: mixedPatterns, merchants: mixed }),
       merchants: mixed,
     }) === true)
}

// ── 3. What a total is allowed to add up ───────────────────────────────────
{
  const M = uuid(70)
  const merchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })]
  const patterns = [pattern(uuid(320), M, ['SCALABLE'])]
  const rows = [
    booking('REWE TROISDORF'),
    booking('Scalable Capital Verrechnungskonto'),
    booking('Scalable Capital Sparplan'),
    booking('ALDI SUED', { include_in_analytics: false }),
    booking('EDEKA Bonn'),
  ]
  const overrides = [{ transaction_id: rows[2].id, include_in_analytics: true }]

  const counted = analyticsTransactions({ transactions: rows, overrides, patterns, merchants })
  ok('the merchant default removes its bookings from a total',
     !counted.some((t) => t.id === rows[1].id))
  ok('…but an override brings one back',
     counted.some((t) => t.id === rows[2].id))
  ok('a booking the import excluded stays out', !counted.some((t) => t.id === rows[3].id))
  ok('everything else counts', counted.length === 3)
  // „Nicht berücksichtigen" is never „gelöscht".
  ok('nothing was removed from the data', rows.length === 5)
  ok('…and no row was modified',
     rows.every((r) => typeof r.raw_description === 'string' && r.raw_description.length > 0))
}

// ── 4. A note ──────────────────────────────────────────────────────────────
{
  ok('a note is trimmed', normalizeNote('  Geburtstag Mama  ') === 'Geburtstag Mama')
  ok('empty means none', normalizeNote('   ') === null)
  ok('…as does nothing at all', normalizeNote(undefined) === null && normalizeNote(null) === null)
  ok('500 characters are allowed',
     normalizeNote('x'.repeat(MAX_NOTE_LENGTH)).length === MAX_NOTE_LENGTH)
  ok('…and one more is cut rather than refused by the database',
     normalizeNote('x'.repeat(MAX_NOTE_LENGTH + 40)).length === MAX_NOTE_LENGTH)
  ok('the cap matches the column', MAX_NOTE_LENGTH === 500)
  ok('a note at the cap is valid', noteIsValid('x'.repeat(MAX_NOTE_LENGTH)))
  ok('…and a longer one is not', !noteIsValid('x'.repeat(MAX_NOTE_LENGTH + 1)))
  ok('no note is valid', noteIsValid(null))
}

// ── 5. Saving a note may not drop what was decided before ──────────────────
{
  const TX = uuid(80)
  const MERCHANT = uuid(81)
  const CATEGORY = uuid(82)
  const backend = makeBackend({
    finance: {
      finance_transaction_overrides: [{
        id: uuid(83), user_id: USER, transaction_id: TX,
        merchant_id: MERCHANT, category_id: CATEGORY,
        include_in_analytics: false, transaction_type: null, note: null,
      }],
    },
  })
  globalThis.fetch = backend.fetch

  const current = (await financeRepository.listOverrides(USER))[0]
  ok('the existing decision is there',
     current.merchant_id === MERCHANT && current.category_id === CATEGORY &&
     current.include_in_analytics === false)

  // The save the user performs: a note, and nothing else.
  await financeRepository.saveOverride(USER, TX, { note: 'Geburtstag Mama' }, current)

  const body = backend.calls.filter((c) => c.method !== 'GET').pop()?.body
  const sent = Array.isArray(body) ? body[0] : body ?? {}
  ok('the request carries the note', sent.note === 'Geburtstag Mama')
  // THE assertion: the merge happens where it can be read, so the payload is
  // complete whatever the server would have done with a partial one.
  ok('…and the merchant that was decided before', sent.merchant_id === MERCHANT)
  ok('…and the category', sent.category_id === CATEGORY)
  ok('…and the analytics decision', sent.include_in_analytics === false)

  const after = (await financeRepository.listOverrides(USER))[0]
  ok('the stored row still has its merchant', after.merchant_id === MERCHANT)
  ok('…its category', after.category_id === CATEGORY)
  ok('…its analytics decision', after.include_in_analytics === false)
  ok('…and now the note', after.note === 'Geburtstag Mama')

  // Clearing a note is a decision too, and must not clear anything else.
  await financeRepository.saveOverride(USER, TX, { note: null }, after)
  const cleared = (await financeRepository.listOverrides(USER))[0]
  ok('a cleared note is null', cleared.note === null)
  ok('…and the rest survived',
     cleared.merchant_id === MERCHANT && cleared.include_in_analytics === false)

  // And the reverse: deciding analytics must not drop the note.
  await financeRepository.saveOverride(USER, TX, { note: 'wieder da' }, cleared)
  const withNote = (await financeRepository.listOverrides(USER))[0]
  await financeRepository.saveOverride(USER, TX, { include_in_analytics: true }, withNote)
  const final = (await financeRepository.listOverrides(USER))[0]
  ok('deciding analytics keeps the note', final.note === 'wieder da')
  ok('…and applies the decision', final.include_in_analytics === true)

  // A first-ever override writes only what was decided.
  const FRESH = uuid(90)
  await financeRepository.saveOverride(USER, FRESH, { note: 'erste Notiz' }, null)
  const fresh = (await financeRepository.listOverrides(USER)).find((o) => o.transaction_id === FRESH)
  ok('a booking without an override gets one', fresh?.note === 'erste Notiz')
  ok('…and nothing is invented for it',
     fresh.merchant_id === undefined || fresh.merchant_id === null)
}

// ── 6. The merchant switch touches one column ──────────────────────────────
{
  const M = uuid(95)
  const backend = makeBackend({
    finance: {
      finance_merchants: [{
        id: M, user_id: USER, canonical_name: 'Scalable Capital',
        review_mode: 'auto', default_include_in_analytics: true,
      }],
    },
  })
  globalThis.fetch = backend.fetch

  await financeRepository.setMerchantAnalyticsDefault(USER, M, false)
  const row = (await financeRepository.listMerchants(USER))[0]
  ok('the merchant no longer counts', row.default_include_in_analytics === false)
  ok('…its name is untouched', row.canonical_name === 'Scalable Capital')
  ok('…and so is its review mode', row.review_mode === 'auto')

  const sent = backend.calls.filter((c) => c.method === 'PATCH').pop()?.body
  const patch = Array.isArray(sent) ? sent[0] : sent
  ok('only the one column and a timestamp are written',
     Object.keys(patch).sort().join(',') === 'default_include_in_analytics,updated_at')

  // Reversible, always.
  await financeRepository.setMerchantAnalyticsDefault(USER, M, true)
  ok('it can be switched back',
     (await financeRepository.listMerchants(USER))[0].default_include_in_analytics === true)

  let refused = null
  try { await financeRepository.setMerchantAnalyticsDefault(USER, M, 'vielleicht') }
  catch (e) { refused = e.message }
  ok('anything that is not true or false is refused', refused !== null)
}

// ── 7. The compact screen says the same thing in less room ─────────────────
{
  const numbers = { treffer: 5, weitere: 4, gesamt: 5, aktuelleAendertSich: true, unveraendert: 0 }
  ok('the one-line preview names merchant, category and count',
     compactPreview({ numbers, patternLabel: 'REWE', merchantName: 'REWE', categoryName: 'Lebensmittel' })
       === 'REWE · Lebensmittel · 5 Umsätze')
  const protectedOnes = { ...numbers, gesamt: 2, unveraendert: 3 }
  ok('…and never hides the ones that stay as they are',
     compactPreview({ numbers: protectedOnes, patternLabel: 'REWE', merchantName: 'REWE', categoryName: 'Lebensmittel' })
       .includes('3 Umsätze bleiben unverändert'))
  const none = { ...numbers, gesamt: 0, aktuelleAendertSich: false, unveraendert: 5 }
  ok('a rule that changes nothing says so',
     compactPreview({ numbers: none, patternLabel: 'REWE', merchantName: 'REWE', categoryName: 'Lebensmittel' })
       .includes('die Regel „REWE" wird gespeichert'))

  const long = { raw_description: 'DAUERAUFTRAG ' + 'x'.repeat(200) }
  ok('a long booking text is cut for the header', shortDescription(long).length <= 64)
  ok('…and marked as cut', shortDescription(long).endsWith('…'))
  ok('a multi-line text becomes one line',
     !shortDescription({ raw_description: 'Deutsche Bahn\\nDB.Vertrieb' }).includes('\\n'))
  ok('…without losing the word boundary',
     shortDescription({ raw_description: 'Deutsche Bahn\\nDB.Vertrieb' }) === 'Deutsche Bahn DB.Vertrieb')
}

// ── 8. A sequence that stops halfway says so ───────────────────────────────
{
  const labels = { merchantName: 'REWE', categoryName: 'Lebensmittel' }

  const all = describeSaveOutcome({
    steps: { rule: { applied_count: 4, transaction_updated: true, merchant_created: true }, override: true, merchant: true },
    include: false, labels, kind: DECISION.LEARN,
  })
  ok('a complete save is not partial', all.partial === false && all.failure === null)
  ok('…and reports what the database did', all.lines[0].includes('5 Umsätze sind jetzt'))
  ok('…including the merchant-wide decision',
     all.lines.some((l) => l.includes('zählen künftig nicht mehr')))

  const half = describeSaveOutcome({
    steps: { rule: { applied_count: 4, transaction_updated: true }, override: null, merchant: null },
    include: true, labels, kind: DECISION.LEARN, error: new Error('network'),
  })
  ok('a sequence that stopped halfway is marked partial', half.partial === true)
  ok('…and names what was written', half.failure.includes('Umsätze sind jetzt'))
  ok('…and what was not', half.failure.includes('Notiz'))
  ok('…and that retrying only repeats the rest',
     half.failure.includes('wiederholt nur, was fehlt'))

  const nothing = describeSaveOutcome({
    steps: { rule: null, override: null, merchant: null },
    include: true, labels, kind: DECISION.LEARN, error: new Error('network'),
  })
  ok('a save that never started is not called partial', nothing.partial === false)
  ok('…and gets the ordinary refusal sentence',
     nothing.failure.includes('Es wurde nichts geändert'))

  const switchedBack = describeSaveOutcome({
    steps: { override: true, merchant: true }, include: true, labels, kind: DECISION.REVIEW,
  })
  ok('switching a merchant back on says that',
     switchedBack.lines.some((l) => l.includes('zählen wieder in Auswertungen')))
}

// ── 9. A merchant-wide decision has to reach the booking in hand ───────────
//
// REGRESSION. The priority is override > merchant > transaction, so a booking
// that already carried an individual include_in_analytics would have kept it
// after the user said „alle Buchungen von X nicht berücksichtigen" — the one
// booking they were looking at would have been the one the new rule missed.
//
// The fix is a semantic one, not a patch: choosing the merchant scope CLEARS
// the individual decision (sets it to null) rather than overwriting it with the
// same value. „Diese Buchung folgt dem Händler" is what the user just said, and
// null is how the data says it — so a later change of the merchant default
// reaches this booking too.
{
  const M = uuid(100)
  const merchants = [merchant(M, 'Scalable Capital')]
  const patterns = [pattern(uuid(400), M, ['SCALABLE'])]
  const tx = booking('Scalable Capital Verrechnungskonto')

  // Before: an individual decision that this booking counts.
  const individual = { transaction_id: tx.id, include_in_analytics: true, note: 'Sparplan',
                       merchant_id: M, category_id: uuid(999) }
  const before = matchMerchant({ transaction: tx, patterns, merchants })
  ok('the individual decision wins over the merchant today',
     resolveAnalyticsInclusion({
       transaction: tx, override: individual, merchantMatch: before,
       merchants: [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })],
     }) === true)

  // After the merchant-wide decision: the merchant says false, and the
  // individual one is gone.
  const offMerchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })]
  const cleared = { ...individual, include_in_analytics: null }
  ok('with the individual decision cleared, the merchant governs',
     resolveAnalyticsInclusion({
       transaction: tx, override: cleared,
       merchantMatch: matchMerchant({ transaction: tx, patterns, merchants: offMerchants }),
       merchants: offMerchants,
     }) === false)
  ok('…and the source says so',
     analyticsInclusion({
       transaction: tx, override: cleared,
       merchantMatch: matchMerchant({ transaction: tx, patterns, merchants: offMerchants }),
       merchants: offMerchants,
     }).source === 'merchant')

  // Everything else the override carried survives the clearing — that is the
  // repository's job, and this is the shape it has to preserve.
  ok('the note survives', cleared.note === 'Sparplan')
  ok('…the merchant', cleared.merchant_id === M)
  ok('…and the category', cleared.category_id === uuid(999))

  // And the other direction: the merchant is switched back on.
  const onMerchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: true })]
  ok('switching the merchant back on reaches the booking too',
     resolveAnalyticsInclusion({
       transaction: tx, override: cleared,
       merchantMatch: matchMerchant({ transaction: tx, patterns, merchants: onMerchants }),
       merchants: onMerchants,
     }) === true)

  // A booking that never had an individual decision needs no clearing at all.
  const plain = booking('Scalable Capital Sparplan')
  ok('a booking without an individual decision follows the merchant anyway',
     resolveAnalyticsInclusion({
       transaction: plain,
       merchantMatch: matchMerchant({ transaction: plain, patterns, merchants: offMerchants }),
       merchants: offMerchants,
     }) === false)
}

// ── 10. A note-only override does not decide anything about analytics ──────
{
  const M = uuid(101)
  const offMerchants = [merchant(M, 'Scalable Capital', { default_include_in_analytics: false })]
  const patterns = [pattern(uuid(401), M, ['SCALABLE'])]
  const tx = booking('Scalable Capital Verrechnungskonto')
  const match = matchMerchant({ transaction: tx, patterns, merchants: offMerchants })

  ok('a null in the column is not an opinion',
     resolveAnalyticsInclusion({
       transaction: tx, override: { note: 'nur Text', include_in_analytics: null },
       merchantMatch: match, merchants: offMerchants,
     }) === false)
  ok('…and neither is a missing column',
     resolveAnalyticsInclusion({
       transaction: tx, override: { note: 'nur Text' }, merchantMatch: match, merchants: offMerchants,
     }) === false)
}

// ── 11. The way back out of a global exclusion ─────────────────────────────
//
// A merchant switched off is recognised automatically from then on, so its
// bookings are resolved and never reach the classification queue again — which
// is why the switch that excluded it has to be reachable somewhere else. This
// is the list that screen shows, and it exists only while something is on it.
{
  const A = uuid(110), B = uuid(111), C = uuid(112)
  const all = [
    merchant(A, 'Scalable Capital', { default_include_in_analytics: false }),
    merchant(B, 'REWE'),
    merchant(C, 'Trade Republic', { default_include_in_analytics: false }),
  ]
  const list = excludedMerchants(all)
  ok('only the excluded merchants are listed', list.length === 2)
  ok('…in a stable order, by name',
     list.map((m) => m.canonical_name).join(',') === 'Scalable Capital,Trade Republic')
  ok('…and a counting merchant is not among them',
     !list.some((m) => m.canonical_name === 'REWE'))

  ok('an account with nothing excluded gets an empty list',
     excludedMerchants([merchant(B, 'REWE')]).length === 0)
  ok('…and so does one with no merchants at all', excludedMerchants([]).length === 0)
  ok('a merchant row without the column is not treated as excluded',
     excludedMerchants([{ id: A, canonical_name: 'Alt' }]).length === 0)

  // Switching one back on takes it off the list — and its bookings count again.
  const restored = all.map((m) => (m.id === A ? { ...m, default_include_in_analytics: true } : m))
  ok('switching a merchant back on removes it from the list',
     excludedMerchants(restored).map((m) => m.canonical_name).join(',') === 'Trade Republic')

  const patterns = [pattern(uuid(410), A, ['SCALABLE'])]
  const tx = booking('Scalable Capital Verrechnungskonto')
  ok('…and its bookings count again',
     resolveAnalyticsInclusion({
       transaction: tx,
       merchantMatch: matchMerchant({ transaction: tx, patterns, merchants: restored }),
       merchants: restored,
     }) === true)
  ok('…including one imported afterwards, with no merchant id',
     analyticsTransactions({
       transactions: [booking('Scalable Capital Sparplan Maerz')],
       patterns, merchants: restored,
     }).length === 1)
}

console.log(\`finance analytics: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeAnalyticsLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'test', DEV: false, PROD: true,
      VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    }),
  },
  write: false,
  logLevel: 'silent',
})

installRealtimeStub()
if (!globalThis.crypto) globalThis.crypto = webcrypto

const out = `${process.env.SCRATCH || '/tmp'}/financeAnalyticsLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
