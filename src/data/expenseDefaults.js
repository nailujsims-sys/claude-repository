// The columns a client may write. Everything else on a row is the database's
// business: `id`, `user_id` and `created_at` are set once on insert, and the
// `updated_at` trigger keeps that column honest.
//
// Same shape as src/data/listDefaults.js, and for the same reason: a caller
// that hands the repository a whole row — an edited copy, a restored snapshot —
// must not be able to smuggle a server-managed column in with it.
export const WRITABLE_EXPENSE_FIELDS = [
  'title',
  'original_amount',
  'original_currency',
  'transaction_date',
  // Writable on insert, and on an edit that genuinely re-prices the expense.
  // It is never patched on its own: the rate belongs to the amount it was used
  // for (see src/context/ExpensesContext.jsx).
  'exchange_rate_aud_eur',
  'updated_at',
]

function pick(fields, patch) {
  const out = {}
  for (const key of fields) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}

export const pickWritableExpense = (patch) => pick(WRITABLE_EXPENSE_FIELDS, patch)
