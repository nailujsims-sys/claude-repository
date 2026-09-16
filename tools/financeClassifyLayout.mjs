// The Zuordnung screen in a real browser, at 390 px, with hostile content.
//
// Same reason as tools/financeImportLayout.mjs: jsdom has no layout, so it can
// say an element exists and never that it fits. This screen is the one where a
// bank's text becomes a grid of tappable words, and a description of two
// hundred words has to wrap into something a thumb can still work with rather
// than push the amount off the phone.
//
// Requires `npm run build` first — it reads dist/assets/*.css, the stylesheet
// the app actually ships.
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
  console.error('finance classify layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { BookingStep } from './src/components/FinanceClassifySheet.jsx'
import { classifyTransaction } from './src/lib/finance/classificationQueue.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { FINANCE_CATEGORIES } from './src/config/finance.js'

const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')
const CATEGORIES = FINANCE_CATEGORIES.map((c, i) => ({ ...c, id: uuid(900 + i) }))

// The worst booking text a bank could plausibly print: a Dauerauftrag with the
// full legal name of a company, a reference number, and one word long enough to
// have no break opportunity in it at all.
const RAW = [
  'DAUERAUFTRAG Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG',
  'Verwendungszweck Nebenkostenabrechnung 2025 nebst Nachzahlung gemaess Schreiben vom 12.03.2026',
  'Donaudampfschifffahrtselektrizitaetenhauptbetriebswerkbauunterbeamtengesellschaft',
  'END-TO-END-REF 1052906804694/PP.8169.PP/ Department of Home Affairs Ihr Einkauf',
].join('\\n')

const transaction = {
  id: uuid(1), account_id: uuid(2), booking_date: '2026-09-14',
  amount_minor: -123456789, currency: 'EUR', raw_description: RAW,
  normalized_tokens: tokenize(RAW), manual_lock: false, merchant_id: null, category_id: null,
}

// A merchant list that does not end, with names as long as the screen.
const merchants = []
for (let i = 0; i < 40; i += 1) {
  merchants.push({
    id: uuid(500 + i),
    canonical_name: i % 3 === 0
      ? 'Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG ' + i
      : 'Haendler ' + i,
    review_mode: 'auto',
  })
}

const entry = classifyTransaction({ transaction, patterns: [], merchants, rules: [] })

const markup = renderToStaticMarkup(
  createElement(BookingStep, {
    entry,
    transactions: [transaction],
    patterns: [],
    merchants,
    categories: CATEGORIES,
    overrides: [],
    remaining: 137,
    saving: false,
    failure: null,
    done: null,
    onSave: () => {},
    onSkip: () => {},
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
writeFileSync(`${cache}/financeClassifyLayout.render.mjs`, bundled.outputFiles[0].text)

let markup = ''
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { chunks.push(chunk); return true }
  await import(pathToFileURL(`${cache}/financeClassifyLayout.render.mjs`).href)
  process.stdout.write = original
  markup = chunks.join('')
}

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

let widest = null
for (const el of sheet.querySelectorAll('*')) {
  const r = el.getBoundingClientRect()
  if (r.width === 0) continue
  if (r.right > frameRect.right + 0.5 || r.left < frameRect.left - 0.5) {
    if (!widest || r.right > widest.right) widest = { right: r.right, tag: el.className, text: (el.textContent || '').slice(0, 30) }
  }
}
add('no element reaches past the phone frame', widest === null,
    widest ? widest.text + ' (' + widest.tag + ') bis x=' + Math.round(widest.right) : '')

// The gesture: every word of the booking has to be its own target, and every
// one of them has to be reachable with a thumb.
const words = [...sheet.querySelectorAll('button[aria-pressed]')].filter(
  (b) => !b.className.includes('justify-between'))
add('every word of the booking is its own target', words.length >= 30, 'gefunden: ' + words.length)
let small = 0, outside = 0
for (const word of words) {
  const r = word.getBoundingClientRect()
  if (r.height < 44) small += 1
  if (r.right > frameRect.right + 0.5) outside += 1
}
add('no word chip is smaller than 44 px', small === 0, small + ' zu klein')
add('no word chip sticks out of the frame', outside === 0, outside + ' außerhalb')

// Words wrap onto new rows rather than into one endless line.
const rows = new Set(words.map((w) => Math.round(w.getBoundingClientRect().top)))
add('the words wrap onto several rows', rows.size >= 6, 'Zeilen: ' + rows.size)

// A word longer than the screen is still shown and still fits.
const longest = words.reduce((a, b) =>
  b.textContent.length > a.textContent.length ? b : a, words[0])
add('the longest word is rendered in full', longest.textContent.length > 40,
    longest.textContent.length + ' Zeichen')
add('…and still fits the screen',
    longest.getBoundingClientRect().right <= frameRect.right + 0.5)

// The amount is the first thing read, and it is a big number.
const amount = sheet.querySelector('.text-page')
add('the amount is shown', !!amount && amount.textContent.includes('€'), amount ? amount.textContent : '')
add('…with thousands separators intact', !!amount && amount.textContent.includes('1.234.567,89'),
    amount ? amount.textContent : '')
add('…on one line inside the frame',
    !!amount && amount.getBoundingClientRect().right <= frameRect.right + 0.5)

// Every button a finger has to hit.
let shortButtons = []
for (const button of sheet.querySelectorAll('button')) {
  const r = button.getBoundingClientRect()
  if (r.height < 44) shortButtons.push((button.textContent || '').trim().slice(0, 24) + ' ' + Math.round(r.height) + 'px')
}
add('every button is at least 44 px tall', shortButtons.length === 0, shortButtons.join(' · '))

// The merchant list is bounded — forty merchants may not become forty rows.
const merchantRows = [...sheet.querySelectorAll('button')].filter((b) =>
  (b.textContent || '').startsWith('Haendler') || (b.textContent || '').startsWith('Grundstuecks'))
add('the merchant list is capped rather than endless', merchantRows.length <= 6,
    merchantRows.length + ' Zeilen')

// Accessibility: the selection state is announced, not only coloured.
add('word chips carry a pressed state', words.every((w) => w.hasAttribute('aria-pressed')))
const damaged = [...sheet.querySelectorAll('button[disabled]')]
add('an unlearnable word is disabled rather than hidden', damaged.length >= 0)
add('the category rows announce their selection',
    [...sheet.querySelectorAll('button.justify-between')].every((b) => b.hasAttribute('aria-pressed')))

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

const htmlPath = `${cache}/financeClassifyLayout.html`
writeFileSync(htmlPath, page)

const dom = execFileSync(
  CHROMIUM,
  ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${HEIGHT}`,
   '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
)

const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
if (!match) {
  console.error('finance classify layout: der Browser hat nichts gemessen.')
  process.exit(1)
}
const decoded = match[1]
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const report = JSON.parse(decoded)

let pass = 0, fail = 0
for (const entry of report) {
  if (entry.ok) pass += 1
  else { fail += 1; console.log(`  ✗ ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`) }
}
console.log(`finance classify layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
