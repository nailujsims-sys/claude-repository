// Money, from the string the document printed to an integer — and never
// through a float on the way.
//
// The column reads "-54.80". Turning that into cents with parseFloat(...) * 100
// gives 5479.999999999999 often enough to matter, and once a rounding lands in
// a spending total nobody recomputes it. So the two halves are separated as
// text, multiplied as BigInt, and only then handed over as a Number — after
// proving the result is exactly representable.
//
// The accepted spelling is deliberately narrow (see AMOUNT_PATTERN in
// layout.js): no thousands separator, because the sample proves no format for
// one. An amount the parser cannot read with certainty stops the import.

import { AMOUNT_PATTERN } from './layout'

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * @param {unknown} value the amount exactly as printed, e.g. "-54.80"
 * @returns {{ok: true, minor: number} | {ok: false, reason: string}}
 */
export function parseAmountMinor(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'amount_missing' }
  const text = value.trim()
  if (text === '') return { ok: false, reason: 'amount_missing' }

  const match = AMOUNT_PATTERN.exec(text)
  if (!match) {
    // Everything that is a number but not THIS number: a thousands separator in
    // any of its spellings, a decimal comma, a currency symbol, a trailing
    // minus. All of them would parse to something under a looser rule, and
    // "something" is not good enough for money.
    return { ok: false, reason: 'amount_format_unknown' }
  }

  const [, sign, whole, fraction] = match
  const minor = BigInt(whole) * 100n + BigInt(fraction)
  if (minor > MAX_SAFE) {
    // The database refuses these too (finance_transactions_amount_exact), for
    // the same reason: beyond 2^53 the client can no longer read back what it
    // stored.
    return { ok: false, reason: 'amount_out_of_range' }
  }

  const signed = sign === '-' ? -minor : minor
  return { ok: true, minor: Number(signed) }
}

/**
 * dd.mm.yyyy → an ISO date, or null when the string is not a real calendar day.
 * "31.02.2026" parses as a shape and is still refused here.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseGermanDate(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match
  const iso = `${year}-${month}-${day}`
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  // Round-trip: JavaScript happily turns 2026-02-31 into 2026-03-03.
  if (date.toISOString().slice(0, 10) !== iso) return null
  return iso
}
