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
//   • `normalized_tokens` is in NO list at all. It is derived from
//     `raw_description` by src/lib/finance/normalize.js inside
//     financeRepository.createTransaction, because it is the basis the database
//     verifies a learning call against — a caller able to set it could make a
//     booking match a pattern its text does not contain.
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

export const WRITABLE_FINANCE_MERCHANT_FIELDS = [
  'canonical_name',
  'review_mode',
  // Whether this merchant's bookings count in a spending total. A default for
  // every booking that says nothing itself; an override on the booking wins.
  // Written through financeRepository.setMerchantAnalyticsDefault, which
  // touches this column and no other.
  'default_include_in_analytics',
  'updated_at',
]

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
  // The period the file itself declares. The database checks every booking it
  // is asked to store against it, so a column the client cannot set would make
  // that check dead code — the importer reads both off the export's header.
  'period_start',
  'period_end',
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
  // The merchant a human NAMED, as text. Added by 0011 because a merchant the
  // user typed into the AI preview is a decision about one booking, and
  // creating a `finance_merchants` row for it would turn that into a rule for
  // every future booking — the one thing this module does not do on its own.
  'merchant_name',
  'category_id',
  'include_in_analytics',
  'transaction_type',
  'note',
  'updated_at',
]

// Was ein KI-Import sich für die Zukunft gemerkt hat. Angelegt wird eine solche
// Zeile ausschließlich in `finance_apply_ai_import` (0012), zusammen mit der
// Buchung, aus der sie stammt — der Client legt keine an. Was er darf, ist
// genau das Eine, was die Liste im „Gelerntes Wissen"-Sheet anbietet: eine
// Erinnerung deaktivieren und wieder einschalten. Deshalb steht hier `active`
// und sonst nichts: eine Regel nachträglich umzuschreiben wäre eine zweite
// Wahrheit ohne den Fall, aus dem sie stammt.
export const WRITABLE_FINANCE_AI_MEMORY_PATCH_FIELDS = ['active', 'updated_at']

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
export const pickFinanceAiMemoryPatch = (patch) =>
  pick(WRITABLE_FINANCE_AI_MEMORY_PATCH_FIELDS, patch)
