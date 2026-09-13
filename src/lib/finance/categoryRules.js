import { FINANCE_STATUS } from './merchantMatching'

// Which category a booking belongs to, once its merchant is known. Pure
// functions over rows, and the second half of the split the schema is built on:
// recognising WHO a booking was with and deciding WHAT KIND of spending it was
// are two questions, asked in that order, answered separately.
//
// THE ORDER, and why it is exactly this one:
//   1. a manual override        — somebody decided this booking by hand
//   2. manual_lock              — somebody decided this booking by hand and
//                                 asked for it to be left alone
//   3. the merchant             — unresolved or in conflict? then so is the
//                                 category; there is nothing to look rules up by
//   4. review_mode              — a merchant the user wants to see every time
//   5. a matching amount rule   — EDEKA over 12 € is Lebensmittel
//   6. the merchant's default   — REWE is Lebensmittel, whatever it cost
//   7. unresolved               — the honest answer
//
// Two matching rules that disagree end in a conflict. Never in a pick.

/** Where a resolved category came from. */
export const CATEGORY_SOURCE = Object.freeze({
  OVERRIDE: 'override',
  MANUAL_LOCK: 'manual_lock',
  RULE: 'rule',
  DEFAULT_RULE: 'default_rule',
})

/**
 * An amount in minor units, as a number that is exactly what the database
 * holds — or null when it is not. `Number.isSafeInteger` is the whole check:
 * it rejects the fraction, the string, the NaN and, crucially, the value past
 * 2^53 that JSON already rounded on the way in. The database refuses to store
 * anything outside that range (finance_transactions_amount_exact), so null here
 * means the input was never a legitimate amount.
 *
 * The sign is dropped on purpose: a bank books a purchase negative, and
 * "EDEKA under 12 €" is a statement about how much was spent, not about which
 * direction the money moved. A Retoure of 15 € from EDEKA is therefore read by
 * the same rule as a 15 € purchase — which is what makes a refund land in the
 * category of the thing that was returned.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function safeAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) ? Math.abs(number) : null
}

/** A rule without amount bounds — the merchant's default. */
export const isDefaultRule = (rule) =>
  !!rule && rule.min_amount_minor === null && rule.max_amount_minor === null

const isActive = (row) => !!row && row.active !== false

/**
 * Does a rule's condition cover this booking?
 *
 * The bounds are compared against the SIZE of the booking, never its sign: a
 * bank reports a purchase as a negative amount, and "EDEKA under 12 €" is a
 * statement about how much was spent, not about which direction the money went.
 *
 * @param {object} rule
 * @param {{amount_minor?: number|string, currency?: string}} transaction
 * @returns {boolean}
 */
export function ruleMatchesAmount(rule, transaction) {
  if (!isActive(rule)) return false

  // A rule that counts in euros says nothing about a booking in dollars — and
  // nothing about a booking that does not say which currency it is in either.
  // The database requires the column, so this only ever fires on malformed
  // input; it fires closed, because "probably euros" is not a thing to decide
  // somebody's spending report on.
  if (rule.currency && rule.currency !== transaction?.currency) return false

  if (isDefaultRule(rule)) return true

  // Money arrives as a JSON number: PostgREST serialises bigint that way, and
  // JavaScript reads it as a float64. Anything that is not an exact integer —
  // a value past 2^53 that silently rounded, a fraction, a string that is not a
  // number, `Number(null)` being 0 — is not something to compare a boundary
  // against. No usable amount means no bounded rule matches.
  const amount = safeAmount(transaction?.amount_minor)
  if (amount === null) return false

  if (rule.min_amount_minor !== null && rule.min_amount_minor !== undefined) {
    const min = safeAmount(rule.min_amount_minor)
    if (min === null) return false
    if (rule.min_inclusive === false ? !(amount > min) : !(amount >= min)) return false
  }
  if (rule.max_amount_minor !== null && rule.max_amount_minor !== undefined) {
    const max = safeAmount(rule.max_amount_minor)
    if (max === null) return false
    if (rule.max_inclusive === false ? !(amount < max) : !(amount <= max)) return false
  }
  return true
}

// Deterministic: the id breaks every tie, so two rules that lead to the same
// category always report the same one of them as the reason.
const byId = (a, b) => String(a.id).localeCompare(String(b.id))

const result = (over) => ({
  status: FINANCE_STATUS.UNRESOLVED,
  categoryId: null,
  merchantId: null,
  source: null,
  ruleId: null,
  candidateRuleIds: [],
  suggestedCategoryId: null,
  locked: false,
  reason: null,
  ...over,
})

function decide(candidates) {
  const categories = [...new Set(candidates.map((r) => r.category_id))]
  if (categories.length > 1) return { conflict: true, categories, rules: candidates }
  return { conflict: false, categories, rules: candidates }
}

/**
 * The category of one booking.
 *
 * @param {{
 *   transaction?: object,
 *   merchantMatch?: object,
 *   rules?: Array<object>,
 *   override?: object|null,
 * }} input
 * @returns {{
 *   status: string, categoryId: string|null, merchantId: string|null,
 *   source: string|null, ruleId: string|null, candidateRuleIds: string[],
 *   suggestedCategoryId: string|null, locked: boolean, reason: string|null,
 * }}
 */
export function resolveCategory({ transaction, merchantMatch, rules = [], override = null } = {}) {
  const merchantId = merchantMatch?.merchantId ?? null

  // 1. A decision somebody made by hand beats every rule, now and after every
  //    future rule change. That is what the override table is for.
  if (override?.category_id) {
    return result({
      status: FINANCE_STATUS.RESOLVED,
      categoryId: override.category_id,
      merchantId: override.merchant_id ?? merchantId,
      source: CATEGORY_SOURCE.OVERRIDE,
      locked: true,
      reason: 'manual_override',
    })
  }

  // 2. A locked booking keeps whatever it has — including "nothing yet". A
  //    re-evaluation reads this and steps over the row instead of improving it.
  if (transaction?.manual_lock) {
    return result({
      status: transaction.category_id ? FINANCE_STATUS.RESOLVED : FINANCE_STATUS.UNRESOLVED,
      categoryId: transaction.category_id ?? null,
      merchantId: transaction.merchant_id ?? merchantId,
      source: CATEGORY_SOURCE.MANUAL_LOCK,
      locked: true,
      reason: 'manual_lock',
    })
  }

  // 3. No merchant, no rules to look up.
  if (merchantMatch?.status === FINANCE_STATUS.CONFLICT) {
    return result({ status: FINANCE_STATUS.CONFLICT, reason: 'merchant_conflict' })
  }
  if (merchantMatch?.status !== FINANCE_STATUS.RESOLVED || !merchantId) {
    return result({ status: FINANCE_STATUS.UNRESOLVED, reason: 'merchant_unresolved' })
  }

  const own = rules.filter((rule) => isActive(rule) && rule.merchant_id === merchantId)
  const conditional = own.filter((rule) => !isDefaultRule(rule) && ruleMatchesAmount(rule, transaction))
  const defaults = own.filter((rule) => isDefaultRule(rule) && ruleMatchesAmount(rule, transaction))

  const reviewMode = merchantMatch.reviewMode ?? 'auto'
  const applicable = conditional.length > 0 ? conditional : defaults
  const outcome = decide(applicable.slice().sort(byId))
  const suggestion = outcome.conflict || applicable.length === 0 ? null : outcome.categories[0]

  // 4. A merchant the user wants to look at every time. The merchant is
  //    recognised — that part is done — but nothing is finalised. The rule
  //    result travels along as a suggestion, so a screen can offer it without
  //    the software having decided it.
  if (reviewMode === 'always_review') {
    return result({
      status: FINANCE_STATUS.REVIEW_REQUIRED,
      merchantId,
      candidateRuleIds: applicable.map((r) => r.id),
      suggestedCategoryId: suggestion,
      reason: 'merchant_always_review',
    })
  }

  if (applicable.length === 0) {
    return result({
      status: FINANCE_STATUS.UNRESOLVED,
      merchantId,
      reason: own.length === 0 ? 'no_rule_for_merchant' : 'no_rule_matched',
    })
  }

  // 5./6. Two rules that both fit and disagree. Which one the database happens
  //       to return first is not an argument, so neither wins.
  if (outcome.conflict) {
    return result({
      status: FINANCE_STATUS.CONFLICT,
      merchantId,
      candidateRuleIds: applicable.map((r) => r.id).sort(),
      reason: conditional.length > 0 ? 'rule_conflict' : 'default_rule_conflict',
    })
  }

  const winner = outcome.rules[0]
  const source = conditional.length > 0 ? CATEGORY_SOURCE.RULE : CATEGORY_SOURCE.DEFAULT_RULE

  // A 'conditional' merchant may be decided automatically by an amount rule
  // that actually matched — falling through to its default rule is exactly the
  // case the user asked to see.
  if (reviewMode === 'conditional' && source === CATEGORY_SOURCE.DEFAULT_RULE) {
    return result({
      status: FINANCE_STATUS.REVIEW_REQUIRED,
      merchantId,
      candidateRuleIds: applicable.map((r) => r.id),
      suggestedCategoryId: winner.category_id,
      reason: 'merchant_conditional_default',
    })
  }

  return result({
    status: FINANCE_STATUS.RESOLVED,
    categoryId: winner.category_id,
    merchantId,
    source,
    ruleId: winner.id,
    candidateRuleIds: applicable.map((r) => r.id).sort(),
  })
}

/**
 * The type of a booking: a purchase, a Retoure, a transfer between one's own
 * accounts. The user's own correction beats whatever the import guessed —
 * the same rule as the category and the analytics flag, and the reason the
 * override row carries the column at all.
 *
 * @param {{transaction?: object, override?: object|null}} input
 * @returns {string}
 */
export function resolveTransactionType({ transaction, override = null } = {}) {
  if (typeof override?.transaction_type === 'string' && override.transaction_type !== '') {
    return override.transaction_type
  }
  return transaction?.transaction_type ?? 'purchase'
}

/**
 * Whether a booking counts in the analytics. A transfer between one's own
 * accounts or money coming back from a friend is not spending — and the user's
 * own decision about one booking beats whatever the import wrote.
 *
 * @param {{transaction?: object, override?: object|null}} input
 * @returns {boolean}
 */
export function resolveInclusion({ transaction, override = null } = {}) {
  if (typeof override?.include_in_analytics === 'boolean') return override.include_in_analytics
  return transaction?.include_in_analytics !== false
}
