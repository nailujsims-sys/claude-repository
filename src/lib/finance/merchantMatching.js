import { phraseIndex, transactionTokens } from './normalize'

// Which merchant a booking belongs to — and, just as often, the honest answer
// that we cannot tell. Pure functions over rows; the caller loads the rows.
//
// THE RULE THIS FILE IS BUILT AROUND: a booking is assigned to a merchant only
// when exactly one merchant's patterns match it. Two merchants matching the
// same text is a conflict, and a conflict stays a conflict — no scoring, no
// "the longer phrase probably wins", no tie-break by creation date. Picking a
// winner would be a guess, and a guess in the wrong direction is a wrong number
// in a spending report nobody double-checks.

/**
 * The four answers this module and the category resolver can give.
 *
 * `review_required` is never a merchant status: whether a merchant was
 * recognised and whether its category may be decided automatically are two
 * different questions (that separation is the point of the whole schema), and
 * only the second one can end in "ask the user". See resolveCategory.
 */
export const FINANCE_STATUS = Object.freeze({
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved',
  CONFLICT: 'conflict',
  REVIEW_REQUIRED: 'review_required',
})

/**
 * Does one pattern match a tokenised description?
 *
 * @param {{pattern_type?: string, tokens?: string[], active?: boolean}} pattern
 * @param {string[]} tokens
 * @returns {boolean}
 */
export function patternMatches(pattern, tokens) {
  if (!pattern || !Array.isArray(tokens)) return false
  if (pattern.active === false) return false
  const needle = Array.isArray(pattern.tokens) ? pattern.tokens : []
  if (needle.length === 0) return false

  if (pattern.pattern_type === 'exact_token') {
    // Exactly one token, compared as a whole token. A pattern row with more
    // than one token is not an exact_token — the database refuses it, and a
    // row that got in another way is not silently reinterpreted here.
    return needle.length === 1 && tokens.includes(needle[0])
  }
  if (pattern.pattern_type === 'exact_phrase') {
    return needle.length >= 2 && phraseIndex(tokens, needle) !== -1
  }
  return false
}

// Stable output whatever order the rows arrived in — a result that depends on
// the database's row order is a result that changes without anybody changing
// anything.
const byPattern = (a, b) =>
  a.patternType.localeCompare(b.patternType) ||
  a.tokens.join(' ').localeCompare(b.tokens.join(' ')) ||
  String(a.patternId).localeCompare(String(b.patternId))

/**
 * Which merchant a raw description belongs to.
 *
 * @param {{
 *   transaction?: object,
 *   rawDescription?: string,
 *   tokens?: string[],
 *   patterns?: Array<object>,
 *   merchants?: Array<object>,
 * }} input
 * @returns {{
 *   status: string, merchantId: string|null, merchant: object|null,
 *   reviewMode: string|null, tokens: string[],
 *   matches: Array<{patternId: string, merchantId: string, patternType: string, tokens: string[]}>,
 *   merchantIds: string[], reason: string|null,
 * }}
 */
export function matchMerchant({
  transaction,
  rawDescription,
  tokens,
  patterns = [],
  merchants = [],
} = {}) {
  // A booking row wins over a loose string: it carries the tokens the database
  // will verify against, and matching on anything else would decide the
  // question on a different basis than the one that counts.
  const descriptionTokens = Array.isArray(tokens)
    ? tokens
    : transactionTokens(transaction ?? { raw_description: rawDescription })

  const matches = patterns
    .filter((pattern) => patternMatches(pattern, descriptionTokens))
    .map((pattern) => ({
      patternId: pattern.id,
      merchantId: pattern.merchant_id,
      patternType: pattern.pattern_type,
      tokens: pattern.tokens,
    }))
    .sort(byPattern)

  const merchantIds = [...new Set(matches.map((m) => m.merchantId))].sort()

  const base = { tokens: descriptionTokens, matches, merchantIds }

  if (matches.length === 0) {
    return {
      ...base,
      status: FINANCE_STATUS.UNRESOLVED,
      merchantId: null,
      merchant: null,
      reviewMode: null,
      reason: 'no_pattern_matched',
    }
  }

  // Several merchants claim the same booking. The user decides, or adds a more
  // specific pattern; the software does not pick one of them.
  if (merchantIds.length > 1) {
    return {
      ...base,
      status: FINANCE_STATUS.CONFLICT,
      merchantId: null,
      merchant: null,
      reviewMode: null,
      reason: 'several_merchants_matched',
    }
  }

  const merchantId = merchantIds[0]
  const merchant = merchants.find((m) => m.id === merchantId) ?? null

  // A pattern pointing at a merchant we do not hold is doubt, and doubt is
  // unresolved: without the row we do not know its review mode, so accepting
  // the match could skip a review the user asked for.
  if (!merchant) {
    return {
      ...base,
      status: FINANCE_STATUS.UNRESOLVED,
      merchantId: null,
      merchant: null,
      reviewMode: null,
      reason: 'merchant_unknown',
    }
  }

  // Several patterns, one merchant — that is not a conflict, that is a merchant
  // with an alias. The answer stays unambiguous.
  return {
    ...base,
    status: FINANCE_STATUS.RESOLVED,
    merchantId,
    merchant,
    reviewMode: merchant.review_mode ?? 'auto',
    reason: null,
  }
}
