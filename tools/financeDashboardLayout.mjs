// Das Finanz-Dashboard in einem echten Browser, bei 390×844, 390×667, 430 und
// auf dem Schreibtisch.
//
// WAS HIER SCHIEFGEHEN KANN, und deshalb gemessen wird: auf diesem Bildschirm
// stehen Beträge neben Prozentzahlen neben Namen, die aus einem Kontoauszug
// stammen — „DB.Vertrieb.GmbH/508354771568" ist eine echte Beschreibung, und sie
// hat keine einzige Trennstelle. Dazu kommen ein Balkendiagramm mit bis zu zwölf
// Säulen auf 350 Pixeln und eine Kennzahl in 28px. Genau die Kombination, bei
// der eine Zeile umbricht, eine Zahl abgeschnitten wird oder der Rahmen
// seitwärts scrollt.
//
// Gemessen wird der ECHTE Block: `Overview` aus src/screens/Finanzen.jsx, mit
// Daten aus der echten Pipeline (`buildFinanceDashboard`). Kein nachgebautes
// Markup — das wäre ein Test über den Nachbau.
//
// Braucht `npm run build` vorher: gelesen wird dist/assets/*.css.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
// 390×844 und 390×667 sind die beiden Telefone, 430 der obere Rand des Rahmens,
// 1280 die Frage „bricht es auf dem Schreibtisch?".
const VIEWPORTS = [[390, 844], [390, 667], [430, 844], [1280, 900]]

const cssDir = 'dist/assets'
const cssFile = existsSync(cssDir)
  ? readdirSync(cssDir).find((f) => f.startsWith('index-') && f.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('finance dashboard layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Overview, Bookings, MixedCurrency } from './src/screens/Finanzen.jsx'
import { Stepper } from './src/components/FinancePeriodSheet.jsx'
import { buildFinanceDashboard } from './src/lib/finance/analytics/index.js'
import { financeCategoryRows } from './tools/fixtures/financeCategories.mjs'
import { tokenize } from './src/lib/finance/normalize.js'

const CATEGORIES = financeCategoryRows()
const cat = (slug) => CATEGORIES.find((c) => c.slug === slug).id
const TODAY = '2026-09-12'
const ACCOUNT = 'acc-1'

// Das Schlimmste, was ein Kontoauszug plausibel liefert.
const UNBREAKABLE = 'DB.Vertrieb.GmbH/5083547715681234567890123456789012345678901234567890'
const LONG_MERCHANT = 'Wohnungsbaugenossenschaft Berlin-Mitte eingetragene Genossenschaft'

let seq = 0
const tx = (over) => {
  seq += 1
  const raw = over.raw_description ?? ('BUCHUNG ' + seq)
  return {
    id: 'tx-' + seq, account_id: ACCOUNT, currency: 'EUR',
    raw_description: raw, normalized_tokens: tokenize(raw),
    transaction_type: 'purchase', include_in_analytics: true, manual_lock: false,
    merchant_id: null, category_id: null, ...over, raw_description: raw,
  }
}

const M1 = 'm-rewe'
const M2 = 'm-lang'
const merchants = [
  { id: M1, canonical_name: 'REWE', review_mode: 'auto' },
  { id: M2, canonical_name: LONG_MERCHANT, review_mode: 'auto' },
]
const patterns = [
  { id: 'p1', merchant_id: M1, pattern_type: 'exact_token', tokens: ['REWE'], active: true },
  { id: 'p2', merchant_id: M2, pattern_type: 'exact_token', tokens: ['MIETE'], active: true },
]
const rules = [
  { id: 'r1', merchant_id: M1, category_id: cat('lebensmittel'), active: true,
    min_amount_minor: null, max_amount_minor: null, min_inclusive: true,
    max_inclusive: true, currency: null },
  { id: 'r2', merchant_id: M2, category_id: cat('miete_nebenkosten'), active: true,
    min_amount_minor: null, max_amount_minor: null, min_inclusive: true,
    max_inclusive: true, currency: null },
]

const transactions = [
  tx({ booking_date: '2026-09-02', amount_minor: -142099, raw_description: 'MIETE SEPTEMBER' }),
  tx({ booking_date: '2026-09-03', amount_minor: -29420, raw_description: 'REWE TROISDORF' }),
  tx({ booking_date: '2026-09-04', amount_minor: -12720, category_id: cat('restaurant') }),
  tx({ booking_date: '2026-09-05', amount_minor: -24820, category_id: cat('klamotten') }),
  tx({ booking_date: '2026-09-06', amount_minor: -17790, category_id: cat('bahn_oepnv') }),
  tx({ booking_date: '2026-09-07', amount_minor: -13120, category_id: cat('games_medien') }),
  tx({ booking_date: '2026-09-08', amount_minor: -8940, category_id: cat('fitnessstudio') }),
  tx({ booking_date: '2026-09-09', amount_minor: -6065, raw_description: UNBREAKABLE }),
  tx({ booking_date: '2026-09-10', amount_minor: 205000, transaction_type: 'income' }),
  tx({ booking_date: '2026-09-11', amount_minor: -50000, transaction_type: 'transfer' }),
  // Der Vergleichszeitraum, damit die Prozentzeile echt ist.
  tx({ booking_date: '2026-08-05', amount_minor: -230000 }),
  // Und ein Jahr Historie fuer den Verlauf.
  ...Array.from({ length: 10 }, (_, i) =>
    tx({ booking_date: '2025-' + String(i + 1).padStart(2, '0') + '-15',
         amount_minor: -(90000 + i * 7000) })),
]

const dashboard = buildFinanceDashboard({
  transactions, categories: CATEGORIES, merchants, patterns, rules,
  accounts: [{ id: ACCOUNT, name: 'DKB Girokonto', currency: 'EUR' }],
  today: TODAY, trendRange: '1J',
})

const noop = () => {}
const overview = renderToStaticMarkup(
  createElement(Overview, {
    dashboard, currency: 'EUR', trendRange: '1J', onTrendRange: noop,
    onAdd: noop, onClassify: noop,
  })
)
const bookings = renderToStaticMarkup(createElement(Bookings, { dashboard }))

// Zwei Waehrungen: die Karte, die statt der Zahlen steht.
const mixedDashboard = buildFinanceDashboard({
  transactions: [
    transactions[0],
    { ...transactions[1], id: 'tx-aud', currency: 'AUD', account_id: 'acc-aud' },
  ],
  categories: CATEGORIES, merchants, patterns, rules,
  accounts: [
    { id: ACCOUNT, name: 'DKB Girokonto', currency: 'EUR' },
    { id: 'acc-aud', name: 'Australien', currency: 'AUD' },
  ],
  today: TODAY,
})
const mixed = renderToStaticMarkup(
  createElement(MixedCurrency, {
    dashboard: mixedDashboard, onPickAccount: noop, onAdd: noop, onClassify: noop,
  })
)

// Der Monats-/Jahresschalter des Zeitraum-Sheets.
const stepper = renderToStaticMarkup(
  createElement('div', { className: 'px-5' },
    createElement(Stepper, {
      label: 'September 2026', previousLabel: 'Vorheriger Monat',
      nextLabel: 'Naechster Monat', onPrevious: noop, onNext: noop, atEnd: true,
    }),
    createElement(Stepper, {
      label: 'Dezember 2025', previousLabel: 'Vorheriger Monat',
      nextLabel: 'Naechster Monat', onPrevious: noop, onNext: noop, atEnd: false,
    })
  )
)

process.stdout.write(JSON.stringify({
  overview, bookings, mixed, stepper,
  expected: {
    expenses: dashboard.summary.expenses,
    parents: dashboard.categories.top.length,
    merchants: dashboard.merchants.merchants.length,
    biggest: dashboard.biggest.length,
    buckets: dashboard.trend.buckets.length,
    open: dashboard.summary.openClassifications,
  },
}))
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'renderDashboard.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['node:*', 'react', 'react-dom', 'react-dom/server', 'react-router-dom',
             'lucide-react', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const cache = `${process.cwd()}/node_modules/.cache`
mkdirSync(cache, { recursive: true })
writeFileSync(`${cache}/financeDashboardLayout.render.mjs`, bundled.outputFiles[0].text)

let rendered = null
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  await import(pathToFileURL(`${cache}/financeDashboardLayout.render.mjs`).href)
  process.stdout.write = original
  rendered = JSON.parse(chunks.join(''))
}

const pageFor = (width, height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;width:${width}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame">
  <div class="px-5" id="overview">${rendered.overview}</div>
  <div class="px-5" id="bookings">${rendered.bookings}</div>
  <div class="px-5" id="mixed">${rendered.mixed}</div>
  <div id="stepper">${rendered.stepper}</div>
</div>
<script>
const VIEWPORT = ${width}
const SCREEN = '${width}x${height}'
const EXPECTED = ${JSON.stringify(rendered.expected)}
const report = []
const add = (name, cond, detail) => report.push({ name: name + ' @' + SCREEN, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const frameRect = frame.getBoundingClientRect()
const box = (el) => el.getBoundingClientRect()

add('die Seite scrollt nicht seitwärts',
    document.body.scrollWidth <= VIEWPORT + 0.5, document.body.scrollWidth + ' > ' + VIEWPORT)
add('der Rahmen bleibt bei 430px stehen',
    frameRect.width <= 430.5, Math.round(frameRect.width) + 'px')
add('…und scrollt selbst nicht seitwärts',
    frame.scrollWidth <= frame.clientWidth + 0.5, frame.scrollWidth + ' > ' + frame.clientWidth)

let outside = null
for (const el of frame.querySelectorAll('*')) {
  const r = box(el)
  if (r.width === 0) continue
  if (r.right > frameRect.right + 0.5 || r.left < frameRect.left - 0.5) {
    if (!outside || r.right > outside.right) outside = { right: r.right, tag: el.className }
  }
}
add('nichts ragt über den Telefonrahmen hinaus', outside === null,
    outside ? String(outside.tag).slice(0, 60) + ' bis x=' + Math.round(outside.right) : '')

const overview = document.getElementById('overview')
const text = overview.textContent

// ── Die Kennzahl ──────────────────────────────────────────────────────────
add('die Ausgaben stehen als eine Zahl da', text.includes('Ausgaben'))
add('…mit dem Vergleich darunter', /ggü\\./.test(text), text.slice(0, 120))
add('Einnahmen und Cashflow stehen zweispaltig darunter',
    text.includes('Einnahmen') && text.includes('Cashflow'))
{
  const kpi = overview.querySelector('section')
  const big = [...kpi.querySelectorAll('p')].find((p) => /€/.test(p.textContent))
  add('die Kennzahl wird nicht abgeschnitten',
      big.scrollWidth <= big.clientWidth + 1, big.scrollWidth + ' vs ' + big.clientWidth)
  add('…und ist die größte Schrift auf dem Schirm',
      parseFloat(getComputedStyle(big).fontSize) >= 28,
      getComputedStyle(big).fontSize)
}

// ── Touch targets ─────────────────────────────────────────────────────────
let small = null
for (const el of overview.querySelectorAll('button')) {
  const r = box(el)
  if (r.height === 0 && r.width === 0) continue
  // Die Balken des Diagramms sind schmal, aber ihre Trefferfläche ist der
  // ganze Streifen — gemessen wird die Höhe, die Breite teilen sie sich.
  if (r.height < 36 && (!small || r.height < small.h)) {
    small = { h: r.height, tag: String(el.className).slice(0, 50) }
  }
}
add('jede Schaltfläche ist mindestens 36px hoch', small === null,
    small ? Math.round(small.h) + 'px: ' + small.tag : '')

// Die Zeilen, die ein Mensch mit dem Daumen trifft, sind 44px oder mehr.
{
  const rows = [...overview.querySelectorAll('button')].filter((b) => box(b).width > 200)
  let tooShort = null
  for (const row of rows) {
    const h = box(row).height
    if (h < 44 && (!tooShort || h < tooShort)) tooShort = h
  }
  add('jede breite Zeile ist mindestens 44px hoch', tooShort === null,
      tooShort ? Math.round(tooShort) + 'px' : '')
}

// ── Die Abschnitte ────────────────────────────────────────────────────────
for (const title of ['Ausgaben nach Kategorie', 'Ausgabenentwicklung', 'Top-Händler',
                     'Größte Ausgaben']) {
  add('der Abschnitt „' + title + '" steht da', text.includes(title))
}

// ── Kategorien: Balken, Prozent, Abschneiden ──────────────────────────────
{
  const bars = [...overview.querySelectorAll('.bg-accent')]
  add('es gibt Kategoriebalken', bars.length > 0, bars.length + '')
  add('kein Balken ist breiter als seine Spur',
      bars.every((b) => box(b).width <= box(b.parentElement).width + 0.5))
  add('genau fünf Oberkategorien', EXPECTED.parents === 5, EXPECTED.parents + '')
  add('alle Balken sind blau — keine Kategorie-Palette',
      new Set(bars.map((b) => getComputedStyle(b).backgroundColor)).size === 1)
}

// ── Verlauf ───────────────────────────────────────────────────────────────
{
  const chartButtons = [...overview.querySelectorAll('[role="group"][aria-label="Ausgaben je Zeitraum"] button')]
  add('zwölf Monatsbalken passen nebeneinander',
      chartButtons.length === EXPECTED.buckets, chartButtons.length + ' von ' + EXPECTED.buckets)
  add('…und keiner ist schmaler als 8px',
      chartButtons.every((b) => box(b).width >= 8),
      Math.round(Math.min(...chartButtons.map((b) => box(b).width))) + 'px')
  add('…und sie bleiben im Rahmen',
      chartButtons.every((b) => box(b).right <= frameRect.right + 0.5))
  const partial = chartButtons[chartButtons.length - 1].querySelector('span')
  add('der laufende Balken ist derselbe Balken mit weniger Deckkraft',
      parseFloat(getComputedStyle(partial).opacity) < 1,
      getComputedStyle(partial).opacity)
}

// ── Händler und größte Ausgaben: lange Namen ──────────────────────────────
{
  const truncated = [...overview.querySelectorAll('.truncate')]
  add('lange Namen werden abgeschnitten, nicht umgebrochen',
      truncated.some((el) => el.scrollWidth > el.clientWidth))
  add('…und keine Zeile wächst über 96px',
      [...overview.querySelectorAll('.min-h-\\\\[56px\\\\]')].every((r) => box(r).height <= 96))
}

// ── Der Buchungen-Tab ─────────────────────────────────────────────────────
{
  const bookings = document.getElementById('bookings')
  add('der Buchungen-Tab listet Buchungen', bookings.textContent.includes('Buchungen'))
  add('…und bleibt im Rahmen',
      [...bookings.querySelectorAll('*')].every((el) =>
        box(el).width === 0 || box(el).right <= frameRect.right + 0.5))
}

// ── Zwei Waehrungen ───────────────────────────────────────────────────────
{
  const mixed = document.getElementById('mixed')
  const t = mixed.textContent
  add('die Waehrungsmeldung steht da', t.includes('Mehrere Währungen'))
  add('…und sagt, was zu tun ist', t.includes('Wähle ein einzelnes Konto'))
  add('…und zeigt keine gemeinsame Summe', !/€|AU\\$|[0-9]+,[0-9]{2}/.test(t), t.slice(0, 120))
  const cta = [...mixed.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Konto wählen')
  add('der Weg zum Kontofilter ist ein Knopf', Boolean(cta))
  add('…und daumengross', cta && box(cta).height >= 44, cta ? Math.round(box(cta).height) + 'px' : '')
  add('…und bleibt im Rahmen', cta && box(cta).right <= frameRect.right + 0.5)
  add('nichts in der Karte laeuft ueber',
      [...mixed.querySelectorAll('*')].every((el) =>
        box(el).width === 0 || box(el).right <= frameRect.right + 0.5))
}

// ── Der Monats-/Jahresschalter ────────────────────────────────────────────
{
  const stepper = document.getElementById('stepper')
  const arrows = [...stepper.querySelectorAll('button')]
  add('vier Pfeile, zwei je Schalter', arrows.length === 4, arrows.length + '')
  let smallest = null
  for (const a of arrows) {
    const r = box(a)
    if (!smallest || r.height < smallest.h || r.width < smallest.w) {
      smallest = { h: Math.min(r.height, smallest ? smallest.h : r.height),
                   w: Math.min(r.width, smallest ? smallest.w : r.width) }
    }
  }
  add('jeder Pfeil ist mindestens 44x44', smallest && smallest.h >= 44 && smallest.w >= 44,
      smallest ? Math.round(smallest.w) + 'x' + Math.round(smallest.h) : '')
  add('jeder Pfeil sagt, was er tut',
      arrows.every((a) => (a.getAttribute('aria-label') || '').length > 5))
  add('am Rand ist der Pfeil nach vorn deaktiviert',
      arrows.filter((a) => a.disabled).length === 1,
      arrows.filter((a) => a.disabled).length + '')
  add('…und bleibt trotzdem stehen, statt die Leiste springen zu lassen',
      arrows.filter((a) => a.disabled).every((a) => box(a).width >= 44))
  const labels = [...stepper.querySelectorAll('span')]
  add('die Beschriftung steht in der Mitte und wird nicht abgeschnitten',
      labels.every((l) => l.scrollWidth <= l.clientWidth + 1))
}

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

let pass = 0
let fail = 0
for (const [width, height] of VIEWPORTS) {
  const htmlPath = `${cache}/financeDashboardLayout-${width}x${height}.html`
  writeFileSync(htmlPath, pageFor(width, height))

  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${width},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )

  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) {
    console.error(`finance dashboard layout: der Browser hat bei ${width}×${height} nichts gemessen.`)
    process.exit(1)
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  for (const entry of JSON.parse(decoded)) {
    if (entry.ok) pass += 1
    else {
      fail += 1
      console.log(`  ✗ ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`)
    }
  }
}

console.log(`finance dashboard layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
