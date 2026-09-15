// Cross-import reconciliation, against fixtures of BOTH real exports.
//
// The first export alone could not answer what a second one does to the same
// booking; two overlapping exports can, and the fixtures here reproduce every
// relationship they showed — with invented content, because a bank statement
// does not belong in a repository.
//
// The assertions are again mostly about refusal. The case that decides the
// design is the pair of −60,65 € bookings: two provisional ones become two
// settled ones on the same day for the same amount, and NOTHING in either
// document says which settles which. A tidy 1:1 link would be a fabrication, so
// the pair is superseded as a pair and the test holds that line.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
import { reconcileImport, bookingFacts, OUTCOMES } from './src/lib/finance/dkb/reconcile.js'
import { extractReference } from './src/lib/finance/dkb/reference.js'
import { referenceDocument, secondExportDocument } from './tools/fixtures/dkbUmsatzexport.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// Export A, as it would sit in the database after the first import.
const A = parseDkbUmsatzexport(referenceDocument())
const B = parseDkbUmsatzexport(secondExportDocument())
ok('the first export parses', A.ok === true)
ok('the second export parses', B.ok === true)

const stored = A.transactions.map((t, i) => ({
  id: 'a' + i,
  booking_date: t.booking_date,
  amount_minor: t.amount_minor,
  currency: t.currency,
  raw_description: t.raw_description,
  manual_lock: false,
}))
const period = { start: B.header.period_start, end: B.header.period_end }
const run = (over = {}) => reconcileImport({ existing: stored, incoming: B.transactions, period, ...over })
const result = run()
const byIndex = (i) => result.decisions.find((d) => d.index === i)
const withOutcome = (o) => result.decisions.filter((d) => d.outcome === o)
const find = (list, needle) => list.findIndex((t) => t.raw_description.startsWith(needle))

// ── 1. The reference: position, not length ──────────────────────────────────
{
  ok('a reference after a slash is read',
     extractReference('DB.Vertrieb.GmbH/846301403175\\nIBAN DE96').reference === '846301403175')
  ok('…with its form named',
     extractReference('DB.Vertrieb.GmbH/846301403175').form === 'merchant_slash')
  ok('the announcement form is read',
     extractReference('DB Vertrieb GmbH 564851284265 DE').reference === '564851284265')
  ok('the PayPal form is read',
     extractReference('PayPal Europe\\nIBAN LU89\\n1052983361139/. Use AI').reference === '1052983361139')
  ok('an exchange rate is NOT a reference',
     extractReference('DAVINCI/WESTMINSTER\\nUmrechnungsrate: 1 Euro=1,15697680 USD') === null)
  ok('a 14-digit timestamp on its own line is NOT a reference',
     extractReference('DB.Vertrieb.GmbH\\n20260914132522 DB.Vertrieb.GmbH DE') === null)
  ok('a document number in prose is NOT a reference',
     extractReference('Verlag\\nIBAN DE82\\nBelegnummer: 267717044 / Kundennummer: 6102605') === null)
  ok('a booking without one says so', extractReference('Deutsche Bahn\\nIBAN DE96') === null)
  ok('a non-string is handled', extractReference(null) === null)
  ok('the parser records it', B.transactions.some((t) => t.source_metadata.reference === '508354771568'))
  ok('…and its form', B.transactions.some((t) => t.source_metadata.reference_form === 'merchant_slash'))
}

// ── 2. What the two exports say about each other ────────────────────────────
{
  ok('every incoming booking gets exactly one decision', result.decisions.length === B.transactions.length)
  ok('every outcome is a known one', result.decisions.every((d) => OUTCOMES.includes(d.outcome)))
  ok('nothing is left unresolved on real data', withOutcome('unresolved').length === 0)
  ok('nothing needs review without a manual decision', withOutcome('review').length === 0)
  ok('every stored booking in the period is accounted for', result.summary.unmatched_existing === 0)

  // The provisional bookings of the first export are all retired.
  const provisional = A.transactions.filter((t) => t.source_variant === 'timestamped_card')
  const supersededIds = new Set(
    result.decisions
      .filter((d) => d.outcome === 'supersedes' || d.outcome === 'supersedes_group')
      .flatMap((d) => d.existing_ids)
  )
  ok('the first export had provisional bookings', provisional.length === 4)
  ok('all of them are superseded', supersededIds.size === 4)
  ok('none of the superseded ones is a settled booking',
     [...supersededIds].every((id) => {
       const t = A.transactions[Number(id.slice(1))]
       return t.source_variant === 'timestamped_card'
     }))
  ok('the second export has no provisional booking left',
     B.transactions.every((t) => t.source_variant === 'standard'))
}

// ── 3. The pair that must stay a pair ───────────────────────────────────────
{
  const pair = result.decisions.filter((d) => d.outcome === 'supersedes_group')
  ok('both −60,65 bookings are decided as a group', pair.length === 2)
  ok('…and the group is reported once', result.groups.length === 1)
  ok('…with its cardinality preserved', result.groups[0].cardinality === 2)
  ok('…covering two stored bookings', result.groups[0].existing_ids.length === 2)
  ok('…and both incoming ones', result.groups[0].incoming_indexes.length === 2)
  ok('neither is given a single existing booking — that would be invented',
     pair.every((d) => d.existing_ids.length === 2))
  ok('both point at the SAME two, so no 1:1 link is implied',
     JSON.stringify(pair[0].existing_ids) === JSON.stringify(pair[1].existing_ids))
  ok('the reason says the assignment stays open',
     pair[0].reason.includes('Zuordnung bleibt offen'))

  // The point of the whole exercise: the amount is counted twice, not four
  // times and not once.
  const counted =
    stored.length -
    new Set(result.decisions.filter((d) => d.outcome.startsWith('supersedes')).flatMap((d) => d.existing_ids)).size +
    withOutcome('new').length +
    result.decisions.filter((d) => d.outcome.startsWith('supersedes')).length
  ok('after the import each booking counts exactly once',
     counted === stored.length - 4 + withOutcome('new').length + 4)
}

// ── 4. Richer text is the same booking, not a new one ───────────────────────
{
  const rewe = byIndex(find(B.transactions, 'REWE.Mohamed.Boufo'))
  ok('REWE with a richer text is recognised', rewe.outcome === 'enriched')
  ok('…via date, amount and card date', rewe.tier === 2)
  ok('…and points at the stored booking', rewe.existing_ids.length === 1)
  ok('…whose original text was the bare merchant',
     stored[Number(rewe.existing_ids[0].slice(1))].raw_description.startsWith('REWE\\n'))
  ok('…and stays untouched — the reason says so', rewe.reason.includes('unverändert'))

  const arena = byIndex(find(B.transactions, 'ARENA.GASTRO'))
  ok('the same holds for the arena booking', arena.outcome === 'enriched')
  ok('text alone never decided it', arena.tier === 2)

  ok('four bookings got a richer text', withOutcome('enriched').length === 4)
}

// ── 5. Word-for-word repeats are duplicates, and are not imported twice ─────
{
  const erika = byIndex(find(B.transactions, 'Erika Musterfrau'))
  ok('an identical booking is a duplicate', erika.outcome === 'duplicate')
  ok('…recognised without any reference or card date', erika.tier === 0)
  ok('three bookings repeat word for word', withOutcome('duplicate').length === 3)
}

// ── 6. The genuinely new one ────────────────────────────────────────────────
{
  const neu = byIndex(find(B.transactions, 'Scalable Capital'))
  ok('a booking nothing matches is new', neu.outcome === 'new')
  ok('…and claims no stored booking', neu.existing_ids.length === 0)
  ok('exactly one booking is new', withOutcome('new').length === 1)
}

// ── 7. The refund: a relation, never an identity ────────────────────────────
{
  ok('exactly one refund candidate is found', result.refundCandidates.length === 1)
  const candidate = result.refundCandidates[0]
  ok('…on the shared reference', candidate.reference === '564851284265')
  ok('…pairing a charge with a refund of the same size',
     candidate.charge.amountMinor === -5005 && candidate.refund.amountMinor === 5005)
  ok('…and says the reference is not an identity',
     candidate.reason.includes('kein Identitätsmerkmal'))

  // The evidence only exists in the newer text: the stored purchase is the bare
  // "Deutsche Bahn" of the first export and has no reference at all.
  const purchase = stored.find((s) => s.amount_minor === -5005)
  ok('the stored purchase carries no reference of its own',
     extractReference(purchase.raw_description) === null)
  ok('…so reading the stored row alone would have missed the refund',
     extractReference(purchase.raw_description) === null && result.refundCandidates.length === 1)

  // The same reference sits on both bookings — proving it cannot be a key.
  const refs = B.transactions.map((t) => t.source_metadata.reference).filter(Boolean)
  ok('the reference is not unique even inside one export',
     refs.length !== new Set(refs).size)
  ok('no refund link is written anywhere — it is a proposal',
     result.decisions.every((d) => d.evidence?.refunds_transaction_id === undefined))
}

// ── 8. A manual decision is never overwritten ───────────────────────────────
{
  const lockedStored = stored.map((s) =>
    s.raw_description.startsWith('REWE') ? { ...s, manual_lock: true } : s
  )
  const locked = reconcileImport({ existing: lockedStored, incoming: B.transactions, period })
  const rewe = locked.decisions.find((d) => d.index === find(B.transactions, 'REWE.Mohamed.Boufo'))
  ok('a locked booking is not silently enriched', rewe.outcome === 'review')
  ok('…and says why', rewe.reason.includes('manuelle Entscheidung'))
  ok('…and names the protected row', rewe.evidence.protected_ids.length === 1)

  const withOverride = reconcileImport({
    existing: stored,
    incoming: B.transactions,
    period,
    overrideTransactionIds: [stored.find((s) => s.raw_description.startsWith('REWE')).id],
  })
  const overridden = withOverride.decisions.find((d) => d.index === find(B.transactions, 'REWE.Mohamed.Boufo'))
  ok('an existing override protects the booking just as well', overridden.outcome === 'review')

  // …including a provisional booking that is about to be superseded.
  const lockedProvisional = stored.map((s) =>
    s.raw_description.includes('2026-09-12T17:06') ? { ...s, manual_lock: true } : s
  )
  const guarded = reconcileImport({ existing: lockedProvisional, incoming: B.transactions, period })
  ok('a locked provisional booking turns its group into a review',
     guarded.decisions.filter((d) => d.outcome === 'review').length === 2)
  ok('…and nothing is superseded behind the user\\'s back',
     guarded.groups.every((g) => g.outcome === 'review'))
}

// ── 9. Ambiguity is reported, never resolved by guessing ────────────────────
{
  // Two provisional bookings, one settled arrival: the cardinality does not add
  // up, so no supersede is claimed.
  const onlyOne = B.transactions.filter((t) => t.source_metadata.reference !== '198004303927')
  const mismatch = reconcileImport({ existing: stored, incoming: onlyOne, period })
  const survivor = mismatch.decisions.find((d) => d.index === onlyOne.findIndex((t) => t.amount_minor === -6065))
  ok('one settled booking against two provisional ones is unresolved',
     survivor.outcome === 'unresolved')
  ok('…and says what did not add up', survivor.reason.includes('keine eindeutige Ablösung'))
  ok('…and supersedes nothing', mismatch.groups.length === 0)

  // A booking outside the new export's period is not "missing" — the export
  // simply does not speak about it.
  ok('bookings before the period are never touched',
     result.decisions.every((d) => d.existing_ids.every((id) => {
       const t = A.transactions[Number(id.slice(1))]
       return t.booking_date >= '2026-09-10'
     })))
}

// ── 10. The facts a decision is built on ────────────────────────────────────
{
  const provisional = bookingFacts({
    booking_date: '2026-09-14', amount_minor: -6065, currency: 'EUR',
    raw_description: 'Deutsche Bahn\\nnull2026-09-12T17:06 Debitk. 0 2099-12 Zahl.System VISA De bit\\n(POS)',
  })
  ok('a provisional booking is recognised', provisional.variant === 'timestamped_card')
  ok('…and its card date is the day half of the timestamp', provisional.cardDate === '2026-09-12')
  ok('…the minute is deliberately not part of it', provisional.cardDate.length === 10)

  const settled = bookingFacts({
    booking_date: '2026-09-14', amount_minor: -6065, currency: 'EUR',
    raw_description: 'DB.Vertrieb.GmbH/508354771568\\nIBAN DE96\\nVISA Debitkartenumsatz vom 12.09.2026',
  })
  ok('a settled booking is recognised', settled.variant === 'standard')
  ok('…and states the same card date', settled.cardDate === provisional.cardDate)
  ok('…which is what lets the two be matched at all', settled.cardDate === '2026-09-12')
  ok('the facts come from the text, not from source_metadata',
     bookingFacts({ raw_description: 'DB.Vertrieb.GmbH/846301403175' }).reference === '846301403175')

  ok('an empty input does not throw', bookingFacts({}).variant === 'standard')
  ok('reconciling nothing against nothing is empty',
     reconcileImport({}).decisions.length === 0)
  ok('an import into an empty account is all new',
     reconcileImport({ existing: [], incoming: B.transactions }).summary.new === B.transactions.length)
}

// ── 11. What a hardening review found ───────────────────────────────────────
{
  const card = (merchant, vom) =>
    merchant + '\\nIBAN DE96 1203 0000 9005 2909 04\\nVISA Debitkartenumsatz vom ' + vom
  const prov = (ts) =>
    'Deutsche Bahn\\nnull' + ts + ' Debitk. 0 2099-12 Zahl.System VISA De bit\\n(POS)'
  const row = (id, date, amount, raw, over = {}) => ({
    id, booking_date: date, amount_minor: amount, currency: 'EUR',
    raw_description: raw, manual_lock: false, ...over,
  })
  const inc = (date, amount, raw, over = {}) => ({
    booking_date: date, amount_minor: amount, currency: 'EUR', raw_description: raw, ...over,
  })
  const span = { start: '2026-09-10', end: '2026-09-14' }

  // FINDING 1 (critical): an ambiguous tier fell through to "new", which would
  // import bookings that are already stored a second time.
  {
    const twice = reconcileImport({
      existing: [
        row('s1', '2026-09-10', -1438, card('REWE', '09.09.2026')),
        row('s2', '2026-09-10', -1438, card('REWE', '09.09.2026')),
      ],
      incoming: [
        inc('2026-09-10', -1438, card('REWE.Mohamed.Boufo/Frankfurt', '09.09.2026')),
        inc('2026-09-10', -1438, card('REWE.Mohamed.Boufo/Frankfurt', '09.09.2026')),
      ],
      period: span,
    })
    ok('two identical stored bookings are not imported a second time',
       twice.decisions.every((d) => d.outcome !== 'new'))
    ok('…they are recognised as the bookings they are',
       twice.decisions.every((d) => d.outcome === 'enriched'))
    ok('…and none is left over', twice.summary.unmatched_existing === 0)
  }

  // FINDING 2 (critical): a cardinality that does not add up must ask, not
  // invent a booking.
  {
    const lopsided = reconcileImport({
      existing: [
        row('s1', '2026-09-10', -1438, card('REWE', '09.09.2026')),
        row('s2', '2026-09-10', -1438, card('REWE', '09.09.2026')),
      ],
      incoming: [inc('2026-09-10', -1438, card('REWE.Mohamed.Boufo/Frankfurt', '09.09.2026'))],
      period: span,
    })
    ok('one incoming against two stored is unresolved', lopsided.decisions[0].outcome === 'unresolved')
    ok('…and never "new"', lopsided.decisions[0].outcome !== 'new')
    ok('…and names both candidates', lopsided.decisions[0].existing_ids.length === 2)
  }

  // FINDING 3 (critical): no account boundary existed at all.
  {
    const crossing = reconcileImport({
      existing: [row('fremd', '2026-09-10', -1438, card('REWE', '09.09.2026'), { account_id: 'konto-B' })],
      incoming: [inc('2026-09-10', -1438, card('REWE.Neu/Frankfurt', '09.09.2026'))],
      period: span,
      accountId: 'konto-A',
    })
    ok('a booking of another account is never matched', crossing.decisions[0].outcome === 'new')
    ok('…and claims nothing', crossing.decisions[0].existing_ids.length === 0)

    // A parsed booking carries no account of its own — it belongs to the one
    // being imported into. Before this was stamped on, stored rows (which do
    // have an account) and arrivals (which do not) could never share a key, so
    // every arrival came out as "new" and an import would have doubled every
    // booking it should have recognised.
    const stamped = reconcileImport({
      existing: [row('a1', '2026-09-10', -1438, card('REWE', '09.09.2026'), { account_id: 'konto-A' })],
      incoming: [inc('2026-09-10', -1438, card('REWE.Neu/Frankfurt', '09.09.2026'))],
      period: span,
      accountId: 'konto-A',
    })
    ok('an arrival is matched against the account it is imported into',
       stamped.decisions[0].outcome === 'enriched')
    ok('…and names the stored booking', stamped.decisions[0].existing_ids.join() === 'a1')

    // And when nobody says which account is being imported, a plan over
    // account-bearing bookings is refused rather than answered with all-new.
    let refused = null
    try {
      reconcileImport({
        existing: [row('a1', '2026-09-10', -1438, card('REWE', '09.09.2026'), { account_id: 'konto-A' })],
        incoming: [inc('2026-09-10', -1438, card('REWE.Neu/Frankfurt', '09.09.2026'))],
        period: span,
      })
    } catch (e) { refused = e.message }
    ok('an import without a named account is refused', refused !== null)

    const filtered = reconcileImport({
      existing: [
        row('a1', '2026-09-10', -1438, card('REWE', '09.09.2026'), { account_id: 'konto-A' }),
        row('b1', '2026-09-10', -1438, card('REWE', '09.09.2026'), { account_id: 'konto-B' }),
      ],
      incoming: [inc('2026-09-10', -1438, card('REWE.Neu/Frankfurt', '09.09.2026'), { account_id: 'konto-A' })],
      period: span,
      accountId: 'konto-A',
    })
    ok('an explicit account narrows the candidates', filtered.decisions[0].existing_ids.join() === 'a1')
    ok('…and the other account is not even considered', filtered.summary.unmatched_existing === 0)
  }

  // FINDING 4 (high): the plan depended on the order the rows arrived in.
  {
    const one = row('s1', '2026-09-14', 4500, 'Erika\\nIBAN DE40\\nGeschenk')
    const two = row('s2', '2026-09-14', 4500, 'Erika\\nIBAN DE40\\nGeschenk')
    const arrivals = [
      inc('2026-09-14', 4500, 'Erika\\nIBAN DE40\\nGeschenk'),
      inc('2026-09-14', 4500, 'Erika\\nIBAN DE40\\nGeschenk'),
    ]
    const forwards = reconcileImport({ existing: [one, two], incoming: arrivals })
    const backwards = reconcileImport({ existing: [two, one], incoming: arrivals })
    ok('the plan does not depend on the order of the stored rows',
       JSON.stringify(forwards.decisions) === JSON.stringify(backwards.decisions))
    ok('…and both bookings survive as two', forwards.decisions.length === 2)
    ok('…both recognised as already imported',
       forwards.decisions.every((d) => d.outcome === 'duplicate'))
    ok('…each claiming its own row',
       forwards.decisions[0].existing_ids.join() !== forwards.decisions[1].existing_ids.join())

    // The same for the incoming side.
    const swapped = reconcileImport({ existing: [one, two], incoming: [arrivals[1], arrivals[0]] })
    ok('nor on the order of the incoming rows',
       JSON.stringify(forwards.summary) === JSON.stringify(swapped.summary))
  }

  // FINDING 5 (medium): two bookings without an amount must not match on that.
  {
    const nothing = reconcileImport({
      existing: [row('x', '2026-09-10', null, 'Gleicher Text')],
      incoming: [inc('2026-09-10', null, 'Gleicher Text')],
    })
    ok('a missing amount is never a match', nothing.decisions[0].outcome === 'new')
    ok('…and claims nothing', nothing.decisions[0].existing_ids.length === 0)
  }
}

// ── 12. Repeated and chained imports ────────────────────────────────────────
{
  const card = (merchant, vom) =>
    merchant + '\\nIBAN DE96 1203 0000 9005 2909 04\\nVISA Debitkartenumsatz vom ' + vom
  const prov = (ts) =>
    'Deutsche Bahn\\nnull' + ts + ' Debitk. 0 2099-12 Zahl.System VISA De bit\\n(POS)'
  const row = (id, date, amount, raw) => ({
    id, booking_date: date, amount_minor: amount, currency: 'EUR', raw_description: raw, manual_lock: false,
  })
  const inc = (date, amount, raw) => ({
    booking_date: date, amount_minor: amount, currency: 'EUR', raw_description: raw,
  })

  // A → B, then B again: the second run must change nothing.
  {
    const stored2 = [
      row('p', '2026-09-14', -6065, prov('2026-09-12T17:06')),
      row('s', '2026-09-14', -6065, card('DB.Vertrieb.GmbH/508354771568', '12.09.2026')),
    ]
    const again = reconcileImport({
      existing: stored2,
      incoming: [inc('2026-09-14', -6065, card('DB.Vertrieb.GmbH/508354771568', '12.09.2026'))],
      period: { start: '2026-09-10', end: '2026-09-14' },
    })
    ok('re-importing the same export changes nothing', again.decisions[0].outcome === 'duplicate')
    ok('…it matches the settled row, not the provisional one',
       again.decisions[0].existing_ids.join() === 's')
    ok('…and supersedes nothing a second time', again.groups.length === 0)
  }

  // A → B → C: what B settled stays settled when C repeats it.
  {
    const afterB = [
      row('s1', '2026-09-14', -150, card('OEPA.VERKEHRSGESELLSCH/MUSTERSTADT', '13.09.2026')),
      row('s2', '2026-09-10', -1438, card('REWE', '09.09.2026')),
    ]
    const C = [
      inc('2026-09-14', -150, card('OEPA.VERKEHRSGESELLSCH/MUSTERSTADT', '13.09.2026')),
      inc('2026-09-10', -1438, card('REWE.Mohamed.Boufo/Frankfurt', '09.09.2026')),
      inc('2026-09-15', -999, card('NEU/IRGENDWO', '14.09.2026')),
    ]
    const third = reconcileImport({
      existing: afterB, incoming: C, period: { start: '2026-09-10', end: '2026-09-15' },
    })
    ok('a third export keeps what the second settled', third.decisions[0].outcome === 'duplicate')
    ok('…can still enrich what was never enriched', third.decisions[1].outcome === 'enriched')
    ok('…and adds only what is genuinely new', third.decisions[2].outcome === 'new')
    ok('…with nothing unresolved', third.summary.unresolved === 0)
  }

  // Partial overlap: a stored booking the new export does not cover is not
  // touched, and does not count as missing.
  {
    const partial = reconcileImport({
      existing: [
        row('alt', '2026-09-07', -454, card('EDEKA', '04.09.2026')),
        row('neu', '2026-09-12', -1000, card('REWE', '11.09.2026')),
      ],
      incoming: [inc('2026-09-12', -1000, card('REWE.Filiale/Koeln', '11.09.2026'))],
      period: { start: '2026-09-10', end: '2026-09-14' },
    })
    ok('a booking before the period is out of scope', partial.summary.unmatched_existing === 0)
    ok('…and is never claimed',
       partial.decisions.every((d) => !d.existing_ids.includes('alt')))
    ok('the overlapping one is recognised', partial.decisions[0].outcome === 'enriched')
  }

  // Genuinely repeated spending: two real bookings, twice, stay four.
  {
    const doubled = reconcileImport({
      existing: [
        row('d1', '2026-09-12', -500, card('BAECKER/KOELN', '11.09.2026')),
        row('d2', '2026-09-12', -500, card('BAECKER/KOELN', '11.09.2026')),
      ],
      incoming: [
        inc('2026-09-12', -500, card('BAECKER/KOELN', '11.09.2026')),
        inc('2026-09-12', -500, card('BAECKER/KOELN', '11.09.2026')),
      ],
      period: { start: '2026-09-10', end: '2026-09-14' },
    })
    ok('two equal bookings stay two, not one', doubled.decisions.length === 2)
    ok('…both already known', doubled.decisions.every((d) => d.outcome === 'duplicate'))
    ok('…and neither is imported again', doubled.summary.new === 0)
  }

  // Currency is part of every key.
  {
    const currencies = reconcileImport({
      existing: [{ id: 'usd', booking_date: '2026-09-12', amount_minor: -500, currency: 'USD', raw_description: card('BAECKER/KOELN', '11.09.2026'), manual_lock: false }],
      incoming: [inc('2026-09-12', -500, card('BAECKER/KOELN', '11.09.2026'))],
      period: { start: '2026-09-10', end: '2026-09-14' },
    })
    ok('a booking in another currency is never the same booking',
       currencies.decisions[0].outcome === 'new')
  }
}

console.log(\`dkb reconcile: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'dkbReconcileLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/dkbReconcileLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
