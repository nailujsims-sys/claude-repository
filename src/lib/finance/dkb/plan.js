// From a reconciliation plan to the payload the database applies.
//
// `reconcileImport` produces a plan for a human to read: decisions with
// reasons, evidence, the groups it refused to split. `finance_apply_reconciliation_plan`
// needs a narrower thing — the bookings, one decision each, and the refund
// proposals — and it re-checks everything that matters anyway.
//
// So this module does two jobs and neither of them is interpretation:
//
//   1. It NARROWS. A booking goes over the wire with the eight fields the
//      database stores and nothing else; a refund candidate with the two ids
//      and the reference, not with the two full bookings the matcher carried
//      around. What the server does not read, the client does not send.
//
//   2. It REFUSES EARLY. Every check here is one the RPC makes again, in the
//      same order and with the same fail-closed answer. Doing it twice is not
//      redundancy for its own sake: a malformed plan should be caught before it
//      opens a transaction, and the error a user sees should say which booking
//      was wrong rather than quoting a constraint name.
//
// It writes nothing and decides nothing. Feeding it the same plan twice
// produces the same payload twice — the idempotency lives in the database,
// where a second caller cannot talk it out of it.

import { OUTCOMES } from './reconcile'

/** The fields `finance_transactions` actually stores, and no others. */
const BOOKING_FIELDS = [
  'booking_date',
  'value_date',
  'amount_minor',
  'currency',
  'raw_description',
  'external_reference',
  'normalized_tokens',
  'source_variant',
  'source_metadata',
]

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

const narrowBooking = (booking) => {
  const out = {}
  for (const field of BOOKING_FIELDS) {
    if (booking?.[field] !== undefined) out[field] = booking[field]
  }
  return out
}

/**
 * One side of a refund proposal, as an id or as a position in this import.
 *
 * `reconcileImport` describes each side with the whole matched booking so that
 * a preview can show it. The database only needs to know WHICH row: an existing
 * id, or the index of an arrival whose id it is about to create itself.
 */
const narrowSide = (side) => {
  if (!side || typeof side !== 'object') return null
  if (side.source === 'incoming' && Number.isInteger(side.index) && side.index >= 0) {
    return { source: 'incoming', index: side.index }
  }
  if (side.source === 'existing' && isUuid(side.id)) {
    return { source: 'existing', id: side.id }
  }
  return null
}

/**
 * Build the payload for `finance_apply_reconciliation_plan`.
 *
 * @param {{
 *   importId: string,
 *   accountId: string,
 *   bookings: Array<object>,
 *   plan: {decisions: Array<object>, refundCandidates?: Array<object>},
 * }} input
 * @returns {{import_id: string, account_id: string, bookings: Array<object>,
 *            decisions: Array<object>, refund_candidates: Array<object>}}
 */
export function buildApplyPayload({ importId, accountId, bookings, plan } = {}) {
  if (!isUuid(importId)) throw new Error('Import-ID fehlt oder ist keine UUID.')
  if (!isUuid(accountId)) throw new Error('Konto-ID fehlt oder ist keine UUID.')
  if (!Array.isArray(bookings)) throw new Error('Die Umsätze fehlen.')

  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : null
  if (decisions === null) throw new Error('Der Abgleich hat keine Entscheidungen geliefert.')
  if (decisions.length !== bookings.length) {
    throw new Error(
      `${decisions.length} Entscheidungen für ${bookings.length} Umsätze — der Plan passt nicht zu dieser Datei.`
    )
  }

  const seen = new Set()
  const narrowedDecisions = decisions.map((decision) => {
    const index = decision?.index
    if (!Number.isInteger(index) || index < 0 || index >= bookings.length) {
      throw new Error(`Die Entscheidung verweist auf den Umsatz ${index}, den es nicht gibt.`)
    }
    if (seen.has(index)) {
      throw new Error(`Für Umsatz ${index} gibt es mehr als eine Entscheidung.`)
    }
    seen.add(index)

    if (!OUTCOMES.includes(decision?.outcome)) {
      throw new Error(`Unbekannte Entscheidung "${decision?.outcome}" für Umsatz ${index}.`)
    }

    const ids = Array.isArray(decision.existing_ids) ? decision.existing_ids : []
    if (ids.some((id) => !isUuid(id))) {
      throw new Error(`Die Entscheidung für Umsatz ${index} nennt eine ungültige Buchungs-ID.`)
    }
    // The same rule the RPC enforces: "new" claims nothing, everything else
    // names at least the booking it is talking about.
    if (decision.outcome === 'new' && ids.length > 0) {
      throw new Error(`Umsatz ${index} gilt als neu, nennt aber vorhandene Buchungen.`)
    }
    if (decision.outcome !== 'new' && ids.length === 0) {
      throw new Error(`Umsatz ${index} gilt als "${decision.outcome}", nennt aber keine vorhandene Buchung.`)
    }

    return {
      index,
      outcome: decision.outcome,
      tier: Number.isInteger(decision.tier) ? decision.tier : null,
      existing_ids: ids,
      reason: typeof decision.reason === 'string' ? decision.reason : '',
      evidence: decision.evidence && typeof decision.evidence === 'object' ? decision.evidence : {},
    }
  })

  const candidates = Array.isArray(plan?.refundCandidates) ? plan.refundCandidates : []
  const narrowedCandidates = []
  for (const candidate of candidates) {
    const charge = narrowSide(candidate?.charge)
    const refund = narrowSide(candidate?.refund)
    // A side that cannot be named is a side the database cannot point at. The
    // proposal is dropped here rather than sent as a half-filled object; the
    // booking it would have referred to is already covered by its own decision.
    if (charge === null || refund === null) continue
    narrowedCandidates.push({
      reference: typeof candidate.reference === 'string' ? candidate.reference : null,
      charge,
      refund,
      reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    })
  }

  return {
    import_id: importId,
    account_id: accountId,
    bookings: bookings.map(narrowBooking),
    decisions: narrowedDecisions.sort((a, b) => a.index - b.index),
    refund_candidates: narrowedCandidates,
  }
}
