import { patternMatches } from './merchantMatching'
import { patternText, transactionTokens } from './normalize'

// What a pattern would do before it exists.
//
// Saving a pattern is the one move in this module that reaches backwards: a
// single token can re-label years of bookings. So the UI has to be able to say
// "dieses Muster trifft 34 bestehende Buchungen, davon 2 mit einem anderen
// Händler" BEFORE anything is written — which is all this file is. It answers a
// question, it changes nothing, and it never proposes a pattern of its own: a
// pattern is what a human marked in a booking text, never something derived
// from the history.
//
// It reads each booking's STORED tokens, which is the same basis
// finance_learn_merchant_rule verifies against — so the sentence the user sees
// before saving and the set the database actually re-labels are the same set,
// not two opinions about it.

const isLocked = (transaction, overrideIds) =>
  transaction.manual_lock === true || overrideIds.has(transaction.id)

/**
 * Run a candidate pattern against the bookings that already exist.
 *
 * @param {{
 *   pattern?: {pattern_type?: string, tokens?: string[]},
 *   merchantId?: string|null,
 *   transactions?: Array<object>,
 *   patterns?: Array<object>,
 *   overrides?: Array<object>,
 * }} input
 */
export function backtestPattern({
  pattern,
  merchantId = null,
  transactions = [],
  patterns = [],
  overrides = [],
} = {}) {
  const candidate = {
    pattern_type: pattern?.pattern_type,
    tokens: Array.isArray(pattern?.tokens) ? pattern.tokens : [],
    active: true,
  }
  const overrideIds = new Set(overrides.map((o) => o.transaction_id))

  // A pattern that already exists. Same merchant: saving it again changes
  // nothing. Another merchant: it would make every booking it matches ambiguous
  // forever, which is why the database refuses it too.
  const patternConflicts = patterns
    .filter(
      (p) =>
        p.active !== false &&
        p.pattern_type === candidate.pattern_type &&
        Array.isArray(p.tokens) &&
        p.tokens.length === candidate.tokens.length &&
        p.tokens.every((token, i) => token === candidate.tokens[i])
    )
    .map((p) => ({
      patternId: p.id,
      merchantId: p.merchant_id,
      reason: merchantId && p.merchant_id === merchantId ? 'duplicate' : 'other_merchant',
    }))

  const matches = []
  const merchantConflicts = []
  const assignedCounts = {}
  let lockedCount = 0

  for (const transaction of transactions) {
    const tokens = transactionTokens(transaction)
    if (!patternMatches(candidate, tokens)) continue

    // Who else would claim this booking once the new pattern exists: every
    // other merchant whose pattern already matches it, plus whoever it is
    // assigned to today.
    const claimants = new Set()
    if (merchantId) claimants.add(merchantId)
    if (transaction.merchant_id) claimants.add(transaction.merchant_id)
    for (const other of patterns) {
      if (other.active === false) continue
      if (patternMatches(other, tokens)) claimants.add(other.merchant_id)
    }

    const locked = isLocked(transaction, overrideIds)
    if (locked) lockedCount += 1
    if (transaction.merchant_id) {
      assignedCounts[transaction.merchant_id] = (assignedCounts[transaction.merchant_id] ?? 0) + 1
    }

    const merchantIds = [...claimants].sort()
    if (merchantIds.length > 1) merchantConflicts.push({ transactionId: transaction.id, merchantIds })

    matches.push({
      transactionId: transaction.id,
      assignedMerchantId: transaction.merchant_id ?? null,
      merchantIds,
      locked,
    })
  }

  // What the learning call may actually assign: bookings nobody has decided
  // anything about. The database enforces the same three conditions again — this is
  // the honest preview, not the guard.
  const applicableTransactionIds = matches
    .filter((m) => !m.locked && !m.assignedMerchantId)
    .map((m) => m.transactionId)

  return {
    pattern: { ...candidate, text: patternText(candidate.tokens) },
    matchCount: matches.length,
    transactionIds: matches.map((m) => m.transactionId),
    matches,
    assignedMerchantIds: Object.keys(assignedCounts).sort(),
    assignedCounts,
    assignedCount: matches.filter((m) => m.assignedMerchantId).length,
    unassignedCount: matches.filter((m) => !m.assignedMerchantId).length,
    lockedCount,
    merchantConflicts,
    patternConflicts,
    applicableTransactionIds,
  }
}
