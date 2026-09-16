import { FINANCE_STATUS, matchMerchant } from './merchantMatching'
import { resolveCategory } from './categoryRules'

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
 * }} input
 * @returns {{
 *   transaction: object, merchantMatch: object, category: object,
 *   status: string, merchantStatus: string, locked: boolean,
 *   merchantId: string|null, categoryId: string|null, reason: string|null,
 * }}
 */
export function classifyTransaction({
  transaction,
  patterns = [],
  merchants = [],
  rules = [],
  override = null,
} = {}) {
  const merchantMatch = matchMerchant({ transaction, patterns, merchants })
  const category = resolveCategory({ transaction, merchantMatch, rules, override })
  return {
    transaction,
    merchantMatch,
    category,
    status: category.status,
    merchantStatus: merchantMatch.status,
    locked: category.locked === true,
    merchantId: category.merchantId ?? merchantMatch.merchantId ?? null,
    categoryId: category.categoryId ?? null,
    reason: category.reason ?? null,
  }
}

/**
 * Does this booking still need a decision?
 *
 * A locked booking never does — somebody already decided it by hand, and the
 * queue is not a place to ask them again. A resolved booking never does either.
 * What is left is the honest three: nothing matched, two merchants matched, or
 * the merchant is one the user asked to see every time.
 */
export const needsDecision = (entry) =>
  !entry.locked && entry.status !== FINANCE_STATUS.RESOLVED

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
 *   rules?: Array<object>, overrides?: Array<object>, skippedIds?: Array<string>|Set<string>,
 * }} input
 */
export function buildClassificationQueue({
  transactions = [],
  patterns = [],
  merchants = [],
  rules = [],
  overrides = [],
  skippedIds = [],
} = {}) {
  const overrideByTransaction = new Map(
    overrides.filter((o) => o?.transaction_id).map((o) => [o.transaction_id, o])
  )
  const skipped = skippedIds instanceof Set ? skippedIds : new Set(skippedIds)

  const entries = transactions.map((transaction) =>
    classifyTransaction({
      transaction,
      patterns,
      merchants,
      rules,
      override: overrideByTransaction.get(transaction?.id) ?? null,
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
  }
}
