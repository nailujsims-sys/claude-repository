import { FINANCE_STATUS } from './merchantMatching'
import { newestSuggestions, resolveEffectiveClassification } from './effectiveClassification'

// Which bookings still need a human, and which do not.
//
// THE ONE RULE THIS FILE IS BUILT ON: the pattern and rule engine is the truth,
// not the `merchant_id` column. A booking is "done" because a pattern matches it
// and a rule covers it — never because an import happened to write an id into a
// row. The two are usually the same, and where they are not, the engine is
// right: a pattern the user deactivated must put its bookings back in front of
// them, and a booking that was imported before the rule existed must disappear
// from the queue the moment the rule does exist, without anybody touching the
// row.
//
// That separation is what lets the importer and the classification stay two
// responsibilities. The importer writes what the bank said. This decides what it
// means, every time it is asked, from rows the user can see and change.
//
// SINCE v1.23 THERE IS A THIRD OPINION — the AI import's suggestion — and it is
// deliberately NOT resolved here. The whole ladder (override → manual_lock →
// the user's own rules → a complete, unflagged AI suggestion → open) lives in
// src/lib/finance/effectiveClassification.js, so that every screen asking "is
// this booking done?" gets the same answer from the same place. This file is
// what it always was: the queue built on top of that answer — ordering,
// skipping, counting.
//
// Pure functions over rows — no React, no Supabase. The caller loads.

/**
 * One booking, run through both halves of the engine.
 *
 * @param {{
 *   transaction: object,
 *   patterns?: Array<object>,
 *   merchants?: Array<object>,
 *   rules?: Array<object>,
 *   override?: object|null,
 *   suggestion?: object|null,
 * }} input
 * @returns {{
 *   transaction: object, merchantMatch: object, category: object,
 *   status: string, merchantStatus: string, locked: boolean,
 *   merchantId: string|null, categoryId: string|null, reason: string|null,
 *   source: string|null, aiSuggestion: object|null, aiMerchantName: string|null,
 *   needsDecision: boolean,
 * }}
 */
export function classifyTransaction({
  transaction,
  patterns = [],
  merchants = [],
  rules = [],
  override = null,
  suggestion = null,
} = {}) {
  return resolveEffectiveClassification({
    transaction, patterns, merchants, rules, override, suggestion,
  })
}

/**
 * Does this booking still need a decision?
 *
 * One line, and it reads an answer rather than computing one: the ladder in
 * effectiveClassification.js has already weighed the override, the manual lock,
 * the user's own rules and the AI suggestion against each other. Re-deriving
 * "open" from `status` and `locked` here would be a second definition of the
 * same word, and the two would drift.
 */
export const needsDecision = (entry) => entry.needsDecision === true

// Newest first, id as the tiebreak — the order the transaction list already
// uses, and one that does not change when the database returns rows differently.
const byDate = (a, b) =>
  String(b.transaction.booking_date ?? '').localeCompare(String(a.transaction.booking_date ?? '')) ||
  String(a.transaction.id).localeCompare(String(b.transaction.id))

/**
 * Every booking classified, and the ones that still need a human, in order.
 *
 * `skippedIds` are the bookings the user pushed to the back with „Später" in
 * this session. They are deliberately NOT persisted and not removed from the
 * counts: skipping changes nothing about the booking, it only changes what the
 * sheet shows next.
 *
 * @param {{
 *   transactions?: Array<object>, patterns?: Array<object>, merchants?: Array<object>,
 *   rules?: Array<object>, overrides?: Array<object>, aiSuggestions?: Array<object>,
 *   skippedIds?: Array<string>|Set<string>,
 * }} input
 */
export function buildClassificationQueue({
  transactions = [],
  patterns = [],
  merchants = [],
  rules = [],
  overrides = [],
  aiSuggestions = [],
  skippedIds = [],
} = {}) {
  const overrideByTransaction = new Map(
    overrides.filter((o) => o?.transaction_id).map((o) => [o.transaction_id, o])
  )
  const suggestionByTransaction = newestSuggestions(aiSuggestions)
  const skipped = skippedIds instanceof Set ? skippedIds : new Set(skippedIds)

  const entries = transactions.map((transaction) =>
    classifyTransaction({
      transaction,
      patterns,
      merchants,
      rules,
      override: overrideByTransaction.get(transaction?.id) ?? null,
      suggestion: suggestionByTransaction.get(transaction?.id) ?? null,
    })
  )

  const open = entries.filter(needsDecision).sort(byDate)

  return {
    entries,
    // What the card counts: everything that needs a human, skipped or not.
    open,
    // What the sheet walks through next: the same list minus what was pushed
    // back in this session.
    queue: open.filter((entry) => !skipped.has(entry.transaction?.id)),
    summary: summarizeQueue(entries),
  }
}

/**
 * The numbers the Finanzen card shows.
 *
 * `offen` is the one that matters — the rest exist so a screen never has to
 * count statuses itself and invent a different definition of "open".
 */
export function summarizeQueue(entries = []) {
  const count = (predicate) => entries.filter(predicate).length
  const open = entries.filter(needsDecision)
  return {
    gesamt: entries.length,
    offen: open.length,
    unbekannt: open.filter((e) => e.status === FINANCE_STATUS.UNRESOLVED).length,
    konflikt: open.filter((e) => e.status === FINANCE_STATUS.CONFLICT).length,
    pruefung: open.filter((e) => e.status === FINANCE_STATUS.REVIEW_REQUIRED).length,
    zugeordnet: count((e) => e.status === FINANCE_STATUS.RESOLVED),
    entschieden: count((e) => e.locked),
    // Wie viele davon der KI-Vorschlag getragen hat. Nicht für die Warteschlange
    // — die zählt `offen` — sondern damit ein Screen sagen kann, worauf die
    // Einordnung eigentlich beruht.
    ki: count((e) => e.source === 'ai_suggestion'),
  }
}
