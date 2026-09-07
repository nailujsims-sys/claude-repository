import { amountIn, formatExpenseDate, formatMoney } from '../lib/expenses'

// One expense in the overview. Built to the measurements every other row in the
// app uses — 60px minimum height, a 16px inset, `gap-3`, a title line and one
// quiet line under it — and it is a single full-width button, like `ListRow`'s
// leading half, because the row has exactly one thing to do: open the expense.
//
// WHAT THE TWO NUMBERS MEAN
// The trailing amount is always in the currency the overview is switched to —
// that is the switch's whole promise, and it is why it is the biggest thing on
// the row (§17). The original is repeated in the line underneath only when it
// differs; when the expense was made in the currency being shown, the trailing
// amount *is* the original and printing it twice would be noise.
//
// Converted with the rate stored on this row, never with today's (see
// src/lib/expenses.js → amountIn).
export default function ExpenseRow({ expense, currency, onOpen, showBorder = true }) {
  const shown = amountIn(expense, currency)
  const isConverted = expense.original_currency !== currency
  const date = formatExpenseDate(expense.transaction_date)
  const original = formatMoney(expense.original_amount, expense.original_currency)

  return (
    <div className="relative flex items-center" style={{ minHeight: 60 }}>
      <button
        onClick={() => onOpen?.(expense)}
        className="press-tint flex min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-text-primary">
            {expense.title}
          </span>
          <span className="block truncate text-caption text-text-secondary">
            {isConverted ? `${date} · ${original}` : date}
          </span>
        </span>
        <span className="shrink-0 text-body font-semibold tabular-nums text-text-primary">
          {shown === null ? '—' : formatMoney(shown, currency)}
        </span>
      </button>

      {showBorder && (
        <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-subtle" />
      )}
    </div>
  )
}
