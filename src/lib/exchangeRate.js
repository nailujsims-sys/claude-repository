// The AUD/EUR rate: where it comes from, how it is read, and what happens when
// the request fails.
//
// Pure except for the one function that actually fetches, so the parsing, the
// plausibility check and the fallback chain can be tested without a network
// (see tools/expenseLogic.mjs).
//
// THE SOURCE — Frankfurter (https://frankfurter.dev)
// Free, no API key, no account, no rate limit worth the name, CORS open, and
// the numbers are the European Central Bank's own daily reference rates. That
// covers the brief exactly: a reliable public source that cannot start costing
// money. The ECB publishes once per working day, so a weekend request returns
// Friday's rate — which *is* the most current rate that exists, not a stale one.
//
// THE FALLBACK CHAIN, in order (see `resolveRate`):
//   1. the rate loaded in this session
//   2. the rate stored on the newest expense — i.e. the last rate this account
//      successfully used. It lives in Supabase, so it is the same on every
//      device, and it needs no second store: the whole point of writing the
//      rate onto every row is that the newest row is the account's memory of it.
//   3. `FALLBACK_RATE_AUD_EUR` below — only ever reached on the very first
//      expense of a brand-new account with no connection. The UI labels a rate
//      from this step as an estimate rather than passing it off as current.

// EUR per 1 AUD. Only used when nothing better exists (step 3 above); the UI
// says so when it shows one. ECB reference rate, September 2026.
export const FALLBACK_RATE_AUD_EUR = 0.58

// The rate is quoted with AUD as the base, so `rates.EUR` is directly "EUR for
// 1 AUD" — the number the column stores, with no inversion anywhere.
export const RATE_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=AUD&symbols=EUR'

// How long a loaded rate is treated as current. The ECB updates once a day, so
// this is not about accuracy — it is about not asking again on every navigation
// while still picking up a new day's rate during a long session.
export const RATE_MAX_AGE_MS = 15 * 60 * 1000

// A sanity range, not a forecast. AUD/EUR has lived between 0.5 and 0.8 for
// twenty years; anything outside this is a broken response, a different base,
// or a provider returning something that is not a rate at all — and a wrong
// rate stored on a row is worse than no rate, because it is silent.
const MIN_RATE = 0.1
const MAX_RATE = 10

export function isPlausibleRate(value) {
  const rate = Number(value)
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE
}

/**
 * Read `{ amount, base, date, rates: { EUR } }` into a rate, or null.
 *
 * Null for everything that is not a usable number in the plausible range —
 * an error body, an HTML error page parsed as JSON, a missing currency, a
 * provider that changed its shape. The caller then treats it as a failed
 * request and falls back, which is the honest reading of "we did not get a
 * rate" either way.
 */
export function parseRateResponse(body) {
  const rate = body?.rates?.EUR
  if (!isPlausibleRate(rate)) return null
  return Number(rate)
}

// The `date` the source stamps the rate with ('YYYY-MM-DD'), when it looks like
// one. Shown next to the rate so "how current is this" is answerable.
export function parseRateDate(body) {
  const date = body?.date
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

/**
 * Ask the source for the current rate.
 *
 * Resolves to `{ rate, date }` or throws. Never throws *at* the caller in a way
 * that matters — every call site catches and falls back — but it throws rather
 * than returning null so a failure cannot be mistaken for a rate of zero.
 *
 * `fetchImpl` and `timeoutMs` are injectable so the tests can drive both the
 * success and the failure path without a network.
 */
export async function fetchAudEurRate({ fetchImpl, timeoutMs = 8000 } = {}) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) throw new Error('Kein fetch verfügbar.')

  // A rate request that never answers must not leave the screen waiting: the
  // controller ends it and the caller falls back to the last known rate.
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await doFetch(RATE_ENDPOINT, {
      signal: controller?.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Kursabfrage fehlgeschlagen (${response.status})`)
    const body = await response.json()
    const rate = parseRateResponse(body)
    if (rate === null) throw new Error('Kursantwort ohne verwertbaren Kurs.')
    return { rate, date: parseRateDate(body) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Which rate the app should use right now, and where it came from.
 *
 * `source` is what the UI labels the rate with, so the user is never told a
 * number is current when it is not:
 *   'live'   — loaded from the source in this session
 *   'stored' — the last rate this account used (newest expense)
 *   'seed'   — the built-in estimate, i.e. nothing better exists
 */
export function resolveRate({ liveRate = null, expenses = [] } = {}) {
  if (isPlausibleRate(liveRate)) return { rate: Number(liveRate), source: 'live' }

  const stored = lastStoredRate(expenses)
  if (stored !== null) return { rate: stored, source: 'stored' }

  return { rate: FALLBACK_RATE_AUD_EUR, source: 'seed' }
}

// The rate on the most recently *created* expense. Deliberately created and not
// transaction date: an expense booked today for last week still carries today's
// rate, and that is the newer piece of information.
export function lastStoredRate(expenses = []) {
  let newest = null
  for (const expense of expenses) {
    if (!isPlausibleRate(expense?.exchange_rate_aud_eur)) continue
    if (!newest || String(expense.created_at ?? '') > String(newest.created_at ?? '')) {
      newest = expense
    }
  }
  return newest ? Number(newest.exchange_rate_aud_eur) : null
}
