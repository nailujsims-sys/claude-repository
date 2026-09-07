import { MONTHS_DE, parseISODate, startOfDay, toISODate } from './date'
import { isPlausibleRate } from './exchangeRate'

// The pure half of the Ausgaben module: converting, adding up, sorting and
// formatting. No React and no Supabase in here, so the rules can be read in one
// place and tested without a browser (see tools/expenseLogic.mjs) — the same
// split src/lib/listSelectors.js uses for Listen.

export const CURRENCIES = ['AUD', 'EUR']
export const DEFAULT_CURRENCY = 'AUD'

export function isCurrency(code) {
  return CURRENCIES.includes(code)
}

// ── Converting ──────────────────────────────────────────────────────────────

// Money is rounded to cents at the moment it is converted, not at the moment it
// is printed. That is what makes the overview add up: the total is the sum of
// the numbers on the rows, so a user who checks with a calculator gets the same
// answer the app shows. Summing full precision and rounding at the end would be
// a cent more "accurate" and a cent less explainable.
const toCents = (value) => Math.round(value * 100) / 100

/**
 * `amount` in `from`, expressed in `to`, using `rate` = EUR for 1 AUD.
 *
 * Returns null when the rate cannot carry the conversion — a caller that gets
 * null has nothing to show, which is the truth, and never a silent zero.
 */
export function convertAmount(amount, from, to, rate) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  if (!isCurrency(from) || !isCurrency(to)) return null
  if (from === to) return toCents(value)
  if (!isPlausibleRate(rate)) return null
  return toCents(from === 'AUD' ? value * Number(rate) : value / Number(rate))
}

/**
 * One expense in the currency the overview is currently showing.
 *
 * Converted with the rate stored ON THAT ROW, never with today's: the expense
 * was made at a particular rate, and a switch of the display currency must not
 * rewrite what a March coffee cost.
 */
export function amountIn(expense, currency) {
  if (!expense) return null
  return convertAmount(
    expense.original_amount,
    expense.original_currency,
    currency,
    expense.exchange_rate_aud_eur
  )
}

// The sum of everything, in the display currency. Rows that cannot be converted
// are skipped rather than counted as zero — the database forbids them, and a
// total that silently swallowed one would be wrong without saying so.
export function totalIn(expenses = [], currency) {
  return toCents(
    expenses.reduce((sum, expense) => {
      const value = amountIn(expense, currency)
      return value === null ? sum : sum + value
    }, 0)
  )
}

// ── Sorting ─────────────────────────────────────────────────────────────────

// Newest first — by the day the money was spent, and within a day by when the
// expense was entered, so two expenses on the same date keep a stable order
// instead of swapping around on every render.
export function sortExpenses(expenses = []) {
  return [...expenses].sort(
    (a, b) =>
      String(b.transaction_date ?? '').localeCompare(String(a.transaction_date ?? '')) ||
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  )
}

// ── Formatting ──────────────────────────────────────────────────────────────

// German number format for both currencies, so "1.234,50" reads the same
// everywhere in the app. EUR keeps the € the rest of the product uses; AUD
// prints "AU$", which is what Intl gives for de-DE and is unambiguous next to
// it — a bare "$" beside a "€" would not be.
const formatters = {
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
  AUD: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'AUD' }),
}

export function formatMoney(amount, currency) {
  const value = Number(amount)
  const formatter = formatters[currency]
  if (!formatter || !Number.isFinite(value)) return ''
  return formatter.format(value)
}

// The quiet line under the total: "1 AUD = 0,58 €". Four decimals, because that
// is the precision the source publishes and two would hide a real move.
const rateFormat = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatRate(rate) {
  if (!isPlausibleRate(rate)) return ''
  return `1 AUD = ${rateFormat.format(Number(rate))} €`
}

// Where the shown rate came from, in the user's words. `source` is what
// resolveRate() decided; anything else is treated as unknown provenance and
// says nothing rather than guessing.
export function rateSourceLabel(source) {
  if (source === 'live') return 'aktueller Kurs'
  if (source === 'stored') return 'letzter bekannter Kurs'
  if (source === 'seed') return 'Richtwert'
  return ''
}

/**
 * The date on a row: "Heute", "Gestern", "5. September", "5. September 2025".
 *
 * Same idea as the task list's relative "Fällig" label — the two days a user
 * enters expenses on get a word, everything else gets its date, and the year
 * appears only when it is not the current one.
 */
export function formatExpenseDate(dateStr, ref = new Date()) {
  const date = parseISODate(dateStr)
  if (!date) return ''
  const today = startOfDay(ref)
  const iso = toISODate(date)
  if (iso === toISODate(today)) return 'Heute'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (iso === toISODate(yesterday)) return 'Gestern'
  const base = `${date.getDate()}. ${MONTHS_DE[date.getMonth()]}`
  return date.getFullYear() === today.getFullYear() ? base : `${base} ${date.getFullYear()}`
}

// "3 Ausgaben" / "1 Ausgabe" — the one count the overview shows, next to the
// total it belongs to.
export function expenseCountLabel(count) {
  return `${count} ${count === 1 ? 'Ausgabe' : 'Ausgaben'}`
}
