// Pure-logic tests for the Ausgaben module.
//
// Four promises are worth pinning here, because all four are rules the screen
// can only obey if the layer underneath it is right:
//
//   1. Conversion in both directions, with the rate stored on the row. An
//      expense made at March's rate has to keep costing what it cost, whichever
//      currency the overview is switched to.
//   2. The totals. Switching AUD ⇄ EUR must convert every row and the sum, and
//      the sum must be the numbers on the rows added up — a user who checks
//      with a calculator gets the app's answer.
//   3. The rate pipeline: what a good response reads as, what a broken one
//      reads as (nothing, never a zero), and the fallback chain that runs when
//      the request fails — live → last stored on the newest expense → the
//      built-in estimate.
//   4. That a client cannot write a server-managed column.
//
// The UI half — the sheet, the switch, the date picker — is behavioural and is
// covered by tools/smoke.mjs. Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  amountIn,
  convertAmount,
  expenseCountLabel,
  formatExpenseDate,
  formatMoney,
  formatRate,
  isCurrency,
  rateSourceLabel,
  sortExpenses,
  totalIn,
} from './src/lib/expenses.js'
import {
  FALLBACK_RATE_AUD_EUR,
  RATE_ENDPOINT,
  fetchAudEurRate,
  isPlausibleRate,
  lastStoredRate,
  parseRateDate,
  parseRateResponse,
  resolveRate,
} from './src/lib/exchangeRate.js'
import { WRITABLE_EXPENSE_FIELDS, pickWritableExpense } from './src/data/expenseDefaults.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const nbsp = (s) => s.replace(/\\u00a0/g, ' ')

const expense = (over) => ({
  id: 'e', user_id: 'u', title: 'Kaffee',
  original_amount: 5, original_currency: 'AUD',
  transaction_date: '2026-09-05', exchange_rate_aud_eur: 0.6,
  created_at: '2026-09-05T08:00:00.000Z', updated_at: '2026-09-05T08:00:00.000Z', ...over,
})

// ── 1. currencies ───────────────────────────────────────────────────────────
{
  ok('exactly the two currencies of this semester', CURRENCIES.join(',') === 'AUD,EUR')
  ok('the default is the one most things are paid in', DEFAULT_CURRENCY === 'AUD')
  ok('a known currency is known', isCurrency('AUD') && isCurrency('EUR'))
  ok('anything else is not', !isCurrency('USD') && !isCurrency('') && !isCurrency(null))
}

// ── 2. converting ───────────────────────────────────────────────────────────
{
  ok('AUD → EUR multiplies by the rate', convertAmount(100, 'AUD', 'EUR', 0.6) === 60)
  ok('EUR → AUD divides by it', convertAmount(60, 'EUR', 'AUD', 0.6) === 100)
  ok('the same currency is left alone, whatever the rate says',
     convertAmount(12.5, 'EUR', 'EUR', 0.6) === 12.5 && convertAmount(12.5, 'AUD', 'AUD', 9) === 12.5)
  ok('the result is rounded to cents, so rows and totals can agree',
     convertAmount(10, 'AUD', 'EUR', 0.5678) === 5.68)
  ok('a round trip comes back to where it started',
     convertAmount(convertAmount(100, 'AUD', 'EUR', 0.6), 'EUR', 'AUD', 0.6) === 100)

  // Nothing here may quietly produce a zero: a missing rate means "cannot say",
  // and a screen that printed 0,00 € would be stating a wrong fact.
  ok('an impossible rate converts to null, never to zero',
     convertAmount(10, 'AUD', 'EUR', 0) === null &&
     convertAmount(10, 'AUD', 'EUR', null) === null &&
     convertAmount(10, 'AUD', 'EUR', NaN) === null)
  ok('an unknown currency converts to null',
     convertAmount(10, 'USD', 'EUR', 0.6) === null && convertAmount(10, 'AUD', 'USD', 0.6) === null)
  ok('a non-number amount converts to null', convertAmount('viel', 'AUD', 'EUR', 0.6) === null)
}

// ── 3. an expense carries its own rate ──────────────────────────────────────
{
  const march = expense({ original_amount: 10, exchange_rate_aud_eur: 0.5 })
  const september = expense({ id: 'e2', original_amount: 10, exchange_rate_aud_eur: 0.7 })
  ok('two expenses of the same AUD amount differ in EUR when their rates differ',
     amountIn(march, 'EUR') === 5 && amountIn(september, 'EUR') === 7)
  ok('and are identical in their own currency',
     amountIn(march, 'AUD') === 10 && amountIn(september, 'AUD') === 10)

  const inEuro = expense({ id: 'e3', original_amount: 30, original_currency: 'EUR', exchange_rate_aud_eur: 0.6 })
  ok('a EUR expense reads back as EUR unchanged and as AUD at its own rate',
     amountIn(inEuro, 'EUR') === 30 && amountIn(inEuro, 'AUD') === 50)
  ok('no expense at all is null, not zero', amountIn(null, 'EUR') === null)
}

// ── 4. the totals, in both display modes ────────────────────────────────────
{
  const rows = [
    expense({ id: 'a', original_amount: 20, original_currency: 'AUD', exchange_rate_aud_eur: 0.6 }),
    expense({ id: 'b', original_amount: 30, original_currency: 'EUR', exchange_rate_aud_eur: 0.6 }),
    expense({ id: 'c', original_amount: 10, original_currency: 'AUD', exchange_rate_aud_eur: 0.5 }),
  ]
  // AUD: 20 + (30 / 0.6 = 50) + 10 = 80
  ok('the AUD total converts every EUR row at its own rate', totalIn(rows, 'AUD') === 80)
  // EUR: (20 * 0.6 = 12) + 30 + (10 * 0.5 = 5) = 47
  ok('the EUR total converts every AUD row at its own rate', totalIn(rows, 'EUR') === 47)
  ok('the total is exactly the visible rows added up',
     totalIn(rows, 'EUR') === rows.reduce((s, r) => s + amountIn(r, 'EUR'), 0))
  ok('an empty tracker totals zero', totalIn([], 'AUD') === 0 && totalIn([], 'EUR') === 0)

  // A row the database could not produce must not silently drag the total to
  // NaN — it is skipped, and the rest still adds up.
  const broken = [...rows, expense({ id: 'x', exchange_rate_aud_eur: 0 })]
  ok('an unconvertible row is skipped instead of poisoning the sum',
     totalIn(broken, 'EUR') === 47)

  // Cent rounding: three 10 AUD rows at 0.5678 are 5.68 each on screen.
  const cents = [0, 1, 2].map((i) => expense({ id: 'r' + i, original_amount: 10, exchange_rate_aud_eur: 0.5678 }))
  ok('rounding happens per row, so the total matches what is printed',
     totalIn(cents, 'EUR') === 17.04)
}

// ── 5. order ────────────────────────────────────────────────────────────────
{
  const rows = [
    expense({ id: 'old', transaction_date: '2026-09-01' }),
    expense({ id: 'new', transaction_date: '2026-09-07' }),
    expense({ id: 'mid', transaction_date: '2026-09-05' }),
  ]
  ok('newest first', sortExpenses(rows).map((r) => r.id).join(',') === 'new,mid,old')

  const sameDay = [
    expense({ id: 'first', transaction_date: '2026-09-05', created_at: '2026-09-05T08:00:00.000Z' }),
    expense({ id: 'second', transaction_date: '2026-09-05', created_at: '2026-09-05T19:00:00.000Z' }),
  ]
  ok('within one day, the one entered later is on top',
     sortExpenses(sameDay).map((r) => r.id).join(',') === 'second,first')
  ok('sorting does not mutate the array it was given',
     sortExpenses(rows)[0] !== rows[0] || rows[0].id === 'old')
}

// ── 6. formatting ───────────────────────────────────────────────────────────
{
  ok('EUR keeps the € the rest of the app writes', nbsp(formatMoney(1234.5, 'EUR')) === '1.234,50 €')
  ok('AUD is unambiguous next to it', nbsp(formatMoney(1234.5, 'AUD')) === '1.234,50 AU$')
  ok('an unknown currency formats to nothing rather than to a wrong symbol',
     formatMoney(10, 'USD') === '' && formatMoney(NaN, 'EUR') === '')

  ok('the rate line reads as one sentence', nbsp(formatRate(0.58)) === '1 AUD = 0,58 €')
  ok('and keeps the precision the source publishes', nbsp(formatRate(0.5812)) === '1 AUD = 0,5812 €')
  ok('an impossible rate prints nothing at all', formatRate(0) === '' && formatRate(null) === '')

  ok('the three provenances have words',
     rateSourceLabel('live') === 'aktueller Kurs' &&
     rateSourceLabel('stored') === 'letzter bekannter Kurs' &&
     rateSourceLabel('seed') === 'Richtwert' &&
     rateSourceLabel('irgendwas') === '')

  const ref = new Date(2026, 8, 7) // 7. September 2026, local
  ok('today and yesterday get a word',
     formatExpenseDate('2026-09-07', ref) === 'Heute' && formatExpenseDate('2026-09-06', ref) === 'Gestern')
  ok('everything else in this year gets its date',
     formatExpenseDate('2026-03-12', ref) === '12. März')
  ok('another year keeps its year', formatExpenseDate('2025-12-24', ref) === '24. Dezember 2025')
  ok('no date is no text', formatExpenseDate(null, ref) === '' && formatExpenseDate('', ref) === '')

  ok('the count is German', expenseCountLabel(1) === '1 Ausgabe' && expenseCountLabel(4) === '4 Ausgaben')
}

// ── 7. reading a rate response ──────────────────────────────────────────────
{
  ok('the source is free, keyless and quoted with AUD as the base',
     RATE_ENDPOINT.startsWith('https://') && RATE_ENDPOINT.includes('base=AUD') &&
     RATE_ENDPOINT.includes('symbols=EUR') && !/key|token|apikey/i.test(RATE_ENDPOINT))

  ok('a good answer reads as its rate',
     parseRateResponse({ amount: 1, base: 'AUD', date: '2026-09-05', rates: { EUR: 0.5678 } }) === 0.5678)
  ok('and its date', parseRateDate({ date: '2026-09-05' }) === '2026-09-05')
  ok('a date that is not one is not invented', parseRateDate({ date: 'heute' }) === null && parseRateDate({}) === null)

  // Everything that is not a usable rate has to read as "no rate", so the
  // caller falls back instead of storing a wrong number on a row forever.
  for (const [name, body] of [
    ['an error body', { error: 'not found' }],
    ['a missing currency', { rates: { USD: 0.9 } }],
    ['a null rate', { rates: { EUR: null } }],
    ['a rate as text', { rates: { EUR: 'viel' } }],
    ['a zero rate', { rates: { EUR: 0 } }],
    ['a negative rate', { rates: { EUR: -0.6 } }],
    ['a rate off by a factor of a thousand', { rates: { EUR: 580 } }],
    ['nothing at all', null],
  ]) ok(name + ' is not a rate', parseRateResponse(body) === null)

  ok('the plausibility check accepts real rates and refuses nonsense',
     isPlausibleRate(0.58) && isPlausibleRate(0.75) && !isPlausibleRate(0) &&
     !isPlausibleRate(-1) && !isPlausibleRate(1000) && !isPlausibleRate('0,58'))
}

// ── 8. fetching, both outcomes ──────────────────────────────────────────────
{
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body })

  const good = await fetchAudEurRate({
    fetchImpl: async (url) => {
      if (url !== RATE_ENDPOINT) throw new Error('asked the wrong endpoint: ' + url)
      return okResponse({ amount: 1, base: 'AUD', date: '2026-09-04', rates: { EUR: 0.6012 } })
    },
  })
  ok('a successful request yields the rate and its date',
     good.rate === 0.6012 && good.date === '2026-09-04')

  let threw = false
  try {
    await fetchAudEurRate({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
  } catch { threw = true }
  ok('a 503 throws rather than returning a rate of zero', threw)

  threw = false
  try {
    await fetchAudEurRate({ fetchImpl: async () => { throw new Error('offline') } })
  } catch { threw = true }
  ok('no network throws', threw)

  threw = false
  try {
    await fetchAudEurRate({ fetchImpl: async () => okResponse({ rates: {} }) })
  } catch { threw = true }
  ok('a 200 without a usable rate throws too', threw)
}

// ── 9. the fallback chain ───────────────────────────────────────────────────
{
  const rows = [
    expense({ id: 'old', exchange_rate_aud_eur: 0.51, created_at: '2026-09-01T08:00:00.000Z' }),
    expense({ id: 'new', exchange_rate_aud_eur: 0.62, created_at: '2026-09-06T08:00:00.000Z' }),
  ]

  const live = resolveRate({ liveRate: 0.59, expenses: rows })
  ok('a loaded rate wins and says so', live.rate === 0.59 && live.source === 'live')

  const stored = resolveRate({ liveRate: null, expenses: rows })
  ok('without one, the last rate this account used stands in',
     stored.rate === 0.62 && stored.source === 'stored')

  const seed = resolveRate({ liveRate: null, expenses: [] })
  ok('with nothing at all, the built-in estimate stands in and is labelled as one',
     seed.rate === FALLBACK_RATE_AUD_EUR && seed.source === 'seed')

  ok('a broken live rate is not used', resolveRate({ liveRate: 0, expenses: rows }).source === 'stored')
  ok('resolveRate called with nothing still answers',
     resolveRate().rate === FALLBACK_RATE_AUD_EUR && resolveRate().source === 'seed')
  ok('the built-in estimate is itself a plausible rate', isPlausibleRate(FALLBACK_RATE_AUD_EUR))

  ok('the stored rate is the newest one, not the newest transaction date',
     lastStoredRate(rows) === 0.62)
  ok('rows with an unusable rate are ignored when looking for one',
     lastStoredRate([expense({ exchange_rate_aud_eur: null, created_at: '2027-01-01T00:00:00.000Z' }), ...rows]) === 0.62)
  ok('no rows means no stored rate', lastStoredRate([]) === null)
}

// ── 10. the writable whitelist ──────────────────────────────────────────────
// Same property tools/dataLogic.mjs asserts for tasks: a caller cannot name a
// server-managed column, whatever it hands the repository.
{
  ok('there is a whitelist, not a guess', WRITABLE_EXPENSE_FIELDS.length > 0)
  ok('a client never writes id, user_id or created_at',
     !WRITABLE_EXPENSE_FIELDS.includes('id') &&
     !WRITABLE_EXPENSE_FIELDS.includes('user_id') &&
     !WRITABLE_EXPENSE_FIELDS.includes('created_at'))
  ok('every column the module needs is writable',
     ['title', 'original_amount', 'original_currency', 'transaction_date', 'exchange_rate_aud_eur']
       .every((f) => WRITABLE_EXPENSE_FIELDS.includes(f)))

  const picked = pickWritableExpense({
    title: 'Kaffee', original_amount: 5, id: 'geschmuggelt', user_id: 'jemand-anders',
    created_at: '1999-01-01T00:00:00.000Z',
  })
  ok('a whole row handed in comes back without its server-managed columns',
     Object.keys(picked).sort().join(',') === 'original_amount,title')
}

console.log(\`expense logic: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'expenseLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/expenseLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
