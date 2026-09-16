// The preview screen in a real browser, at 390 px, with hostile content.
//
// Every other suite runs in jsdom, which has no layout: it can tell you an
// element exists, never that it fits. But the import preview is exactly the
// screen where content is not under the app's control — a bank writes
// descriptions as long as it likes, and the phone is 390 px wide.
//
// So this one renders the REAL PreviewStep with the REAL stylesheet from the
// last build, in the Chromium that is installed here, and measures what came
// out. `--dump-dom` runs the page's own scripts and hands back the DOM, which
// is enough to carry the measurements home.
//
// Requires `npm run build` first — it reads dist/assets/*.css, the actual
// stylesheet the app ships, not a reconstruction of it.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
const WIDTH = 390
const HEIGHT = 844

const cssDir = 'dist/assets'
const cssFile = existsSync(cssDir)
  ? readdirSync(cssDir).find((f) => f.startsWith('index-') && f.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('finance import layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

// ── The markup, rendered from the real component ─────────────────────────────
const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { PreviewStep } from './src/components/FinanceImportSheet.jsx'
import { previewRows, summarizePlan } from './src/lib/finance/importFlow.js'

// The worst statement the bank could plausibly send:
//  - a description far longer than the screen, and one without a single space
//    (nothing for the browser to break at)
//  - an amount with two thousands separators
//  - every outcome the preview knows, so no status string goes unmeasured
//  - and five hundred of them
const LONG = 'DAUERAUFTRAG Grundstücksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG, Verwendungszweck: Nebenkostenabrechnung 2025 nebst Nachzahlung gemäß Schreiben vom 12.03.2026'
const UNBREAKABLE = 'A'.repeat(220)
const OUTCOMES = ['new', 'duplicate', 'enriched', 'supersedes', 'supersedes_group', 'review', 'unresolved']

const bookings = []
const decisions = []
for (let i = 0; i < 500; i += 1) {
  const kind = i % 7
  bookings.push({
    booking_date: '2026-09-' + String((i % 28) + 1).padStart(2, '0'),
    amount_minor: kind === 0 ? -123456789 : kind === 1 ? 98765432 : -(i * 37 + 5),
    currency: 'EUR',
    raw_description: kind === 2 ? UNBREAKABLE : kind === 3 ? LONG : 'REWE Musterstadt ' + i,
  })
  decisions.push({ index: i, outcome: OUTCOMES[kind], tier: 1, existingIds: [] })
}

const plan = { decisions, refundCandidates: [] }
const totals = summarizePlan(plan)
const rows = previewRows(bookings, plan)

const markup = renderToStaticMarkup(
  createElement(PreviewStep, {
    totals,
    rows,
    statement: { result: { header: { period_start: '2026-09-01', period_end: '2026-09-28' }, warnings: [] } },
    busy: false,
    onApply: () => {},
  })
)
process.stdout.write(markup)
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'render.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['node:*', 'react', 'react-dom', 'react-dom/server', 'lucide-react'],
  loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const cache = `${process.cwd()}/node_modules/.cache`
mkdirSync(cache, { recursive: true })
writeFileSync(`${cache}/financeImportLayout.render.mjs`, bundled.outputFiles[0].text)

let markup = ''
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { chunks.push(chunk); return true }
  await import(pathToFileURL(`${cache}/financeImportLayout.render.mjs`).href)
  process.stdout.write = original
  markup = chunks.join('')
}

// ── The page, measured by itself ─────────────────────────────────────────────
const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<!-- The viewport, pinned. Chromium's --window-size does not reliably reach a
     --dump-dom run, and a layout measured at whatever width the browser felt
     like is not a measurement of the phone. -->
<style>html,body{margin:0;width:${WIDTH}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame"><div class="px-5 py-5 pb-10" id="sheet">${markup}</div></div>
<script>
const report = []
const add = (name, cond, detail) => report.push({ name, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const sheet = document.getElementById('sheet')
const frameRect = frame.getBoundingClientRect()

// Measured on the body and the frame, never on documentElement: for the root
// element the DOM reports the VIEWPORT, not the element, so a page pinned to
// 390 px would look 485 px wide and the assertion would be about the browser
// window instead of the phone.
const VIEWPORT = ${WIDTH}
add('the page does not scroll sideways at ' + VIEWPORT + 'px',
    document.body.scrollWidth <= VIEWPORT,
    document.body.scrollWidth + ' > ' + VIEWPORT)
add('…and the frame does not either',
    frame.scrollWidth <= frame.clientWidth + 0.5,
    frame.scrollWidth + ' > ' + frame.clientWidth)
add('…and the frame really is that wide', Math.round(frameRect.width) === VIEWPORT,
    Math.round(frameRect.width) + 'px')
add('the sheet body does not scroll sideways either',
    sheet.scrollWidth <= sheet.clientWidth + 1,
    sheet.scrollWidth + ' > ' + sheet.clientWidth)

// Nothing sticks out of the phone frame — checked on every element, because one
// unbreakable string in one row is all it takes.
let widest = null
for (const el of sheet.querySelectorAll('*')) {
  const r = el.getBoundingClientRect()
  if (r.width === 0) continue
  if (r.right > frameRect.right + 0.5 || r.left < frameRect.left - 0.5) {
    if (!widest || r.right > widest.right) widest = { right: r.right, tag: el.className }
  }
}
add('no element reaches past the phone frame', widest === null,
    widest ? widest.tag + ' bis x=' + Math.round(widest.right) : '')

const rows = sheet.querySelectorAll('.border-b, .flex.items-center.gap-3')
add('all 500 bookings are rendered', rows.length >= 500, 'gefunden: ' + rows.length)

// The description is allowed to be cut off — it is not allowed to push the
// amount out of the screen or wrap into a wall of text.
let amountsOutside = 0, titlesOverflowing = 0, clipped = 0
for (const row of rows) {
  const title = row.querySelector('p.truncate')
  const amount = row.querySelector('p.shrink-0')
  if (!title || !amount) continue
  const t = title.getBoundingClientRect(), a = amount.getBoundingClientRect()
  if (a.right > frameRect.right - 15 || a.width < 30) amountsOutside += 1
  if (t.right > a.left + 0.5) titlesOverflowing += 1
  if (title.scrollWidth > title.clientWidth + 1) clipped += 1
}
add('every amount stays inside the screen and keeps its width', amountsOutside === 0,
    amountsOutside + ' Beträge außerhalb')
add('no description overlaps the amount column', titlesOverflowing === 0,
    titlesOverflowing + ' Überlappungen')
add('the long descriptions are actually being cut off, not wrapped', clipped > 100,
    'abgeschnitten: ' + clipped)
add('…with an ellipsis rather than a hard cut',
    getComputedStyle(rows[0].querySelector('p.truncate')).textOverflow === 'ellipsis')

// A row stays one row: a 220-character description must not make it taller than
// the two lines it is designed for.
let tallest = 0, shortest = Infinity
for (const row of rows) {
  const h = row.getBoundingClientRect().height
  tallest = Math.max(tallest, h)
  shortest = Math.min(shortest, h)
}
add('every booking row is the same height, whatever the bank wrote', tallest - shortest < 2,
    Math.round(shortest) + '…' + Math.round(tallest) + 'px')
add('…and that height is two lines, not a paragraph', tallest <= 72, Math.round(tallest) + 'px')

// The two controls a finger has to hit.
for (const button of sheet.querySelectorAll('button')) {
  const r = button.getBoundingClientRect()
  add('the button „' + button.textContent.trim().slice(0, 28) + '" is tall enough to hit', r.height >= 44,
      Math.round(r.height) + 'px')
}

// Reading the amounts as a column only works if the digits line up.
const firstAmount = rows[0].querySelector('p.shrink-0')
add('amounts are set in tabular figures',
    getComputedStyle(firstAmount).fontVariantNumeric.includes('tabular-nums'))

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

const htmlPath = `${cache}/financeImportLayout.html`
writeFileSync(htmlPath, page)

const dom = execFileSync(
  CHROMIUM,
  ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${HEIGHT}`,
   '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
)

const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
if (!match) {
  console.error('finance import layout: der Browser hat nichts gemessen.')
  process.exit(1)
}
const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const report = JSON.parse(decoded)

let pass = 0, fail = 0
for (const entry of report) {
  if (entry.ok) pass += 1
  else { fail += 1; console.log(`  ✗ ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`) }
}
console.log(`finance import layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
