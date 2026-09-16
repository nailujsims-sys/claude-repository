import { FINANCE_STATUS, matchMerchant } from './merchantMatching'

// „Zählt diese Buchung?" — one question, one answer, one place.
//
// Three things can have an opinion, and they are not equal:
//
//   1. an explicit decision about THIS booking          (the override)
//   2. the default of the merchant, IF it is unambiguous
//   3. what the import wrote on the booking
//   4. true
//
// The order is the same one the rest of this module uses for the category: what
// a person said about one booking beats what they said about a merchant, and
// both beat what a bank statement happened to carry. The last step is `true`
// because a booking nobody has an opinion about is spending until somebody says
// otherwise — the opposite default would quietly shrink a total.
//
// STEP 2 DOES NOT READ `transaction.merchant_id`, and that is the whole point.
// Since 0008 the pattern engine decides which merchant a booking belongs to; the
// column is a cache of an answer somebody once wrote down. A Scalable Capital
// booking imported tomorrow carries no merchant id and must still follow the
// merchant's default the moment a pattern recognises it — otherwise saying
// „diesen Händler nicht berücksichtigen" would only ever apply backwards.
//
// A booking two merchants claim has no default to inherit: there is no single
// merchant, and picking one would be the specificity ranking matchMerchant
// deliberately does not have. Such a booking falls through to its own column.
//
// `supabase/migrations/0010_finance_analytics_inclusion.sql` implements exactly
// this rule in SQL for `finance_analytics_transactions`, and
// tools/financeAnalyticsE2E.mjs checks the two against each other on the same
// rows rather than assuming they agree.

/**
 * Does this booking count in a spending total?
 *
 * @param {{
 *   transaction?: object,
 *   override?: object|null,
 *   merchantMatch?: object|null,
 *   merchant?: object|null,
 *   merchants?: Array<object>,
 * }} input
 * @returns {boolean}
 */
export function resolveAnalyticsInclusion({
  transaction,
  override = null,
  merchantMatch = null,
  merchant = null,
  merchants = [],
} = {}) {
  return analyticsInclusion({ transaction, override, merchantMatch, merchant, merchants }).included
}

/** The same answer, with the reason — for a screen that has to explain itself. */
export function analyticsInclusion({
  transaction,
  override = null,
  merchantMatch = null,
  merchant = null,
  merchants = [],
} = {}) {
  // 1. The user, about this booking.
  if (typeof override?.include_in_analytics === 'boolean') {
    return { included: override.include_in_analytics, source: 'override', merchantId: null }
  }

  // 2. The user, about this merchant — but only when there IS one merchant.
  const resolved =
    merchantMatch && merchantMatch.status !== FINANCE_STATUS.RESOLVED
      ? null
      : (merchant ??
         (merchantMatch?.merchantId
           ? merchants.find((m) => m.id === merchantMatch.merchantId) ?? null
           : null))
  if (resolved && typeof resolved.default_include_in_analytics === 'boolean') {
    return {
      included: resolved.default_include_in_analytics,
      source: 'merchant',
      merchantId: resolved.id ?? null,
    }
  }

  // 3. What the import wrote.
  if (typeof transaction?.include_in_analytics === 'boolean') {
    return { included: transaction.include_in_analytics, source: 'transaction', merchantId: null }
  }

  // 4. Spending until somebody says otherwise.
  return { included: true, source: 'default', merchantId: null }
}

/**
 * The bookings a total is allowed to add up.
 *
 * Not a sum: this module decides WHICH rows count, and leaves adding them to
 * whoever is doing the adding. There is no finance chart yet; when there is,
 * this is the one gate it goes through, so a booking excluded here cannot turn
 * up in a number somewhere else.
 *
 * @param {{transactions?: Array<object>, overrides?: Array<object>,
 *          patterns?: Array<object>, merchants?: Array<object>}} input
 * @returns {Array<object>}
 */
export function analyticsTransactions({
  transactions = [],
  overrides = [],
  patterns = [],
  merchants = [],
} = {}) {
  const overrideBy = new Map(
    overrides.filter((o) => o?.transaction_id).map((o) => [o.transaction_id, o])
  )
  // matchMerchant, not `transaction.merchant_id`: the engine is the authority
  // on which merchant a booking belongs to (see the note at the top).
  return transactions.filter((transaction) =>
    resolveAnalyticsInclusion({
      transaction,
      override: overrideBy.get(transaction?.id) ?? null,
      merchantMatch: matchMerchant({ transaction, patterns, merchants }),
      merchants,
    })
  )
}
