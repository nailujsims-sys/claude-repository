// The classification flow, without a browser.
//
// Everything the Zuordnung sheet shows comes from four modules that already
// existed before it: merchantMatching, categoryRules, backtest and learning.
// This suite drives the REAL ones — there is no second, simpler matcher in the
// tests any more than there is one in the screen. What is new here is only the
// queue (which bookings still need a human) and the words (what the sheet says
// about them), and both are pure.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  buildClassificationQueue, classifyTransaction, needsDecision, summarizeQueue,
} from './src/lib/finance/classificationQueue.js'
import {
  DECISION, backtestNumbers, blockingConflict, buildOverride, categoryLabelOf,
  claimingMerchants, confirmationLines, decisionExplanation, decisionKindOf,
  describeOverrideResult,
  describeLearnFailure, describeLearnResult, descriptionSegments, learnErrorLines,
  patternLabelOf, patternTypeFor, patternWarnings, rangeIsLearnable, rangeText,
  rangeTokens, selectionRange,
} from './src/lib/finance/classificationFlow.js'
import { buildLearnRequest } from './src/lib/finance/learning.js'
import { backtestPattern } from './src/lib/finance/backtest.js'
import { matchMerchant, FINANCE_STATUS } from './src/lib/finance/merchantMatching.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { FINANCE_CATEGORIES } from './src/config/finance.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')
const ACCOUNT = uuid(2)
const CATEGORIES = FINANCE_CATEGORIES.map((c, i) => ({ ...c, id: uuid(900 + i) }))
const cat = (slug) => CATEGORIES.find((c) => c.slug === slug).id

// A booking as the database holds it: the tokens are frozen beside the text,
// exactly as finance_apply_reconciliation_plan wrote them.
let seq = 100
const booking = (raw, over = {}) => {
  seq += 1
  return {
    id: uuid(seq), account_id: ACCOUNT, booking_date: '2026-09-' + String((seq % 28) + 1).padStart(2, '0'),
    amount_minor: -1234, currency: 'EUR', raw_description: raw,
    normalized_tokens: tokenize(raw), manual_lock: false, merchant_id: null, category_id: null,
    ...over,
  }
}

const merchant = (id, name, over = {}) => ({ id, canonical_name: name, review_mode: 'auto', ...over })
const pattern = (id, merchantId, type, tokens) => ({
  id, merchant_id: merchantId, pattern_type: type, tokens, active: true,
})
const rule = (id, merchantId, categoryId, over = {}) => ({
  id, merchant_id: merchantId, category_id: categoryId, active: true,
  min_amount_minor: null, max_amount_minor: null, min_inclusive: true, max_inclusive: true,
  currency: null, ...over,
})

// ── 1. The booking text as pointable words ──────────────────────────────────
{
  const tx = booking('REWE TROISDORF SAGT DANKE 8407')
  const { segments, lines, aligned } = descriptionSegments(tx)

  ok('every word of the booking is offered', segments.length === 5)
  ok('…in the order it is printed',
     segments.map((s) => s.text).join(' ') === 'REWE TROISDORF SAGT DANKE 8407')
  ok('…each carrying the token it would save',
     segments.map((s) => s.token).join(' ') === 'REWE TROISDORF SAGT DANKE 8407')
  ok('…and all of them learnable', segments.every((s) => s.learnable))
  ok('the segments line up with the stored tokens', aligned === true)
  ok('one printed line stays one line', lines.length === 1 && lines[0].length === 5)

  // The visible spelling and the stored token are two different things.
  const mixed = booking('ReWe Troisdorf')
  const m = descriptionSegments(mixed)
  ok('the user reads what the statement printed', m.segments[0].text === 'ReWe')
  ok('…and saves what the matcher compares', m.segments[0].token === 'REWE')

  const multi = booking('Deutsche Bahn\\nDB.Vertrieb.GmbH/508354771568\\n(POS)')
  ok('a multi-line booking keeps its lines', descriptionSegments(multi).lines.length === 3)
  ok('…and its separators are not words',
     descriptionSegments(multi).segments.every((s) => /^[\\p{L}\\p{N}]+$/u.test(s.text)))
}

// ── 2. The selection is a range, never a set ────────────────────────────────
{
  const tx = booking('MAX UND MORITZ TROISDORF')
  const { segments } = descriptionSegments(tx)

  ok('one word is an exact_token', patternTypeFor(rangeTokens(segments, { from: 0, to: 0 })) === 'exact_token')
  ok('two neighbours are an exact_phrase', patternTypeFor(rangeTokens(segments, { from: 0, to: 1 })) === 'exact_phrase')
  ok('a range marked backwards is the same range',
     JSON.stringify(selectionRange(2, 0)) === JSON.stringify({ from: 0, to: 2 }))
  ok('a range is contiguous by construction',
     rangeTokens(segments, selectionRange(0, 2)).join(' ') === 'MAX UND MORITZ')
  ok('the visible words pre-fill the merchant name',
     rangeText(segments, { from: 0, to: 2 }) === 'MAX UND MORITZ')
}

// ── 3. REWE: one word, one rule, every open REWE booking ────────────────────
{
  const target = booking('REWE TROISDORF SAGT DANKE 8407')
  const others = [
    booking('REWE.Mohamed.Boufo/Frankfurt'),
    booking('REWE SAGT DANKE 1122'),
    booking('REWE Markt GmbH Troisdorf'),
    booking('REWE CITY 4455'),
  ]
  const unrelated = [booking('ALDI SUED Esslingen'), booking('DB.Vertrieb.GmbH/508354771568')]
  const transactions = [target, ...others, ...unrelated]

  const { segments } = descriptionSegments(target)
  const tokens = rangeTokens(segments, { from: 0, to: 0 })
  ok('marking the first word gives REWE', tokens.join(' ') === 'REWE')

  const built = buildLearnRequest({
    transaction: target, selection: tokens, patternType: 'exact_token',
    categorySlug: 'lebensmittel', categories: CATEGORIES,
    merchantName: 'REWE', transactions, patterns: [], overrides: [],
  })

  ok('the gesture is valid', built.valid === true)
  ok('…and saves an exact_token', built.request.p_pattern_type === 'exact_token')
  ok('…with exactly the marked token', JSON.stringify(built.request.p_tokens) === '["REWE"]')
  ok('…under the chosen category', built.request.p_category_slug === 'lebensmittel')
  ok('…and a new merchant by name',
     built.request.p_merchant_id === null && built.request.p_merchant_name === 'REWE')

  ok('the backtest finds every REWE booking', built.backtest.matchCount === 5)
  ok('…and no booking that is not one', built.backtest.matchCount === 5 &&
     !built.backtest.transactionIds.includes(unrelated[0].id))
  ok('…REWERT-style near misses are impossible by construction',
     matchMerchant({ transaction: booking('REWERT UND SOEHNE'),
                     patterns: [pattern(uuid(1), uuid(50), 'exact_token', ['REWE'])],
                     merchants: [merchant(uuid(50), 'REWE')] }).status === FINANCE_STATUS.UNRESOLVED)

  ok('the four other bookings are sent along', built.request.p_apply_transaction_ids.length === 4)
  ok('…and the booking in hand is not in that list',
     !built.request.p_apply_transaction_ids.includes(target.id))

  const numbers = backtestNumbers({ backtest: built.backtest, transaction: target })
  ok('four further open bookings', numbers.weitere === 4)
  ok('five bookings change in total', numbers.gesamt === 5)
  ok('nothing is left untouched', numbers.unveraendert === 0)

  const lines = confirmationLines({
    numbers, patternLabel: patternLabelOf(tokens),
    merchantName: 'REWE', categoryName: categoryLabelOf(CATEGORIES, 'lebensmittel'),
  })
  ok('the sentence names the further bookings',
     lines[0] === '„REWE" erkennt 4 weitere offene Umsätze.')
  ok('…and what they become',
     lines[1] === '5 Umsätze werden REWE · Lebensmittel.')

  // After saving: the pattern exists, and the queue is empty of REWE.
  const saved = pattern(uuid(300), uuid(50), 'exact_token', ['REWE'])
  const after = buildClassificationQueue({
    transactions, patterns: [saved], merchants: [merchant(uuid(50), 'REWE')],
    rules: [rule(uuid(400), uuid(50), cat('lebensmittel'))],
  })
  ok('no REWE booking waits any more',
     after.open.every((e) => !e.transaction.raw_description.toUpperCase().includes('REWE')))
  ok('…and every one of them is resolved as Lebensmittel',
     after.entries.filter((e) => e.transaction.raw_description.toUpperCase().includes('REWE'))
       .every((e) => e.status === FINANCE_STATUS.RESOLVED && e.categoryId === cat('lebensmittel')))
  ok('the two unrelated bookings are still open', after.open.length === 2)
}

// ── 4. A phrase is in order and next to each other ──────────────────────────
{
  const target = booking('MAX UND MORITZ TROISDORF')
  const wrongOrder = booking('MORITZ UND MAX TROISDORF')
  const gap = booking('MAX MORITZ TROISDORF')
  const transactions = [target, wrongOrder, gap]

  const { segments } = descriptionSegments(target)
  const tokens = rangeTokens(segments, { from: 0, to: 2 })

  const built = buildLearnRequest({
    transaction: target, selection: tokens, patternType: patternTypeFor(tokens),
    categorySlug: 'restaurant', categories: CATEGORIES,
    merchantName: 'Max und Moritz', transactions, patterns: [], overrides: [],
  })

  ok('three neighbouring words are a phrase', built.request.p_pattern_type === 'exact_phrase')
  ok('…in the order they were marked',
     JSON.stringify(built.request.p_tokens) === '["MAX","UND","MORITZ"]')
  ok('the phrase matches only the booking it came from', built.backtest.matchCount === 1)
  ok('…not the same words in another order',
     !built.backtest.transactionIds.includes(wrongOrder.id))
  ok('…and not the same words with one missing',
     !built.backtest.transactionIds.includes(gap.id))

  const saved = pattern(uuid(310), uuid(51), 'exact_phrase', ['MAX', 'UND', 'MORITZ'])
  const merchants = [merchant(uuid(51), 'Max und Moritz')]
  ok('after saving, the wrong order stays unrecognised',
     matchMerchant({ transaction: wrongOrder, patterns: [saved], merchants }).status === FINANCE_STATUS.UNRESOLVED)
  ok('…and so does MAX MORITZ without UND',
     matchMerchant({ transaction: gap, patterns: [saved], merchants }).status === FINANCE_STATUS.UNRESOLVED)
  ok('…while the booking itself is recognised',
     matchMerchant({ transaction: target, patterns: [saved], merchants }).merchantId === uuid(51))
}

// ── 5. An alias is a second pattern, not a second merchant ──────────────────
{
  const ALDI = uuid(60)
  const merchants = [merchant(ALDI, 'ALDI Süd')]
  const existing = [pattern(uuid(320), ALDI, 'exact_phrase', ['ALDI', 'SUED'])]

  const plain = booking('ALDI SUED Esslingen')
  const dotted = booking('ALDI.SUED/Esslingen.am')
  const transactions = [plain, dotted]

  ok('the existing pattern already recognises the plain spelling',
     matchMerchant({ transaction: plain, patterns: existing, merchants }).merchantId === ALDI)
  // The dotted spelling tokenises to the same two tokens next to each other, so
  // the phrase covers it too — the alias case that needs a NEW pattern is the
  // one where the tokens differ.
  const oddball = booking('ALDI SUED SAGT DANKE / ESSLINGEN AM NECKAR')
  const { segments } = descriptionSegments(oddball)

  const built = buildLearnRequest({
    transaction: oddball, selection: rangeTokens(segments, { from: 0, to: 0 }),
    patternType: 'exact_token', categorySlug: 'lebensmittel', categories: CATEGORIES,
    merchantId: ALDI, transactions: [...transactions, oddball],
    patterns: existing, overrides: [],
  })

  ok('a new spelling can be taught to the merchant that exists', built.valid === true)
  ok('…by id, so no second ALDI is created',
     built.request.p_merchant_id === ALDI && built.request.p_merchant_name === null)
  ok('…and it is not a conflict with the merchant\\'s own pattern',
     blockingConflict({ backtest: built.backtest, merchants }) === null)

  const both = [...existing, pattern(uuid(321), ALDI, 'exact_token', ['ALDI'])]
  const after = buildClassificationQueue({
    transactions: [...transactions, oddball], patterns: both, merchants,
    rules: [rule(uuid(410), ALDI, cat('lebensmittel'))],
  })
  ok('two patterns of one merchant are not a conflict',
     after.entries.every((e) => e.status === FINANCE_STATUS.RESOLVED))
  ok('…and they all point at the one merchant',
     after.entries.every((e) => e.merchantId === ALDI))
}

// ── 6. Two merchants, one booking: conflict, and no winner ──────────────────
{
  const A = uuid(70), B = uuid(71)
  const merchants = [merchant(A, 'Edeka'), merchant(B, 'Nahkauf')]
  const patterns = [
    pattern(uuid(330), A, 'exact_token', ['EDEKA']),
    pattern(uuid(331), B, 'exact_token', ['MARKT']),
  ]
  const tx = booking('EDEKA MARKT Troisdorf')

  const match = matchMerchant({ transaction: tx, patterns, merchants })
  ok('two merchants matching is a conflict', match.status === FINANCE_STATUS.CONFLICT)
  ok('…with no merchant chosen', match.merchantId === null)
  ok('…and both named', match.merchantIds.length === 2)

  const queue = buildClassificationQueue({
    transactions: [tx], patterns, merchants,
    rules: [rule(uuid(420), A, cat('lebensmittel')), rule(uuid(421), B, cat('lebensmittel'))],
  })
  ok('a conflict stays in the queue', queue.open.length === 1)
  ok('…as a conflict, not as "unknown"', queue.open[0].status === FINANCE_STATUS.CONFLICT)
  ok('…and no category is derived from it', queue.open[0].categoryId === null)
  ok('the summary counts it separately', queue.summary.konflikt === 1 && queue.summary.unbekannt === 0)

  // Saving a pattern that WOULD create such a conflict is allowed — but the
  // sheet has to say so first.
  const { segments } = descriptionSegments(tx)
  const built = buildLearnRequest({
    transaction: tx, selection: rangeTokens(segments, { from: 0, to: 0 }), patternType: 'exact_token',
    categorySlug: 'lebensmittel', categories: CATEGORIES, merchantId: A,
    transactions: [tx], patterns, overrides: [],
  })
  const numbers = backtestNumbers({ backtest: built.backtest, transaction: tx })
  const warnings = patternWarnings({ backtest: built.backtest, numbers, total: 1, merchantId: A })
  ok('a coming conflict is warned about', warnings.some((w) => w.text.includes('zwei Händlern')))

  // The identical pattern under another merchant is the one hard stop.
  const clash = buildLearnRequest({
    transaction: tx, selection: ['MARKT'], patternType: 'exact_token',
    categorySlug: 'lebensmittel', categories: CATEGORIES, merchantId: A,
    transactions: [tx], patterns, overrides: [],
  })
  const blocked = blockingConflict({ backtest: clash.backtest, merchants })
  ok('a pattern that already belongs to somebody else is refused',
     typeof blocked === 'string' && blocked.includes('Nahkauf'))
}

// ── 7. A damaged word may not become a rule ─────────────────────────────────
{
  const RC = String.fromCharCode(0xfffd)
  const tx = booking(\`Lo\${RC}e's Coffee Stu\${RC}gart\`)
  const { segments } = descriptionSegments(tx)

  const damaged = segments.filter((s) => !s.learnable).map((s) => s.token)
  ok('the fragments of the broken words are not offered',
     damaged.includes('LO') && damaged.includes('E') && damaged.includes('STU') && damaged.includes('GART'))
  ok('…while an intact word of the same booking stays offered',
     segments.find((s) => s.token === 'COFFEE')?.learnable === true)
  ok('a range containing a fragment is not learnable',
     rangeIsLearnable(segments, { from: 0, to: 0 }) === false)
  ok('…and one containing only intact words is',
     rangeIsLearnable(segments, { from: segments.findIndex((s) => s.token === 'COFFEE'), to: segments.findIndex((s) => s.token === 'COFFEE') }) === true)

  const refused = buildLearnRequest({
    transaction: tx, selection: ['LO'], patternType: 'exact_token',
    categorySlug: 'restaurant', categories: CATEGORIES, merchantName: 'Lotte',
    transactions: [tx], patterns: [], overrides: [],
  })
  ok('saving a fragment is refused', refused.valid === false)
  ok('…in a sentence a person can act on',
     learnErrorLines(refused.errors).some((m) => m.includes('nicht vollständig kodiert')))

  const allowed = buildLearnRequest({
    transaction: tx, selection: ['COFFEE'], patternType: 'exact_token',
    categorySlug: 'restaurant', categories: CATEGORIES, merchantName: 'Coffee',
    transactions: [tx], patterns: [], overrides: [],
  })
  ok('the intact word of the same booking can still be taught', allowed.valid === true)
}

// ── 8. A decision somebody made by hand is never overwritten ────────────────
{
  const locked = booking('REWE TROISDORF 1', { manual_lock: true })
  const overridden = booking('REWE TROISDORF 2')
  const assigned = booking('REWE TROISDORF 3', { merchant_id: uuid(80) })
  const open1 = booking('REWE TROISDORF 4')
  const open2 = booking('REWE TROISDORF 5')
  const transactions = [locked, overridden, assigned, open1, open2]
  const overrides = [{ transaction_id: overridden.id, category_id: cat('sonstige') }]

  const built = buildLearnRequest({
    transaction: open1, selection: ['REWE'], patternType: 'exact_token',
    categorySlug: 'lebensmittel', categories: CATEGORIES, merchantName: 'REWE',
    transactions, patterns: [], overrides,
  })

  ok('the backtest sees all five bookings', built.backtest.matchCount === 5)
  ok('…but only the two free ones may change',
     built.backtest.applicableTransactionIds.length === 2)
  ok('…the locked one is not among them',
     !built.backtest.applicableTransactionIds.includes(locked.id))
  ok('…nor the overridden one',
     !built.backtest.applicableTransactionIds.includes(overridden.id))
  ok('…nor the one that already has a merchant',
     !built.backtest.applicableTransactionIds.includes(assigned.id))
  ok('the request carries exactly the one other free booking',
     built.request.p_apply_transaction_ids.length === 1 &&
     built.request.p_apply_transaction_ids[0] === open2.id)

  const numbers = backtestNumbers({ backtest: built.backtest, transaction: open1 })
  ok('the preview promises two, not five', numbers.gesamt === 2)
  ok('…and says the other three stay as they are', numbers.unveraendert === 3)
  const lines = confirmationLines({
    numbers, patternLabel: 'REWE', merchantName: 'REWE', categoryName: 'Lebensmittel',
  })
  ok('the sentence about them is there',
     lines.some((l) => l.includes('unverändert') && l.includes('gesperrt oder bereits zugeordnet')))

  // Preview and request are the same set — the number the user reads is the
  // number the database is asked for.
  ok('preview count and requested count agree',
     numbers.gesamt === built.request.p_apply_transaction_ids.length + 1)

  const queue = buildClassificationQueue({ transactions, patterns: [], merchants: [], rules: [], overrides })
  ok('a locked booking is not asked about again',
     !queue.open.some((e) => e.transaction.id === locked.id))
  ok('…and neither is an overridden one',
     !queue.open.some((e) => e.transaction.id === overridden.id))
  ok('…while a merely assigned one is, because no pattern explains it',
     queue.open.some((e) => e.transaction.id === assigned.id))
}

// ── 9. The engine is the truth, not the column ──────────────────────────────
{
  const M = uuid(90)
  const merchants = [merchant(M, 'REWE')]
  const rules = [rule(uuid(430), M, cat('lebensmittel'))]

  // Written by an import, with no pattern behind it: the queue asks again.
  const stamped = booking('REWE TROISDORF', { merchant_id: M, category_id: cat('lebensmittel') })
  const withoutPattern = buildClassificationQueue({
    transactions: [stamped], patterns: [], merchants, rules,
  })
  ok('a stamped column without a pattern does not count as done',
     withoutPattern.open.length === 1)

  // Never stamped, but a pattern and a rule exist: done, without touching a row.
  const bare = booking('REWE TROISDORF')
  const withPattern = buildClassificationQueue({
    transactions: [bare], patterns: [pattern(uuid(340), M, 'exact_token', ['REWE'])], merchants, rules,
  })
  ok('a pattern alone is enough to be done', withPattern.open.length === 0)
  ok('…and it names the merchant and the category',
     withPattern.entries[0].merchantId === M &&
     withPattern.entries[0].categoryId === cat('lebensmittel'))

  // A deactivated pattern puts its bookings back in front of the user.
  const deactivated = { ...pattern(uuid(341), M, 'exact_token', ['REWE']), active: false }
  ok('a deactivated pattern reopens its bookings',
     buildClassificationQueue({ transactions: [bare], patterns: [deactivated], merchants, rules }).open.length === 1)
}

// ── 10. always_review, and the booking that belongs in no category ──────────
{
  const M = uuid(95)
  const merchants = [merchant(M, 'PayPal', { review_mode: 'always_review' })]
  const patterns = [pattern(uuid(350), M, 'exact_token', ['PAYPAL'])]
  const rules = [rule(uuid(440), M, cat('sonstige'))]
  const tx = booking('PayPal Europe S.a.r.l. et Cie S.C.A')

  const queue = buildClassificationQueue({ transactions: [tx], patterns, merchants, rules })
  ok('a merchant marked always_review keeps asking', queue.open.length === 1)
  ok('…as "zur Prüfung", not as unknown',
     queue.open[0].status === FINANCE_STATUS.REVIEW_REQUIRED)
  ok('…while the merchant itself is recognised', queue.open[0].merchantMatch.merchantId === M)
  ok('…and no category is silently applied', queue.open[0].categoryId === null)

  // „Später" moves past a booking without changing anything about it.
  const scalable = booking('Scalable Capital Verrechnungskonto')
  const all = { transactions: [tx, scalable], patterns, merchants, rules }
  const before = buildClassificationQueue(all)
  const after = buildClassificationQueue({ ...all, skippedIds: [scalable.id] })
  ok('skipping takes a booking out of this session\\'s queue',
     before.queue.length === 2 && after.queue.length === 1)
  ok('…but not out of the open count', after.open.length === 2)
  ok('…and changes nothing about the booking',
     JSON.stringify(after.entries.find((e) => e.transaction.id === scalable.id).transaction) ===
     JSON.stringify(scalable))
}

// ── 11. Warnings are warnings, never a hidden stopword list ─────────────────
{
  const transactions = []
  for (let i = 0; i < 20; i += 1) transactions.push(booking('MARKT Filiale ' + i))
  for (let i = 0; i < 10; i += 1) transactions.push(booking('Sonstiges ' + i))

  const built = buildLearnRequest({
    transaction: transactions[0], selection: ['MARKT'], patternType: 'exact_token',
    categorySlug: 'lebensmittel', categories: CATEGORIES, merchantName: 'Markt',
    transactions, patterns: [], overrides: [],
  })
  ok('a very generic word is NOT refused', built.valid === true)
  const numbers = backtestNumbers({ backtest: built.backtest, transaction: transactions[0] })
  const warnings = patternWarnings({ backtest: built.backtest, numbers, total: transactions.length })
  ok('…it is warned about, with the measured number',
     warnings.some((w) => w.text.includes('20 von 30')))
  ok('…and the word itself is still matched, not removed',
     built.backtest.matchCount === 20)

  // A narrow pattern gets no warning at all — same word, more of it.
  const single = booking('MARKT am Hafen Bremen')
  const withSingle = [...transactions, single]
  const narrow = buildLearnRequest({
    transaction: single, selection: ['MARKT', 'AM', 'HAFEN'], patternType: 'exact_phrase',
    categorySlug: 'lebensmittel', categories: CATEGORIES, merchantName: 'Markt am Hafen',
    transactions: withSingle, patterns: [], overrides: [],
  })
  ok('the more specific phrase hits exactly one booking', narrow.backtest.matchCount === 1)
  const narrowNumbers = backtestNumbers({ backtest: narrow.backtest, transaction: single })
  ok('a specific phrase raises no warning',
     patternWarnings({ backtest: narrow.backtest, numbers: narrowNumbers, total: withSingle.length }).length === 0)
}

// ── 12. The words after saving, and after failing ───────────────────────────
{
  const done = describeLearnResult(
    { applied_count: 4, transaction_updated: true, merchant_created: true },
    { merchantName: 'REWE', categoryName: 'Lebensmittel' }
  )
  ok('the result is read from the database, not from the preview', done.total === 5)
  ok('…and says so plainly', done.lines[0] === '5 Umsätze sind jetzt REWE · Lebensmittel.')
  ok('…and mentions a merchant that was created', done.lines.some((l) => l.includes('neu angelegt')))

  const protectedOne = describeLearnResult(
    { applied_count: 0, transaction_updated: false, merchant_created: false },
    { merchantName: 'REWE', categoryName: 'Lebensmittel' }
  )
  ok('a rule saved without touching the booking says that too',
     protectedOne.lines.some((l) => l.includes('behält deine eigene Zuordnung')))

  ok('a refusal from the database keeps its own sentence',
     describeLearnFailure({ message: 'finance: Muster REWE gehört bereits zu einem anderen Händler' })
       .includes('gehört bereits zu einem anderen Händler'))
  ok('…and anything else gets an honest fallback',
     describeLearnFailure({ code: '08006' }).includes('Es wurde nichts geändert'))
  // A PostgREST error carries the offending row in its details; none of it may
  // reach the screen.
  const leak = describeLearnFailure({
    message: 'duplicate key', details: 'Key (tokens)=(REWE TROISDORF SAGT DANKE 8407) already exists.',
  })
  ok('no booking text leaks out of an error object', !leak.includes('TROISDORF'))
}

// ── 13. The summary the Finanzen card prints ────────────────────────────────
{
  const M = uuid(96)
  const merchants = [merchant(M, 'REWE')]
  const patterns = [pattern(uuid(360), M, 'exact_token', ['REWE'])]
  const rules = [rule(uuid(450), M, cat('lebensmittel'))]
  const transactions = [
    booking('REWE 1'), booking('REWE 2'),
    booking('Unbekannt 1'), booking('Unbekannt 2'), booking('Unbekannt 3'),
    booking('Gesperrt', { manual_lock: true }),
  ]
  const { summary } = buildClassificationQueue({ transactions, patterns, merchants, rules })
  ok('the card counts what is open', summary.offen === 3)
  ok('…what is done', summary.zugeordnet === 2)
  ok('…what somebody decided by hand', summary.entschieden === 1)
  ok('…and the total', summary.gesamt === 6)
  ok('summarizeQueue agrees with the queue it came from',
     summarizeQueue(buildClassificationQueue({ transactions, patterns, merchants, rules }).entries).offen === 3)
  ok('needsDecision is the one definition of "open"',
     classifyTransaction({ transaction: transactions[2], patterns, merchants, rules }).status === FINANCE_STATUS.UNRESOLVED &&
     needsDecision(classifyTransaction({ transaction: transactions[2], patterns, merchants, rules })) === true)
}

// ── 14. The preview counts exactly what the RPC writes ─────────────────────
//
// REGRESSION. The booking in front of the user is updated by
// finance_learn_merchant_rule whenever it is not locked and has no override —
// an existing merchant_id does NOT stop that write. Counting it as unchanged
// promised one number and wrote another, and it did so precisely in the case
// this module is built for: a booking whose pattern was later deactivated is
// put back in front of the user with its old ids still in the row.
{
  const M = uuid(97)
  // Classified once, then the pattern was deactivated: the columns still hold
  // the old ids, and the engine has put the booking back in the queue.
  const stamped = booking('DM DROGERIEMARKT Troisdorf', {
    merchant_id: M, category_id: cat('sonstige'),
  })
  const free = booking('DM DROGERIEMARKT Frankfurt')
  const transactions = [stamped, free]

  const queue = buildClassificationQueue({
    transactions, patterns: [], merchants: [merchant(M, 'dm')], rules: [],
  })
  ok('a stamped booking without an active pattern is open again', queue.open.length === 2)

  const built = buildLearnRequest({
    transaction: stamped, selection: ['DM'], patternType: 'exact_token',
    categorySlug: 'drogerie', categories: CATEGORIES, merchantName: 'dm',
    transactions, patterns: [], overrides: [],
  })
  const numbers = backtestNumbers({ backtest: built.backtest, transaction: stamped })

  ok('the stamped booking counts as changing, because the RPC changes it',
     numbers.aktuelleAendertSich === true)
  // The other booking is swept up only when it has no merchant — that condition
  // the RPC does apply, and the backtest already mirrors it.
  ok('the free one is swept up too', built.request.p_apply_transaction_ids.length === 1)
  ok('the preview promises both', numbers.gesamt === 2)
  ok('…and nothing is claimed to stay unchanged', numbers.unveraendert === 0)
  // What the database will report back: applied_count for the others plus
  // transaction_updated for this one.
  ok('preview == applied_count + transaction_updated',
     numbers.gesamt === built.request.p_apply_transaction_ids.length + 1)

  // A second stamped booking IS protected from the sweep — the RPC requires
  // merchant_id is null there — so it must not be promised.
  const otherStamped = booking('DM DROGERIEMARKT Bonn', { merchant_id: M })
  const withOther = buildLearnRequest({
    transaction: stamped, selection: ['DM'], patternType: 'exact_token',
    categorySlug: 'drogerie', categories: CATEGORIES, merchantName: 'dm',
    transactions: [...transactions, otherStamped], patterns: [], overrides: [],
  })
  const otherNumbers = backtestNumbers({ backtest: withOther.backtest, transaction: stamped })
  ok('another stamped booking is a hit but not a change', otherNumbers.treffer === 3 && otherNumbers.gesamt === 2)
  ok('…and is named as staying unchanged', otherNumbers.unveraendert === 1)

  // Locked or overridden, the booking in hand does NOT change — the two
  // conditions the RPC really applies.
  const lockedOne = booking('DM DROGERIEMARKT Köln', { manual_lock: true })
  ok('a locked booking in hand does not change',
     backtestNumbers({
       backtest: built.backtest, transaction: lockedOne,
     }).aktuelleAendertSich === false)
  ok('an overridden booking in hand does not change either',
     backtestNumbers({
       backtest: built.backtest, transaction: stamped, override: { transaction_id: stamped.id },
     }).aktuelleAendertSich === false)
}

// ── 15. A conflict is decided, not out-patterned ────────────────────────────
//
// REGRESSION. The screen used to claim a more specific pattern would resolve a
// conflict. It would not: matchMerchant has no specificity ranking, so both
// claims survive and the booking stays in conflict forever.
{
  const A = uuid(71), B = uuid(72)
  const merchants = [merchant(A, 'Edeka'), merchant(B, 'Nahkauf')]
  const patterns = [
    pattern(uuid(370), A, 'exact_token', ['EDEKA']),
    pattern(uuid(371), B, 'exact_token', ['MARKT']),
  ]
  const tx = booking('EDEKA MARKT Troisdorf')

  const queue = buildClassificationQueue({ transactions: [tx], patterns, merchants, rules: [] })
  const entry = queue.open[0]
  ok('the decision is recognised as a conflict', decisionKindOf(entry) === DECISION.RESOLVE_CONFLICT)

  const explanation = decisionExplanation(entry, merchants)
  ok('…both claimants are named',
     explanation.lines.join(' ').includes('Edeka') && explanation.lines.join(' ').includes('Nahkauf'))
  ok('…and nothing claims a more specific pattern would help',
     !explanation.lines.join(' ').includes('genaueres Muster') &&
     !explanation.headline.includes('genaueres Muster'))
  ok('…it says only this booking is being decided',
     explanation.lines.join(' ').includes('nur diese eine Buchung'))
  ok('the claimants come out in a readable form',
     JSON.stringify(claimingMerchants(entry, merchants)) === JSON.stringify(['Edeka', 'Nahkauf']))

  // Proof that a third, more specific pattern really would NOT help.
  const specific = [...patterns, pattern(uuid(372), A, 'exact_phrase', ['EDEKA', 'MARKT'])]
  ok('a more specific pattern leaves the conflict exactly as it was',
     buildClassificationQueue({ transactions: [tx], patterns: specific, merchants, rules: [] })
       .open[0].status === FINANCE_STATUS.CONFLICT)

  // What does help: one decision about this one booking.
  const override = { transaction_id: tx.id, ...buildOverride({ merchantId: A, categoryId: cat('lebensmittel') }) }
  const after = buildClassificationQueue({
    transactions: [tx], patterns, merchants, rules: [], overrides: [override],
  })
  ok('after the decision the booking is settled', after.open.length === 0)
  ok('…as the merchant the user picked', after.entries[0].merchantId === A)
  ok('…in the category they picked', after.entries[0].categoryId === cat('lebensmittel'))
  ok('…and it is marked as decided by hand', after.entries[0].locked === true)
  ok('the two global patterns are untouched', patterns.length === 2 && patterns.every((p) => p.active))

  const said = describeOverrideResult({
    kind: DECISION.RESOLVE_CONFLICT, merchantName: 'Edeka', categoryName: 'Lebensmittel',
  })
  ok('the result says the rules were not changed',
     said.lines.some((l) => l.includes('an den gespeicherten Mustern hat sich nichts geändert')))
}

// ── 16. always_review is answered per booking, and stays always_review ──────
{
  const M = uuid(98)
  const merchants = [merchant(M, 'PayPal', { review_mode: 'always_review' })]
  const patterns = [pattern(uuid(380), M, 'exact_token', ['PAYPAL'])]
  const rules = [rule(uuid(460), M, cat('sonstige'))]
  const first = booking('PayPal Europe S.a.r.l. et Cie S.C.A 1052906804694')

  const queue = buildClassificationQueue({ transactions: [first], patterns, merchants, rules })
  const entry = queue.open[0]
  ok('a PayPal booking asks for a review', decisionKindOf(entry) === DECISION.REVIEW)
  const explanation = decisionExplanation(entry, merchants)
  ok('…the merchant is named as already recognised', explanation.headline.includes('PayPal'))
  ok('…and no new merchant is asked for',
     explanation.lines.join(' ').includes('nie automatisch gesetzt'))

  const override = { transaction_id: first.id, ...buildOverride({ merchantId: M, categoryId: cat('restaurant') }) }
  const after = buildClassificationQueue({
    transactions: [first], patterns, merchants, rules, overrides: [override],
  })
  ok('the decided booking leaves the queue', after.open.length === 0)
  ok('…with the chosen category', after.entries[0].categoryId === cat('restaurant'))

  // THE point of always_review: the next one is asked about again.
  const second = booking('PayPal Europe S.a.r.l. et Cie S.C.A 9999999999999')
  const next = buildClassificationQueue({
    transactions: [first, second], patterns, merchants, rules, overrides: [override],
  })
  ok('a new PayPal booking is asked about again', next.open.length === 1)
  ok('…and it is the new one', next.open[0].transaction.id === second.id)
  ok('…again as a review, not as unknown', next.open[0].status === FINANCE_STATUS.REVIEW_REQUIRED)
  ok('the merchant is still always_review',
     merchants[0].review_mode === 'always_review')
}

// ── 17. „Immer prüfen" reaches the database through the existing request ────
{
  const tx = booking('PayPal Europe S.a.r.l. et Cie S.C.A')
  const withMode = buildLearnRequest({
    transaction: tx, selection: ['PAYPAL'], patternType: 'exact_token',
    categorySlug: 'sonstige', categories: CATEGORIES, merchantName: 'PayPal',
    reviewMode: 'always_review', transactions: [tx], patterns: [], overrides: [],
  })
  ok('a new merchant can be created as always_review', withMode.valid === true)
  ok('…through the existing learn request, atomically',
     withMode.request.p_review_mode === 'always_review')
  ok('…with no second write of any kind',
     Object.keys(withMode.request).every((k) => k.startsWith('p_')))

  const withoutMode = buildLearnRequest({
    transaction: tx, selection: ['PAYPAL'], patternType: 'exact_token',
    categorySlug: 'sonstige', categories: CATEGORIES, merchantName: 'PayPal',
    transactions: [tx], patterns: [], overrides: [],
  })
  ok('switched off, no mode is sent at all', withoutMode.request.p_review_mode === null)

  // An EXISTING merchant is never changed from this screen: the request carries
  // no mode when one was picked by id.
  const M = uuid(99)
  const existing = buildLearnRequest({
    transaction: tx, selection: ['PAYPAL'], patternType: 'exact_token',
    categorySlug: 'sonstige', categories: CATEGORIES, merchantId: M,
    transactions: [tx], patterns: [], overrides: [],
  })
  ok('choosing an existing merchant sends no review mode',
     existing.request.p_merchant_id === M && existing.request.p_review_mode === null)
  ok('an unknown mode is refused rather than sent',
     buildLearnRequest({
       transaction: tx, selection: ['PAYPAL'], patternType: 'exact_token',
       categorySlug: 'sonstige', categories: CATEGORIES, merchantName: 'PayPal',
       reviewMode: 'irgendwas', transactions: [tx], patterns: [], overrides: [],
     }).valid === false)
}

console.log(\`finance classify: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeClassifyLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeClassifyLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
