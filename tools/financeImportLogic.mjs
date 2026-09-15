// The client half of the persistence layer: turning a reconciliation plan into
// the payload the database applies, and putting it on the wire.
//
// Everything that decides money — cardinality, idempotency, whether a manual
// decision may be stepped over — is enforced in Postgres and asserted in
// supabase/tests/finance_import.sql, because asserting it here would only test
// a mock. What CAN be proved here is the contract between the two halves:
//
//   • the payload carries exactly the fields the database stores, and nothing
//     the plan dragged along for the preview;
//   • a malformed plan is refused before a transaction is ever opened, with a
//     sentence that names the booking rather than a constraint;
//   • the same plan produces the same payload, twice;
//   • the call sends no user id — the function reads auth.uid() itself.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SUPABASE_URL, SUPABASE_ANON_KEY, installRealtimeStub } from './supabaseStub.mjs'

const TEST = `
import { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
import { reconcileImport } from './src/lib/finance/dkb/reconcile.js'
import { buildApplyPayload } from './src/lib/finance/dkb/plan.js'
import { referenceDocument, secondExportDocument } from './tools/fixtures/dkbUmsatzexport.mjs'
import { financeRepository } from './src/data/financeRepository.js'
import { pickWritableFinanceImport } from './src/data/financeDefaults.js'
import { makeBackend } from './tools/supabaseStub.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const threw = (fn) => { try { fn(); return null } catch (e) { return e.message } }

const IMPORT = '11111111-2222-4333-8444-000000000001'
const ACCOUNT = '11111111-2222-4333-8444-000000000002'
const USER = '11111111-2222-4333-8444-555555555555'
const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')

// ── The real shape: both fixtures, reconciled, then made into a payload ─────
const A = parseDkbUmsatzexport(referenceDocument())
const B = parseDkbUmsatzexport(secondExportDocument())
ok('both fixtures parse', A.ok === true && B.ok === true)

const stored = A.transactions.map((t, i) => ({
  id: uuid(100 + i),
  account_id: ACCOUNT,
  booking_date: t.booking_date,
  amount_minor: t.amount_minor,
  currency: t.currency,
  raw_description: t.raw_description,
  manual_lock: false,
}))
const plan = reconcileImport({
  existing: stored,
  incoming: B.transactions,
  period: { start: B.header.period_start, end: B.header.period_end },
  accountId: ACCOUNT,
})
const payload = buildApplyPayload({ importId: IMPORT, accountId: ACCOUNT, bookings: B.transactions, plan })

// ── 1. It describes the whole file, once ────────────────────────────────────
{
  ok('one decision per booking', payload.decisions.length === B.transactions.length)
  ok('the payload names the import', payload.import_id === IMPORT)
  ok('the payload names the account', payload.account_id === ACCOUNT)
  const indexes = payload.decisions.map((d) => d.index)
  ok('the indexes are complete and sorted',
     indexes.join(',') === B.transactions.map((_, i) => i).join(','))
}

// ── 2. It narrows ───────────────────────────────────────────────────────────
{
  const allowed = new Set(['booking_date','value_date','amount_minor','currency',
    'raw_description','external_reference','normalized_tokens','source_variant','source_metadata'])
  const extra = payload.bookings.flatMap((b) => Object.keys(b)).filter((k) => !allowed.has(k))
  ok('a booking carries only storable fields', extra.length === 0)

  const decisionKeys = new Set(payload.decisions.flatMap((d) => Object.keys(d)))
  ok('a decision carries only what the RPC reads',
     [...decisionKeys].every((k) => ['index','outcome','tier','existing_ids','reason','evidence'].includes(k)))

  // The matcher carries the whole matched booking on each side of a refund
  // proposal so a preview can show it. None of that goes over the wire.
  const sides = payload.refund_candidates.flatMap((c) => [c.charge, c.refund])
  ok('a refund side is an id or a position, never a booking',
     sides.every((s) => Object.keys(s).every((k) => ['source','id','index'].includes(k))))
  ok('the real export still proposes its refund', payload.refund_candidates.length === 1)
}

// ── 3. The same plan, the same payload ──────────────────────────────────────
{
  const again = buildApplyPayload({ importId: IMPORT, accountId: ACCOUNT, bookings: B.transactions, plan })
  ok('building the payload twice gives the same bytes',
     JSON.stringify(again) === JSON.stringify(payload))

  // Order-independence of the plan is reconcile's promise; this checks that the
  // payload does not reintroduce an order of its own.
  const shuffled = { ...plan, decisions: [...plan.decisions].reverse() }
  const fromShuffled = buildApplyPayload({ importId: IMPORT, accountId: ACCOUNT, bookings: B.transactions, plan: shuffled })
  ok('a reordered plan produces the same payload',
     JSON.stringify(fromShuffled.decisions) === JSON.stringify(payload.decisions))
}

// ── 4. Refusals, before anything is opened ──────────────────────────────────
{
  const base = { importId: IMPORT, accountId: ACCOUNT, bookings: B.transactions, plan }
  ok('a missing import id is refused',
     threw(() => buildApplyPayload({ ...base, importId: 'nicht-uuid' })) !== null)
  ok('a missing account id is refused',
     threw(() => buildApplyPayload({ ...base, accountId: null })) !== null)
  ok('no plan at all is refused', threw(() => buildApplyPayload({ ...base, plan: {} })) !== null)

  const short = { ...plan, decisions: plan.decisions.slice(1) }
  const msg = threw(() => buildApplyPayload({ ...base, plan: short }))
  ok('a plan that does not cover the file is refused', msg !== null)
  ok('and the message says how far off it is', msg.includes(String(plan.decisions.length - 1)))

  const doubled = { ...plan, decisions: plan.decisions.map((d) => ({ ...d, index: 0 })) }
  ok('two decisions for one booking are refused',
     threw(() => buildApplyPayload({ ...base, plan: doubled })) !== null)

  const outOfRange = { ...plan, decisions: plan.decisions.map((d, i) => i === 0 ? { ...d, index: 999 } : d) }
  ok('a decision about a booking that is not in the file is refused',
     threw(() => buildApplyPayload({ ...base, plan: outOfRange })) !== null)

  const unknown = { ...plan, decisions: plan.decisions.map((d, i) => i === 0 ? { ...d, outcome: 'merge' } : d) }
  const unknownMsg = threw(() => buildApplyPayload({ ...base, plan: unknown }))
  ok('an invented outcome is refused', unknownMsg !== null && unknownMsg.includes('merge'))

  const badId = { ...plan, decisions: plan.decisions.map((d, i) => i === 0 ? { ...d, outcome: 'duplicate', existing_ids: ['nope'] } : d) }
  ok('an existing id that is not a uuid is refused',
     threw(() => buildApplyPayload({ ...base, plan: badId })) !== null)

  const newWithMatch = { ...plan, decisions: plan.decisions.map((d, i) => i === 0 ? { ...d, outcome: 'new', existing_ids: [uuid(1)] } : d) }
  ok('"new" that claims a match is refused',
     threw(() => buildApplyPayload({ ...base, plan: newWithMatch })) !== null)

  const matchWithout = { ...plan, decisions: plan.decisions.map((d, i) => i === 0 ? { ...d, outcome: 'supersedes', existing_ids: [] } : d) }
  ok('a supersession without a predecessor is refused',
     threw(() => buildApplyPayload({ ...base, plan: matchWithout })) !== null)
}

// ── 5. A refund side nobody can point at is dropped, not half-sent ──────────
{
  const broken = {
    decisions: [{ index: 0, outcome: 'new', existing_ids: [], reason: '', evidence: {} }],
    refundCandidates: [
      { reference: '1', charge: { source: 'existing', id: null }, refund: { source: 'incoming', index: 0 }, reason: '' },
      { reference: '2', charge: { source: 'incoming', index: 0 }, refund: { source: 'existing', id: uuid(7) }, reason: '' },
    ],
  }
  const out = buildApplyPayload({ importId: IMPORT, accountId: ACCOUNT, bookings: [B.transactions[0]], plan: broken })
  ok('an unpointable refund side drops the proposal', out.refund_candidates.length === 1)
  ok('and the one that can be pointed at survives', out.refund_candidates[0].reference === '2')
}

// ── 6. On the wire ──────────────────────────────────────────────────────────
{
  const backend = makeBackend({
    tasks: [], events: [],
    rpc: { finance_apply_reconciliation_plan: () => new Response(
      JSON.stringify({ transactions_created: 3, replayed: false }),
      { status: 200, headers: { 'content-type': 'application/json' } }) },
  })
  globalThis.fetch = (...args) => backend.fetch(...args)

  const result = await financeRepository.applyReconciliationPlan(USER, payload)
  ok('the result comes back', result.transactions_created === 3)

  const call = backend.rpcCalls[backend.rpcCalls.length - 1]
  ok('it calls the right function', call.name === 'finance_apply_reconciliation_plan')
  ok('the body uses the RPC parameter names',
     Object.keys(call.body).sort().join(',') ===
     'p_account_id,p_bookings,p_decisions,p_import_id,p_refund_candidates')
  ok('no user id is sent — the function reads auth.uid() itself',
     !JSON.stringify(call.body).includes(USER))
  ok('the decisions arrive unchanged',
     JSON.stringify(call.body.p_decisions) === JSON.stringify(payload.decisions))

  let refused = null
  try { await financeRepository.applyReconciliationPlan(null, payload) } catch (e) { refused = e.message }
  ok('a signed-out app makes no request at all', refused !== null)
}

// ── 7. The period the database checks against has to be settable ───────────
{
  // finance_apply_reconciliation_plan refuses a booking outside the period the
  // import declares. A column the client cannot write would make that check
  // dead code, so the writable list has to carry both ends.
  const patch = pickWritableFinanceImport({
    account_id: ACCOUNT,
    source_hash: 'h',
    period_start: '2026-09-10',
    period_end: '2026-09-14',
    user_id: 'geschmuggelt',
    apply_result: { nope: true },
  })
  ok('an import may declare its period', patch.period_start === '2026-09-10' && patch.period_end === '2026-09-14')
  ok('…and still cannot set its own user', !('user_id' in patch))
  ok('…nor the result of applying it', !('apply_result' in patch))
}

// ── 8. Standing by a relation, or taking it back ───────────────────────────
{
  const backend = makeBackend({
    tasks: [], events: [],
    rpc: {
      finance_resolve_relation: () => new Response(
        JSON.stringify({ relation_id: uuid(9), status: 'rejected', analytics_restored: [uuid(1)] }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
      finance_resolve_review_item: () => new Response(
        JSON.stringify({ id: uuid(8), status: 'resolved' }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
    },
  })
  globalThis.fetch = (...args) => backend.fetch(...args)

  const rejected = await financeRepository.resolveRelation(USER, uuid(9), 'rejected', 'Doch nicht.')
  ok('rejecting a relation comes back with what it restored', rejected.analytics_restored.length === 1)
  let call = backend.rpcCalls[backend.rpcCalls.length - 1]
  ok('it calls the resolve function', call.name === 'finance_resolve_relation')
  ok('with the RPC parameter names',
     Object.keys(call.body).sort().join(',') === 'p_note,p_relation_id,p_status')
  ok('and no user id — the function reads auth.uid() itself',
     !JSON.stringify(call.body).includes(USER))

  const closed = await financeRepository.resolveReviewItem(USER, uuid(8), 'resolved', 'Geklärt.')
  ok('a review item can be closed', closed.status === 'resolved')
  call = backend.rpcCalls[backend.rpcCalls.length - 1]
  ok('it calls the review function', call.name === 'finance_resolve_review_item')
  ok('with the RPC parameter names',
     Object.keys(call.body).sort().join(',') === 'p_item_id,p_resolution,p_status')

  for (const [name, fn] of [
    ['resolveRelation', () => financeRepository.resolveRelation(null, uuid(9), 'rejected')],
    ['resolveReviewItem', () => financeRepository.resolveReviewItem(null, uuid(8), 'resolved')],
    ['listObservationSightings', () => financeRepository.listObservationSightings(null)],
    ['listReviewItemTransactions', () => financeRepository.listReviewItemTransactions(null)],
  ]) {
    let refused = null
    try { await fn() } catch (e) { refused = e.message }
    ok(name + ' makes no request without a user', refused !== null)
  }
}

console.log(\`finance import: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeImportLogic.test.mjs', loader: 'js' },
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

// See installRealtimeStub: this suite imports financeRepository, which builds a
// Supabase client at module load. Without the stub it dies on the runner, which
// pins Node 20, before its first assertion.
installRealtimeStub()

const out = `${process.env.SCRATCH || '/tmp'}/financeImportLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
