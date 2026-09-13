// The shapes this module passes around, written down once.
//
// The app is plain JavaScript (Vite + esbuild, no TypeScript step), so "typsicher"
// here means what it means everywhere else in this repository: JSDoc typedefs
// that editors and `tsc --checkJs` understand, a whitelist for every write
// (src/data/financeDefaults.js), and check constraints in the database for the
// values that must not exist at all. There is no `any` and no cast to one —
// there is nothing to cast in the first place.
//
// Row types mirror supabase/migrations/0008_finance.sql exactly, in snake_case,
// because that is what comes back over the wire. Everything this module derives
// is camelCase, so a result object is never mistaken for a row.

/**
 * @typedef {'exact_token'|'exact_phrase'} PatternType
 * @typedef {'auto'|'conditional'|'always_review'} ReviewMode
 * @typedef {'purchase'|'refund'|'transfer'|'income'|'fee'|'other'} TransactionType
 * @typedef {'resolved'|'unresolved'|'conflict'|'review_required'} FinanceStatus
 * @typedef {'override'|'manual_lock'|'rule'|'default_rule'} CategorySource
 */

/**
 * @typedef {object} FinanceAccountRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} name
 * @property {string|null} provider
 * @property {string} currency
 */

/**
 * @typedef {object} FinanceCategoryRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} slug
 * @property {string} label
 * @property {number} sort_order
 * @property {boolean} is_system
 */

/**
 * @typedef {object} FinanceMerchantRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} canonical_name
 * @property {ReviewMode} review_mode
 */

/**
 * @typedef {object} FinanceMerchantPatternRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} merchant_id
 * @property {PatternType} pattern_type
 * @property {string[]} tokens        normalised, produced by normalize.js
 * @property {boolean} active
 */

/**
 * @typedef {object} FinanceCategoryRuleRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} merchant_id
 * @property {string} category_id
 * @property {number|null} min_amount_minor   minor units; null = open end
 * @property {boolean} min_inclusive
 * @property {number|null} max_amount_minor
 * @property {boolean} max_inclusive
 * @property {string|null} currency           required as soon as a bound is set
 * @property {boolean} active
 */

/**
 * The booking. Everything down to `external_reference` is the fact as it
 * arrived and is never rewritten; everything after it is interpretation.
 *
 * @typedef {object} FinanceTransactionRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} account_id
 * @property {string|null} import_id
 * @property {string} booking_date            ISO date
 * @property {string|null} value_date
 * @property {number} amount_minor            minor units, never a float
 * @property {string} currency
 * @property {string} raw_description
 * @property {string|null} external_reference
 * @property {string|null} merchant_id
 * @property {string|null} category_id
 * @property {TransactionType} transaction_type
 * @property {string|null} refunds_transaction_id
 * @property {boolean} include_in_analytics
 * @property {boolean} manual_lock
 * @property {string|null} dedupe_hash
 * @property {object|null} source_metadata
 */

/**
 * @typedef {object} FinanceTransactionOverrideRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} transaction_id
 * @property {string|null} merchant_id
 * @property {string|null} category_id
 * @property {boolean|null} include_in_analytics
 * @property {TransactionType|null} transaction_type
 * @property {string|null} note
 */

/**
 * @typedef {object} MerchantMatch
 * @property {FinanceStatus} status
 * @property {string|null} merchantId
 * @property {FinanceMerchantRow|null} merchant
 * @property {ReviewMode|null} reviewMode
 * @property {string[]} tokens
 * @property {Array<{patternId: string, merchantId: string, patternType: PatternType, tokens: string[]}>} matches
 * @property {string[]} merchantIds
 * @property {string|null} reason
 */

/**
 * @typedef {object} CategoryResolution
 * @property {FinanceStatus} status
 * @property {string|null} categoryId
 * @property {string|null} merchantId
 * @property {CategorySource|null} source
 * @property {string|null} ruleId
 * @property {string[]} candidateRuleIds
 * @property {string|null} suggestedCategoryId
 * @property {boolean} locked
 * @property {string|null} reason
 */

export {}
