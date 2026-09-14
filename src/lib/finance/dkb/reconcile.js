// Reconciling a new export against what is already stored.
//
// This is the step the first export could not decide, because one file cannot
// show what a later one does to the same booking. Two real exports can, and
// they settle three things:
//
//   1. A booking that was provisional in the first export comes back settled in
//      the second, with a completely different text: "Deutsche Bahn" + an ISO
//      timestamp becomes "DB.Vertrieb.GmbH/474717313729" + a card date. Counting
//      both would double the spending.
//   2. A booking that was already settled can come back RICHER: "REWE" becomes
//      "REWE.Mohamed.Boufo/Frankfurt", "EDEKA" becomes "EDEKA.FLECK/STUTTGART".
//      The same booking, a better text. So text is not identity.
//   3. The reference is not a transaction id. `564851284265` sits on the
//      −50,05 € purchase and on the +50,05 € refund of it. It is evidence that
//      two bookings belong together, and nothing more.
//
// WHAT THIS MODULE REFUSES TO DO. The two −60,65 € bookings of 14.09. are the
// case that decides the design: two provisional ones in the first export, two
// settled ones in the second, same amount, same day, same card date — and the
// only distinguishing marks (the minute in one export, the reference in the
// other) exist on one side each, never on both. Which settles which is NOT in
// the documents. So the pair is superseded AS A PAIR, with its cardinality
// preserved, and no individual link is invented. A guessed 1:1 assignment would
// look tidier and be a fabrication.
//
// It is pure: it decides nothing about the database and writes nothing. The
// result is a plan a preview can show and a human can confirm.

import { CARD_DATE_PATTERN, CARD_SYSTEM_MARKER, CARD_TIMESTAMP_PATTERN } from './layout'
import { parseGermanDate } from './amount'
import { extractReference } from './reference'

/** What one incoming booking turned out to be. */
export const OUTCOMES = [
  'new',
  'duplicate',
  'enriched',
  'supersedes',
  'supersedes_group',
  'unresolved',
  'review',
]

/**
 * Everything a decision may look at, derived from the booking itself.
 *
 * Deliberately derived from `raw_description` and the stored columns rather
 * than from `source_metadata`: a row read back from the database carries
 * whatever the import wrote into a jsonb column, and a matcher that depends on
 * that shape breaks the day the shape changes. The text is frozen by the
 * database trigger, so deriving from it is the stable choice.
 *
 * @param {{booking_date?: string, amount_minor?: number, currency?: string, raw_description?: string}} booking
 */
export function bookingFacts(booking) {
  const raw = typeof booking?.raw_description === 'string' ? booking.raw_description : ''
  const timestamp = CARD_TIMESTAMP_PATTERN.exec(raw)
  const settledCardDate = CARD_DATE_PATTERN.exec(raw)
  const reference = extractReference(raw)
  return {
    bookingDate: booking?.booking_date ?? null,
    amountMinor: booking?.amount_minor ?? null,
    currency: booking?.currency ?? null,
    raw,
    variant:
      timestamp && raw.includes(CARD_SYSTEM_MARKER) ? 'timestamped_card' : 'standard',
    // The card's own transaction date, from whichever form states it. The
    // settled booking prints a date, the provisional one an ISO timestamp whose
    // date half is the same day — that is what lets the two be recognised as
    // one booking. The time of day exists only in the provisional form, so it
    // can never be part of a match.
    cardDate: settledCardDate
      ? parseGermanDate(settledCardDate[1])
      : timestamp
        ? timestamp[0].slice(0, 10)
        : null,
    reference: reference ? reference.reference : null,
    referenceForm: reference ? reference.form : null,
  }
}

const sameMoney = (a, b) => a.amountMinor === b.amountMinor && a.currency === b.currency
const protectedBooking = (booking, overrides) =>
  booking?.manual_lock === true || overrides.has(booking?.id)

/**
 * Reconcile one parsed export against the bookings already stored.
 *
 * @param {{
 *   existing?: Array<object>,
 *   incoming?: Array<object>,
 *   overrideTransactionIds?: string[],
 *   period?: {start: string|null, end: string|null}|null,
 * }} input
 * @returns {{
 *   decisions: Array<object>,
 *   groups: Array<object>,
 *   refundCandidates: Array<object>,
 *   summary: Record<string, number>,
 * }}
 */
export function reconcileImport({
  existing = [],
  incoming = [],
  overrideTransactionIds = [],
  period = null,
} = {}) {
  const overrides = new Set(overrideTransactionIds)

  // Only what the new export could possibly speak about. A booking outside its
  // period is not absent from it — it was never in scope, and treating it as
  // missing would be reading a statement for something it does not say.
  const inScope = existing.filter((booking) => {
    if (!period?.start || !period?.end) return true
    return booking?.booking_date >= period.start && booking?.booking_date <= period.end
  })

  const stored = inScope.map((booking) => ({
    booking,
    facts: bookingFacts(booking),
    claimed: false,
  }))
  const arrivals = incoming.map((booking, index) => ({
    booking,
    index,
    facts: bookingFacts(booking),
    decision: null,
  }))

  const decide = (arrival, outcome, tier, matches, reason, evidence = {}) => {
    for (const match of matches) match.claimed = true
    arrival.decision = {
      index: arrival.index,
      outcome,
      tier,
      existing_ids: matches.map((m) => m.booking?.id ?? null),
      reason,
      evidence,
    }
  }

  // A stored booking somebody decided by hand is never quietly re-labelled by
  // an import. The match is still reported — the human has to see it — but as
  // `review`, with the decision untouched.
  const guard = (arrival, outcome, tier, matches, reason, evidence) => {
    const locked = matches.filter((m) => protectedBooking(m.booking, overrides))
    if (locked.length > 0) {
      decide(arrival, 'review', tier, matches,
        `${reason} — die vorhandene Buchung trägt eine manuelle Entscheidung und bleibt unverändert.`,
        { ...evidence, protected_ids: locked.map((m) => m.booking?.id ?? null) })
      return
    }
    decide(arrival, outcome, tier, matches, reason, evidence)
  }

  const open = () => stored.filter((s) => !s.claimed)

  // ── Tier 0: the same booking, exported again, letter for letter ───────────
  // Multiset-aware: two genuinely identical bookings claim two stored ones, not
  // one twice. That is the whole reason this walks arrivals one at a time
  // instead of grouping by key.
  for (const arrival of arrivals) {
    const candidates = open().filter(
      (s) =>
        s.facts.bookingDate === arrival.facts.bookingDate &&
        sameMoney(s.facts, arrival.facts) &&
        s.facts.raw === arrival.facts.raw
    )
    if (candidates.length > 0) {
      guard(arrival, 'duplicate', 0, [candidates[0]],
        'Wortgleich bereits importiert.', { key: 'date+amount+text' })
    }
  }

  // ── Tier 1: the reference, never on its own ──────────────────────────────
  for (const arrival of arrivals) {
    if (arrival.decision || arrival.facts.reference === null) continue
    const candidates = open().filter(
      (s) =>
        // Same form on both sides. A provisional booking that comes back
        // settled shares a reference with its successor, and calling that
        // "enriched" would keep the provisional row — while its six siblings
        // get replaced. It belongs in tier 3, where all seven are treated
        // alike.
        s.facts.variant === arrival.facts.variant &&
        s.facts.bookingDate === arrival.facts.bookingDate &&
        sameMoney(s.facts, arrival.facts) &&
        s.facts.reference === arrival.facts.reference
    )
    if (candidates.length === 1) {
      const enriched = candidates[0].facts.raw !== arrival.facts.raw
      guard(arrival, enriched ? 'enriched' : 'duplicate', 1, candidates,
        enriched
          ? 'Dieselbe Buchung mit ausführlicherem Text; das Original bleibt unverändert.'
          : 'Bereits importiert, über Datum, Betrag und Referenz erkannt.',
        { key: 'date+amount+reference', reference: arrival.facts.reference })
    } else if (candidates.length > 1) {
      decide(arrival, 'unresolved', 1, [],
        `Die Referenz ${arrival.facts.reference} passt auf ${candidates.length} vorhandene Buchungen — das reicht für keine Zuordnung.`,
        { key: 'date+amount+reference', candidate_ids: candidates.map((c) => c.booking?.id ?? null) })
    }
  }

  // ── Tier 2: settled ↔ settled, the text got richer ───────────────────────
  for (const arrival of arrivals) {
    if (arrival.decision) continue
    if (arrival.facts.variant !== 'standard' || arrival.facts.cardDate === null) continue
    const candidates = open().filter(
      (s) =>
        s.facts.variant === 'standard' &&
        s.facts.bookingDate === arrival.facts.bookingDate &&
        sameMoney(s.facts, arrival.facts) &&
        s.facts.cardDate === arrival.facts.cardDate
    )
    if (candidates.length === 1) {
      const enriched = candidates[0].facts.raw !== arrival.facts.raw
      guard(arrival, enriched ? 'enriched' : 'duplicate', 2, candidates,
        enriched
          ? 'Dieselbe Buchung mit ausführlicherem Text; das Original bleibt unverändert.'
          : 'Bereits importiert, über Datum, Betrag und Kartendatum erkannt.',
        { key: 'date+amount+card_date', card_date: arrival.facts.cardDate })
    }
    // More than one candidate is deliberately left to the group step below.
  }

  // ── Tier 3: a provisional booking comes back settled ──────────────────────
  // Grouped by what both forms actually share: the amount, the currency and the
  // card's transaction date. The minute exists only in the provisional text,
  // the reference only in the settled one — so neither can carry the match.
  const groups = []
  const supersedeKey = (facts) => `${facts.amountMinor}|${facts.currency}|${facts.cardDate ?? '-'}`

  const provisionalByKey = new Map()
  for (const s of open()) {
    if (s.facts.variant !== 'timestamped_card') continue
    const key = supersedeKey(s.facts)
    if (!provisionalByKey.has(key)) provisionalByKey.set(key, [])
    provisionalByKey.get(key).push(s)
  }

  for (const [key, provisionals] of provisionalByKey) {
    const settled = arrivals.filter(
      (a) => !a.decision && a.facts.variant === 'standard' && supersedeKey(a.facts) === key
    )
    if (settled.length === 0) continue

    if (provisionals.length === 1 && settled.length === 1) {
      guard(settled[0], 'supersedes', 3, provisionals,
        'Löst die vorgemerkte Buchung ab; sie zählt danach nicht mehr in der Auswertung.',
        { key: 'amount+currency+card_date', card_date: settled[0].facts.cardDate })
      continue
    }

    if (provisionals.length === settled.length) {
      // Equal cardinality: the group is superseded by the group. Which one
      // settles which is not in either document, so it is not decided here.
      const locked = provisionals.filter((p) => protectedBooking(p.booking, overrides))
      for (const s of settled) {
        s.decision = {
          index: s.index,
          outcome: locked.length > 0 ? 'review' : 'supersedes_group',
          tier: 3,
          existing_ids: provisionals.map((p) => p.booking?.id ?? null),
          reason:
            locked.length > 0
              ? `${settled.length} abgerechnete Buchungen lösen ${provisionals.length} vorgemerkte ab, von denen mindestens eine manuell entschieden wurde — bitte prüfen.`
              : `${settled.length} abgerechnete Buchungen lösen ${provisionals.length} vorgemerkte gleichen Betrags und Kartendatums ab. Welche zu welcher gehört, steht in keinem der Auszüge — die Zuordnung bleibt offen, die Anzahl stimmt.`,
          evidence: {
            key: 'amount+currency+card_date',
            cardinality: settled.length,
            protected_ids: locked.map((p) => p.booking?.id ?? null),
          },
        }
      }
      for (const p of provisionals) p.claimed = true
      groups.push({
        outcome: locked.length > 0 ? 'review' : 'supersedes_group',
        incoming_indexes: settled.map((s) => s.index),
        existing_ids: provisionals.map((p) => p.booking?.id ?? null),
        cardinality: settled.length,
        card_date: provisionals[0].facts.cardDate,
        amount_minor: provisionals[0].facts.amountMinor,
      })
      continue
    }

    // Different cardinality: something is missing or extra on one side, and
    // guessing which is exactly what must not happen here.
    for (const s of settled) {
      s.decision = {
        index: s.index,
        outcome: 'unresolved',
        tier: 3,
        existing_ids: provisionals.map((p) => p.booking?.id ?? null),
        reason: `${settled.length} abgerechnete gegen ${provisionals.length} vorgemerkte Buchungen gleichen Betrags — das ergibt keine eindeutige Ablösung.`,
        evidence: { key: 'amount+currency+card_date', incoming: settled.length, existing: provisionals.length },
      }
    }
  }

  // ── Tier 3, second route: the settled form without a card date ────────────
  // The +50,05 € refund of the real export prints no "vom" line, only a
  // timestamp — its link to the provisional announcement is the reference, and
  // the reference is only trusted here because the amount and currency match
  // too.
  for (const arrival of arrivals) {
    if (arrival.decision || arrival.facts.reference === null) continue
    const candidates = open().filter(
      (s) =>
        s.facts.variant === 'timestamped_card' &&
        sameMoney(s.facts, arrival.facts) &&
        s.facts.reference === arrival.facts.reference
    )
    if (candidates.length === 1) {
      guard(arrival, 'supersedes', 3, candidates,
        'Löst die vorgemerkte Buchung ab, erkannt über Betrag und gemeinsame Referenz.',
        { key: 'amount+currency+reference', reference: arrival.facts.reference })
    }
  }

  // ── Tier 4: everything left over is new ──────────────────────────────────
  for (const arrival of arrivals) {
    if (arrival.decision) continue
    arrival.decision = {
      index: arrival.index,
      outcome: 'new',
      tier: 4,
      existing_ids: [],
      reason: 'Keine vorhandene Buchung passt — neu.',
      evidence: {},
    }
  }

  // ── Refunds: a relation, deliberately not an identity ─────────────────────
  // Two bookings that share a reference and cancel each other out are a refund
  // and its purchase. This is reported as a candidate for the user to confirm:
  // finance_transactions.refunds_transaction_id only accepts a row that is
  // typed as a refund, and typing a booking is a human decision.
  //
  // Built over the bookings that will actually EXIST after this import, not
  // over both files laid on top of each other. Otherwise the announcement that
  // is about to be superseded and the settled booking that supersedes it both
  // appear, and one economic refund is proposed twice.
  const refundCandidates = []
  const byReference = new Map()
  const note = (facts, source, id, index) => {
    if (facts.reference === null) return
    if (!byReference.has(facts.reference)) byReference.set(facts.reference, [])
    byReference.get(facts.reference).push({ source, id, index, amountMinor: facts.amountMinor, facts })
  }
  // One entry per booking that will exist afterwards — and each one described
  // by the BEST text available for it, which is not always the stored one.
  //
  // The real exports make that distinction matter rather than academic: the
  // −50,05 € purchase is stored as the bare "Deutsche Bahn" of the first
  // export and carries no reference at all. Its reference — the only thing
  // linking it to the +50,05 € refund — appears solely in the richer text of
  // the second export, which the database will never hold, because the
  // original is frozen. Reading the relation off the stored row alone would
  // miss it entirely.
  const supersededIds = new Set(
    arrivals
      .filter((a) => a.decision?.outcome === 'supersedes' || a.decision?.outcome === 'supersedes_group')
      .flatMap((a) => a.decision.existing_ids)
  )
  const matchedExistingIds = new Set(
    arrivals
      .filter((a) => a.decision?.outcome === 'duplicate' || a.decision?.outcome === 'enriched')
      .flatMap((a) => a.decision.existing_ids)
  )

  for (const s of stored) {
    const id = s.booking?.id ?? null
    if (supersededIds.has(id) || matchedExistingIds.has(id)) continue
    note(s.facts, 'existing', id, null)
  }
  for (const a of arrivals) {
    const outcome = a.decision?.outcome
    if (outcome === 'duplicate' || outcome === 'enriched') {
      // The stored booking stays; this arrival only describes it better.
      note(a.facts, 'existing', a.decision.existing_ids[0] ?? null, a.index)
      continue
    }
    if (outcome === 'unresolved' || outcome === 'review') continue
    note(a.facts, 'incoming', null, a.index)
  }

  for (const [reference, entries] of byReference) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const one = entries[i]
        const other = entries[j]
        if (one.amountMinor !== -other.amountMinor) continue
        if (one.amountMinor === 0) continue
        refundCandidates.push({
          reference,
          charge: one.amountMinor < 0 ? one : other,
          refund: one.amountMinor < 0 ? other : one,
          reason:
            'Gleiche Referenz, entgegengesetzter Betrag — sehr wahrscheinlich Kauf und Retoure. ' +
            'Die Referenz ist dabei kein Identitätsmerkmal: sie steht auf beiden Buchungen.',
        })
      }
    }
  }

  const decisions = arrivals.map((a) => a.decision)
  const summary = {}
  for (const outcome of OUTCOMES) summary[outcome] = 0
  for (const decision of decisions) summary[decision.outcome] += 1
  summary.refund_candidates = refundCandidates.length
  summary.unmatched_existing = open().length

  return { decisions, groups, refundCandidates, summary }
}
