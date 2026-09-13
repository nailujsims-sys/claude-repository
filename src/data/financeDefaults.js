// The columns a client may write, per finance table.
//
// Same shape and the same reason as src/data/expenseDefaults.js: a caller that
// hands the repository a whole row — an edited copy, something read back from
// the database, a payload assembled somewhere else — must not be able to
// smuggle a server-managed column in with it.
//
// Two whitelists deserve a second look:
//
//   • A transaction's raw half (`booking_date`, `amount_minor`, `currency`,
//     `raw_description`, `value_date`, `external_reference`) is writable ON
//     INSERT, because that is when the import writes it — and is deliberately
//     absent from WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS, so no later update
//     can rewrite what a booking said it was.
//   • A pattern is created, deactivated or replaced — never edited in place, and
//     WRITABLE_FINANCE_PATTERN_PATCH_FIELDS is what makes that true: it holds
//     `active` and nothing else. Editing a pattern's tokens would silently
//     change what every booking it ever matched means.

const pick = (fields, patch) => {
  const out = {}
  for (const key of fields) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}

export const WRITABLE_FINANCE_ACCOUNT_FIELDS = ['name', 'provider', 'currency', 'updated_at']

export const WRITABLE_FINANCE_CATEGORY_FIELDS = ['slug', 'label', 'sort_order', 'updated_at']

export const WRITABLE_FINANCE_MERCHANT_FIELDS = ['canonical_name', 'review_mode', 'updated_at']

export const WRITABLE_FINANCE_PATTERN_FIELDS = [
  'merchant_id',
  'pattern_type',
  'tokens',
  'active',
  'updated_at',
]

// Deactivating is the only change a pattern can undergo.
export const WRITABLE_FINANCE_PATTERN_PATCH_FIELDS = ['active', 'updated_at']

export const WRITABLE_FINANCE_RULE_FIELDS = [
  'merchant_id',
  'category_id',
  'min_amount_minor',
  'min_inclusive',
  'max_amount_minor',
  'max_inclusive',
  'currency',
  'active',
  'updated_at',
]

export const WRITABLE_FINANCE_IMPORT_FIELDS = [
  'account_id',
  'source_type',
  'source_name',
  'source_hash',
  'status',
  'parser_version',
  'parser_notes',
  'imported_at',
  'updated_at',
]

export const WRITABLE_FINANCE_TRANSACTION_FIELDS = [
  'account_id',
  'import_id',
  'booking_date',
  'value_date',
  'amount_minor',
  'currency',
  'raw_description',
  'external_reference',
  'merchant_id',
  'category_id',
  'transaction_type',
  'refunds_transaction_id',
  'include_in_analytics',
  'manual_lock',
  'dedupe_hash',
  'source_metadata',
  'updated_at',
]

// What may still change after the import: the interpretation, never the fact.
export const WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS = [
  'merchant_id',
  'category_id',
  'transaction_type',
  'refunds_transaction_id',
  'include_in_analytics',
  'manual_lock',
  'updated_at',
]

export const WRITABLE_FINANCE_OVERRIDE_FIELDS = [
  'transaction_id',
  'merchant_id',
  'category_id',
  'include_in_analytics',
  'transaction_type',
  'note',
  'updated_at',
]

export const pickWritableFinanceAccount = (patch) => pick(WRITABLE_FINANCE_ACCOUNT_FIELDS, patch)
export const pickWritableFinanceCategory = (patch) => pick(WRITABLE_FINANCE_CATEGORY_FIELDS, patch)
export const pickWritableFinanceMerchant = (patch) => pick(WRITABLE_FINANCE_MERCHANT_FIELDS, patch)
export const pickWritableFinancePattern = (patch) => pick(WRITABLE_FINANCE_PATTERN_FIELDS, patch)
export const pickFinancePatternPatch = (patch) => pick(WRITABLE_FINANCE_PATTERN_PATCH_FIELDS, patch)
export const pickWritableFinanceRule = (patch) => pick(WRITABLE_FINANCE_RULE_FIELDS, patch)
export const pickWritableFinanceImport = (patch) => pick(WRITABLE_FINANCE_IMPORT_FIELDS, patch)
export const pickWritableFinanceTransaction = (patch) =>
  pick(WRITABLE_FINANCE_TRANSACTION_FIELDS, patch)
export const pickFinanceTransactionPatch = (patch) =>
  pick(WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS, patch)
export const pickWritableFinanceOverride = (patch) => pick(WRITABLE_FINANCE_OVERRIDE_FIELDS, patch)
