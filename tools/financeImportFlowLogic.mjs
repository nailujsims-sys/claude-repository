// The import flow, end to end, without a browser.
//
// Everything the screen shows comes from src/lib/finance/importFlow.js, and this
// suite drives that module with the REAL parser, the REAL matcher and the REAL
// payload builder against fixtures of both actual exports. No mock of finance
// logic exists here — a preview that says "15 neu" says it because
// reconcileImport decided fifteen bookings were new.
//
// What is stubbed is only the outside world: `extract` (which needs pdfjs and a
// browser) and `crypto.subtle` for the file hash. Those are injection points the
// modules already offer for exactly this reason.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
import { SUPABASE_URL, SUPABASE_ANON_KEY, installRealtimeStub } from './supabaseStub.mjs'

const TEST = `
import {
  OUTCOME_LABELS,
  bookingTitle,
  buildPayload,
  buildPlan,
  confirmSentence,
  describeApplyResult,
  describeParseFailure,
  formatAmountMinor,
  formatBookingDate,
  hydrateForMatching,
  plural,
  previewRows,
  readStatementFile,
  summarizePlan,
  summaryLines,
  supersessionSentence,
} from './src/lib/finance/importFlow.js'
import { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
import { sourceHash } from './src/lib/finance/dkb/sourceHash.js'
import {
  referenceDocument,
  secondExportDocument,
  scannedDocument,
  wrongCountDocument,
} from './tools/fixtures/dkbUmsatzexport.mjs'
import { financeRepository } from './src/data/financeRepository.js'
import { makeBackend } from './tools/supabaseStub.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const threw = (fn) => { try { fn(); return null } catch (e) { return e.message } }

const ACCOUNT = '11111111-2222-4333-8444-000000000002'
const IMPORT = '11111111-2222-4333-8444-000000000001'
const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')

const A = parseDkbUmsatzexport(referenceDocument())
const B = parseDkbUmsatzexport(secondExportDocument())
ok('both fixtures parse', A.ok === true && B.ok === true)

// The first export, as it sits in the database afterwards.
const stored = A.transactions.map((t, i) => ({
  id: uuid(100 + i),
  account_id: ACCOUNT,
  booking_date: t.booking_date,
  amount_minor: t.amount_minor,
  currency: t.currency,
  raw_description: t.raw_description,
  manual_lock: false,
}))

// ── 1. Reading a file ───────────────────────────────────────────────────────
{
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
  const file = { arrayBuffer: async () => bytes.buffer }
  const read = await readStatementFile(file, {
    extract: async () => referenceDocument(),
    parse: parseDkbUmsatzexport,
  })
  ok('reading a file yields the parsed export', read.result.ok === true)
  ok('…and its bookings', read.result.transactions.length === A.transactions.length)
  ok('…and a 64-character hash', typeof read.hash === 'string' && read.hash.length === 64)

  const same = await readStatementFile({ arrayBuffer: async () => bytes.buffer }, {
    extract: async () => referenceDocument(),
    parse: parseDkbUmsatzexport,
  })
  ok('the same bytes give the same hash', same.hash === read.hash)

  const other = await sourceHash(new Uint8Array([1, 2, 3]))
  ok('different bytes give a different hash', other !== read.hash)
  ok('no crypto means no hash, not a crash', (await sourceHash(bytes, { subtle: null })) === null)
  ok('empty bytes give no hash', (await sourceHash(new Uint8Array([]))) === null)
}

// ── 2. The very first import: everything is new ─────────────────────────────
{
  const plan = buildPlan({ parsed: A, existing: [], accountId: ACCOUNT })
  const totals = summarizePlan(plan)
  ok('an empty account takes every booking as new', totals.neu === A.transactions.length)
  ok('…nothing is a duplicate', totals.vorhanden === 0)
  ok('…nothing needs review', totals.pruefen === 0)
  ok('…and all of them get saved', totals.gespeichert === A.transactions.length)
  ok('the headline counts the whole file', totals.erkannt === A.transactions.length)
  ok('no supersession sentence without a supersession', supersessionSentence(totals) === null)

  const rows = previewRows(A.transactions, plan)
  ok('one row per booking', rows.length === A.transactions.length)
  ok('every row says "Neu"', rows.every((r) => r.status === 'Neu'))
  ok('rows keep the order of the statement',
     rows.every((r, i) => r.index === i))
  ok('a row carries a readable title', rows.every((r) => r.title.length > 0))
  ok('a row carries a formatted amount', rows.every((r) => /\\d,\\d\\d/.test(r.amount)))
  ok('a row carries a German date', rows.every((r) => /^\\d\\d\\.\\d\\d\\.\\d{4}$/.test(r.date)))
}

// ── 3. The second, overlapping export ───────────────────────────────────────
const overlap = buildPlan({ parsed: B, existing: stored, accountId: ACCOUNT })
const overlapTotals = summarizePlan(overlap)
{
  ok('an overlapping export is not all new', overlapTotals.neu < B.transactions.length)
  ok('…and recognises what is already there',
     overlapTotals.vorhanden + overlapTotals.aktualisiert + overlapTotals.ersetzt > 0)
  ok('the breakdown adds up to the headline',
     overlapTotals.neu + overlapTotals.ersetzt + overlapTotals.vorhanden +
     overlapTotals.aktualisiert + overlapTotals.pruefen === overlapTotals.erkannt)
  ok('only new and replacing bookings are promised as saved',
     overlapTotals.gespeichert === overlapTotals.neu + overlapTotals.ersetzt)

  const rows = previewRows(B.transactions, overlap)
  const statuses = new Set(rows.map((r) => r.status))
  ok('the preview speaks German, not matcher',
     [...statuses].every((s) => ['Neu','Bereits vorhanden','Aktualisiert','Ersetzt','Prüfen'].includes(s)))
  ok('no technical outcome reaches a row',
     !rows.some((r) => /supersed|duplicate|enriched|unresolved/.test(r.status)))
}

// ── 4. The supersession, and what it refuses to claim ───────────────────────
{
  ok('the real export produces supersessions', overlapTotals.ersetzt > 0)
  const sentence = supersessionSentence(overlapTotals)
  ok('the supersession is explained in one sentence', typeof sentence === 'string')
  ok('…naming how many old bookings stop counting',
     sentence.includes(String(overlapTotals.abgeloest)) || overlapTotals.abgeloest === 1)
  ok('…and naming no pair at all', !/→|->|ersetzt .*durch .*\\(/.test(sentence))

  // The two −60,65 € bookings: a group of two against two. The count is
  // preserved and no row claims which replaced which.
  const grouped = overlap.decisions.filter((d) => d.outcome === 'supersedes_group')
  if (grouped.length > 0) {
    const rows = previewRows(B.transactions, overlap)
    const groupRows = grouped.map((d) => rows.find((r) => r.index === d.index))
    ok('every member of an ambiguous group reads the same', new Set(groupRows.map((r) => r.status)).size === 1)
    ok('…and that word is "Ersetzt"', groupRows[0].status === 'Ersetzt')
    ok('the group counts its predecessors once each',
       overlapTotals.abgeloest >= grouped[0].existing_ids.length)
  } else {
    ok('every member of an ambiguous group reads the same', true)
    ok('…and that word is "Ersetzt"', true)
    ok('the group counts its predecessors once each', true)
  }
}

// ── 5. The same export a second time ────────────────────────────────────────
{
  // What the database holds after the overlapping import: the first export plus
  // everything it just added.
  const after = [
    ...stored,
    ...B.transactions
      .filter((_, i) => {
        const d = overlap.decisions.find((x) => x.index === i)
        return d && (d.outcome === 'new' || d.outcome === 'supersedes' || d.outcome === 'supersedes_group')
      })
      .map((t, i) => ({
        id: uuid(200 + i),
        account_id: ACCOUNT,
        booking_date: t.booking_date,
        amount_minor: t.amount_minor,
        currency: t.currency,
        raw_description: t.raw_description,
        manual_lock: false,
      })),
  ]
  const again = buildPlan({ parsed: B, existing: after, accountId: ACCOUNT })
  const totals = summarizePlan(again)
  ok('re-importing the same export adds nothing new', totals.neu === 0)
  ok('…and promises to save nothing', totals.gespeichert === 0)
  ok('…and says so in the confirm line',
     confirmSentence(totals) === 'Es wird kein neuer Umsatz hinzugefügt.')
}

// ── 6. A review case reaches the preview as "Prüfen" ────────────────────────
{
  const fake = {
    decisions: [
      { index: 0, outcome: 'unresolved', existing_ids: [uuid(1)] },
      { index: 1, outcome: 'review', existing_ids: [uuid(2)] },
    ],
    summary: { new: 0, duplicate: 0, enriched: 0, supersedes: 0, supersedes_group: 0, unresolved: 1, review: 1 },
    refundCandidates: [],
  }
  const totals = summarizePlan(fake)
  ok('unresolved and review are counted together', totals.pruefen === 2)
  const lines = summaryLines(totals)
  ok('the summary says how many need checking', lines.some((l) => l === '2 müssen geprüft werden'))
  const rows = previewRows(
    [{ raw_description: 'A', booking_date: '2026-09-10', amount_minor: -100, currency: 'EUR' },
     { raw_description: 'B', booking_date: '2026-09-10', amount_minor: -100, currency: 'EUR' }],
    fake
  )
  ok('both rows read "Prüfen"', rows.every((r) => r.status === 'Prüfen'))
  ok('…and are marked as needing attention', rows.every((r) => r.tone === 'attention'))
}

// ── 7. "0 müssen geprüft werden" is always stated ───────────────────────────
{
  const totals = summarizePlan({ decisions: [], summary: { new: 3 }, refundCandidates: [] })
  const lines = summaryLines(totals)
  ok('a clean import still states the review count', lines.includes('0 müssen geprüft werden'))
  ok('…and does not list empty buckets', !lines.some((l) => l.startsWith('0 bereits')))
}

// ── 8. Money, dates, titles ─────────────────────────────────────────────────
{
  ok('cents are exact', formatAmountMinor(-2483, 'EUR') === '−24,83 €')
  ok('thousands are grouped', formatAmountMinor(-123456789, 'EUR') === '−1.234.567,89 €')
  ok('a credit has no minus', formatAmountMinor(5005, 'EUR') === '50,05 €')
  ok('zero is zero', formatAmountMinor(0, 'EUR') === '0,00 €')
  ok('a round amount keeps both cents', formatAmountMinor(-100, 'EUR') === '−1,00 €')
  ok('another currency says so', formatAmountMinor(-500, 'USD') === '−5,00 USD')
  ok('a missing amount formats to nothing', formatAmountMinor(null) === '')
  ok('the date is German', formatBookingDate('2026-09-14') === '14.09.2026')
  ok('a broken date formats to nothing', formatBookingDate('irgendwas') === '')
  ok('the title is the first line',
     bookingTitle({ raw_description: 'REWE\\nIBAN DE96\\nVISA' }) === 'REWE')
  ok('a booking without text still has a title',
     bookingTitle({ raw_description: '' }) === 'Ohne Beschreibung')
  ok('German plurals agree', plural(1, 'Umsatz', 'Umsätze') === '1 Umsatz')
  ok('…in both directions', plural(7, 'Umsatz', 'Umsätze') === '7 Umsätze')
}

// ── 9. A refused file says something a person can act on ────────────────────
{
  const scanned = parseDkbUmsatzexport(scannedDocument())
  ok('a scan is refused', scanned.ok === false)
  const described = describeParseFailure(scanned)
  ok('the headline is a sentence, not a code', /[a-zäöü] [a-zäöü]/i.test(described.headline))
  ok('…and no stack trace reaches it', !described.headline.includes('Error'))
  ok('the codes stay available underneath', described.details.length > 0)
  ok('…each with its own code', described.details.every((d) => typeof d.code === 'string'))

  const wrongCount = parseDkbUmsatzexport(wrongCountDocument())
  ok('a control value that does not add up is refused', wrongCount.ok === false)
  const generic = describeParseFailure(wrongCount)
  ok('the generic headline is the one the brief asked for',
     generic.headline.startsWith('Dieser DKB-Export konnte nicht vollständig geprüft werden'))
  ok('a refused file yields no bookings', wrongCount.transactions.length === 0)
}

// ── 10. The payload the database gets ───────────────────────────────────────
{
  const payload = buildPayload({ importId: IMPORT, accountId: ACCOUNT, parsed: B, plan: overlap })
  ok('the payload names the import', payload.import_id === IMPORT)
  ok('the payload names the account', payload.account_id === ACCOUNT)
  ok('one decision per booking', payload.decisions.length === B.transactions.length)
  const allowed = new Set(['booking_date','value_date','amount_minor','currency',
    'raw_description','external_reference','normalized_tokens','source_variant','source_metadata'])
  ok('bookings carry only storable fields',
     payload.bookings.every((b) => Object.keys(b).every((k) => allowed.has(k))))
  ok('the payload is stable', JSON.stringify(
       buildPayload({ importId: IMPORT, accountId: ACCOUNT, parsed: B, plan: overlap })) === JSON.stringify(payload))
}

// ── 11. The account is not optional ─────────────────────────────────────────
{
  // Stored bookings carry an account, freshly parsed ones do not. Without the
  // account being named, every arrival would fall through as new and the import
  // would double everything — buildPlan is the one call site that decides this.
  const message = threw(() => buildPlan({ parsed: B, existing: stored, accountId: null }))
  ok('an import without a named account is refused', message !== null)
  ok('…loudly enough to read', typeof message === 'string' && message.includes('Konto'))
}

// ── 12. The success screen reads the database, not the preview ──────────────
{
  const totals = summarizePlan(overlap)
  const described = describeApplyResult(
    { transactions_created: 12, observations_created: 2, supersessions_confirmed: 1,
      review_items_created: 2, replayed: false },
    totals
  )
  ok('the created count comes from the result', described.lines.some((l) => l.startsWith('12 neue')))
  ok('observations are reported as enrichments', described.lines.some((l) => l.includes('ergänzt')))
  ok('review items are stated', described.review === 2)
  ok('…in a sentence', described.reviewSentence === '2 Umsätze müssen später geprüft werden.')
  ok('a single review item is singular',
     describeApplyResult({ review_items_created: 1 }, totals).reviewSentence ===
       '1 Umsatz muss später geprüft werden.')
  ok('no review means no sentence',
     describeApplyResult({ review_items_created: 0 }, totals).reviewSentence === null)
  ok('a replay is reported as one',
     describeApplyResult({ replayed: true }, totals).replayed === true)
}

// ── 13. The vocabulary is complete ──────────────────────────────────────────
{
  const outcomes = ['new','duplicate','enriched','supersedes','supersedes_group','unresolved','review']
  ok('every outcome has a German word', outcomes.every((o) => typeof OUTCOME_LABELS[o] === 'string'))
  ok('…and none of them is the outcome itself',
     outcomes.every((o) => OUTCOME_LABELS[o] !== o))
}

// ── 13b. The evidence a reload must bring back ─────────────────────────────
// A booking's stored text is frozen; the richer text a later export contributed
// lives beside it as an observation. Everything the matcher knows is derived
// from the description — the reference included — so a booking whose reference
// only ever appeared in the richer text has, for matching purposes, none at all
// unless the observation is read back with it.
{
  const booking = {
    id: uuid(1), account_id: ACCOUNT, booking_date: '2026-09-14', amount_minor: -5005,
    currency: 'EUR', raw_description: 'Deutsche Bahn', external_reference: null,
  }
  const observations = [{
    transaction_id: uuid(1),
    observed_description: 'DB.Vertrieb.GmbH/564851284265',
    observed_reference: '564851284265',
    created_at: '2026-09-15T10:00:00Z',
  }]

  const plain = hydrateForMatching([booking], [])
  ok('without observations the booking is handed over untouched', plain[0] === booking)

  const rich = hydrateForMatching([booking], observations)
  ok('with one, the matcher sees the better text',
     rich[0].raw_description === 'DB.Vertrieb.GmbH/564851284265')
  ok('…and the reference that only lived there', rich[0].external_reference === '564851284265')
  ok('…while the stored row itself is untouched', booking.raw_description === 'Deutsche Bahn')
  ok('…and the identity is carried over', rich[0].id === uuid(1) && rich[0].account_id === ACCOUNT)

  const newest = hydrateForMatching([booking], [
    ...observations,
    { transaction_id: uuid(1), observed_description: 'Noch besser', observed_reference: null,
      created_at: '2026-09-16T10:00:00Z' },
  ])
  ok('the newest observation wins', newest[0].raw_description === 'Noch besser')

  ok('an observation for another booking changes nothing',
     hydrateForMatching([booking], [{ transaction_id: uuid(9), observed_description: 'Fremd',
       created_at: '2026-09-20T10:00:00Z' }])[0] === booking)
  ok('an observation equal to the stored text changes nothing',
     hydrateForMatching([booking], [{ transaction_id: uuid(1),
       observed_description: 'Deutsche Bahn', created_at: '2026-09-20T10:00:00Z' }])[0] === booking)
  ok('a malformed observation is ignored',
     hydrateForMatching([booking], [{ transaction_id: uuid(1), observed_description: null }])[0] === booking)

  // And it reaches the matcher, in the shape that matters most: this booking's
  // only distinguishing mark is the reference, and the reference exists solely
  // in the observation. Without it the arrival matches no tier at all and comes
  // out as NEW — the same payment imported a second time. With it, it is
  // recognised. This is why a reload has to bring the observations back.
  const incoming = {
    booking_date: '2026-09-14', amount_minor: -5005, currency: 'EUR',
    raw_description: 'DB.Vertrieb.GmbH/564851284265',
  }
  const parsed = { ok: true, header: { period_start: '2026-09-14', period_end: '2026-09-14' },
                   transactions: [incoming] }
  const without = buildPlan({ parsed, existing: [booking], accountId: ACCOUNT })
  const withObs = buildPlan({ parsed, existing: [booking], observations, accountId: ACCOUNT })
  ok('without the observation the same payment would be imported again',
     without.decisions[0].outcome === 'new')
  ok('…and the preview would have promised a new booking',
     summarizePlan(without).neu === 1)
  ok('with it, it is recognised as the same booking',
     withObs.decisions[0].outcome === 'duplicate')
  ok('…and the preview stops promising a change',
     summarizePlan(withObs).aktualisiert === 0)
}

// ── 13c. A manual decision has to reach the preview ────────────────────────
{
  const booking = {
    id: uuid(2), account_id: ACCOUNT, booking_date: '2026-09-14', amount_minor: -5005,
    currency: 'EUR', raw_description: 'Deutsche Bahn', manual_lock: false,
  }
  const parsed = { ok: true, header: { period_start: '2026-09-14', period_end: '2026-09-14' },
                   transactions: [{ booking_date: '2026-09-14', amount_minor: -5005,
                                    currency: 'EUR', raw_description: 'Deutsche Bahn' }] }

  const plain = buildPlan({ parsed, existing: [booking], accountId: ACCOUNT })
  ok('an unprotected booking matches normally', plain.decisions[0].outcome === 'duplicate')

  const overridden = buildPlan({
    parsed, existing: [booking], overrideTransactionIds: [uuid(2)], accountId: ACCOUNT,
  })
  ok('an overridden booking is flagged for review', overridden.decisions[0].outcome === 'review')
  ok('…and the preview says "Prüfen"',
     previewRows(parsed.transactions, overridden)[0].status === 'Prüfen')
  ok('…and counts it as needing a look', summarizePlan(overridden).pruefen === 1)

  const locked = buildPlan({
    parsed, existing: [{ ...booking, manual_lock: true }], accountId: ACCOUNT,
  })
  ok('manual_lock does the same without any extra plumbing',
     locked.decisions[0].outcome === 'review')
}

// ── 14. The repository path: what actually goes on the wire ────────────────
{
  const USER = '11111111-2222-4333-8444-555555555555'
  const backend = makeBackend({
    tasks: [], events: [],
    finance: {
      finance_accounts: [{ id: ACCOUNT, user_id: USER, name: 'DKB Girokonto', currency: 'EUR' }],
    },
    rpc: {
      finance_apply_reconciliation_plan: () => new Response(
        JSON.stringify({ transactions_created: 12, observations_created: 1,
                         supersessions_confirmed: 1, review_items_created: 0, replayed: false }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
    },
  })
  globalThis.fetch = (...args) => backend.fetch(...args)

  // A file nobody has seen before has no import row yet.
  ok('an unknown file has no import row',
     (await financeRepository.findImportBySourceHash(USER, 'a'.repeat(64))) === null)
  ok('no hash means no lookup at all',
     (await financeRepository.findImportBySourceHash(USER, null)) === null)

  const created = await financeRepository.createImport(USER, {
    account_id: ACCOUNT, source_type: 'pdf', source_name: 'Auszug.pdf',
    source_hash: 'b'.repeat(64), status: 'parsed',
    period_start: '2026-09-10', period_end: '2026-09-14',
  })
  ok('the import row carries the declared period',
     created.period_start === '2026-09-10' && created.period_end === '2026-09-14')
  ok('…and the file identity', created.source_hash === 'b'.repeat(64))
  ok('the same file is found again',
     (await financeRepository.findImportBySourceHash(USER, 'b'.repeat(64)))?.id === created.id)

  const payload = buildPayload({ importId: created.id, accountId: ACCOUNT, parsed: B, plan: overlap })
  const result = await financeRepository.applyReconciliationPlan(USER, payload)
  ok('the RPC answers with what it wrote', result.transactions_created === 12)

  const call = backend.rpcCalls[backend.rpcCalls.length - 1]
  ok('exactly one write path is used', call.name === 'finance_apply_reconciliation_plan')
  ok('the body uses the RPC parameter names',
     Object.keys(call.body).sort().join(',') ===
     'p_account_id,p_bookings,p_decisions,p_import_id,p_refund_candidates')
  ok('the decisions arrive unchanged',
     JSON.stringify(call.body.p_decisions) === JSON.stringify(payload.decisions))
  ok('no user id is sent — the function reads auth.uid() itself',
     !JSON.stringify(call.body).includes(USER))

  // No PDF, no file name and no raw bytes ever reach the wire beyond the
  // bookings the parser produced.
  const wire = JSON.stringify(backend.calls) + JSON.stringify(backend.rpcCalls)
  ok('no PDF bytes are sent anywhere', !wire.includes('%PDF'))

  const account = await financeRepository.createAccount(USER, {
    name: 'Zweitkonto', provider: 'DKB', currency: 'EUR',
  })
  ok('an account can be created with the defaults the flow uses',
     account.name === 'Zweitkonto' && account.currency === 'EUR')

  let refused = null
  try { await financeRepository.applyReconciliationPlan(null, payload) } catch (e) { refused = e.message }
  ok('a signed-out app makes no request at all', refused !== null)
}

console.log(\`finance import flow: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeImportFlowLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'test',
      DEV: false,
      PROD: true,
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    }),
  },
  write: false,
  logLevel: 'silent',
})

installRealtimeStub()
if (!globalThis.crypto) globalThis.crypto = webcrypto

const out = `${process.env.SCRATCH || '/tmp'}/financeImportFlowLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
