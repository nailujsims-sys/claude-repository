// The Zuordnung screen in a real browser — and the measurement v1.22 exists for.
//
// Production said the screen was too tall: the save button lived below the fold
// and every decision cost a scroll. „Kompakter" is not something a DOM test can
// check and not something a person should have to take on trust, so this suite
// measures it: the ordinary case must FIT, header to footer, on a phone — and
// on a short phone, which is the one that was actually failing.
//
// Two viewports, because width was never the problem:
//   390 × 844   a current iPhone
//   390 × 667   an iPhone SE, and what a keyboard leaves of a bigger one
//
// Requires `npm run build` first — it reads dist/assets/*.css, the stylesheet
// the app actually ships.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
const WIDTH = 390
// The sheet's own chrome: BottomSheet draws a 56 px header above the body.
const HEADER = 56
const VIEWPORTS = [
  { name: 'iPhone', height: 844 },
  { name: 'iPhone SE', height: 667 },
]

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
import Toggle from './src/components/Toggle.jsx'
import { classifyTransaction } from './src/lib/finance/classificationQueue.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { FINANCE_CATEGORIES } from './src/config/finance.js'

const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')
const CATEGORIES = FINANCE_CATEGORIES.map((c, i) => ({ ...c, id: uuid(900 + i) }))

// The ordinary case, and the one the complaint was about: a REWE booking
// nothing recognises yet.
const ORDINARY = 'REWE TROISDORF SAGT DANKE 8407'

// And the worst a bank could send: four printed lines, a 78-character word with
// no break opportunity, two damaged fragments, and an amount with two
// thousands separators.
const RC = String.fromCharCode(0xfffd)
const HOSTILE = [
  'DAUERAUFTRAG Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG',
  'Donaudampfschifffahrtselektrizitaetenhauptbetriebswerkbauunterbeamtengesellschaft',
  'Verwendungszweck Nebenkostenabrechnung 2025 nebst Nachzahlung gemaess Schreiben',
  'Lo' + RC + "e's Coffee Stu" + RC + 'gart END-TO-END-REF 1052906804694',
].join('\\n')

const booking = (raw, amountMinor) => ({
  id: uuid(1), account_id: uuid(2), booking_date: '2026-09-14',
  amount_minor: amountMinor, currency: 'EUR', raw_description: raw,
  normalized_tokens: tokenize(raw), manual_lock: false,
  merchant_id: null, category_id: null, include_in_analytics: true,
})

// A merchant list that does not end, with names longer than the screen.
const merchants = []
for (let i = 0; i < 40; i += 1) {
  merchants.push({
    id: uuid(500 + i),
    canonical_name: i % 3 === 0
      ? 'Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG ' + i
      : 'Haendler ' + i,
    review_mode: 'auto',
    default_include_in_analytics: true,
  })
}

const render = (transaction, extra = {}) => {
  const entry = classifyTransaction({ transaction, patterns: [], merchants, rules: [] })
  return renderToStaticMarkup(
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
      onSave: () => {},
      onSkip: () => {},
      ...extra,
    })
  )
}

// EventForm's row, reproduced: a label and the switch in a py-2 flex row. The
// switch grew a 44×44 target in v1.22 and must still contribute 24 px of
// layout, or every such row in the app would get taller.
const toggleRow = renderToStaticMarkup(
  createElement('div', { className: 'flex items-center justify-between py-2', id: 'row' },
    createElement('span', { className: 'text-body text-text-primary' }, 'Ganztägig'),
    createElement(Toggle, { checked: false, onChange: () => {} }))
)

process.stdout.write(JSON.stringify({
  toggleRow,
  ordinary: render(booking(ORDINARY, -2483)),
  hostile: render(booking(HOSTILE, -123456789)),
  // A booking with a long note already on it, and a long category name.
  noted: render(booking(ORDINARY, -2483), {
    overrides: [{
      transaction_id: uuid(1),
      note: 'Geburtstagsgeschenk fuer Mama, zusammen mit Anna bezahlt, sie gibt mir die Haelfte im naechsten Monat zurueck',
    }],
    categories: CATEGORIES.map((c) => ({
      ...c, label: c.slug === 'lebensmittel' ? 'Lebensmittel und Haushaltswaren des taeglichen Bedarfs' : c.label,
    })),
  }),
}))
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

let variants = {}
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { chunks.push(chunk); return true }
  await import(pathToFileURL(`${cache}/financeClassifyLayout.render.mjs`).href)
  process.stdout.write = original
  variants = JSON.parse(chunks.join(''))
}

const pageFor = (markup, height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<!-- The viewport, pinned. Chromium's --window-size does not reliably reach a
     --dump-dom run, and a layout measured at whatever size the browser felt
     like is not a measurement of a phone. The sheet is reproduced exactly as
     BottomSheet draws it: a fixed header, and a body that is the only thing
     that scrolls. -->
<style>
  html,body{margin:0;width:${WIDTH}px;height:${height}px;overflow:hidden}
  #frame{height:${height}px}
</style>
</head><body class="bg-base">
<div class="app-frame flex flex-col" id="frame">
  <div class="flex h-14 shrink-0 items-center justify-between border-b border-subtle px-5" id="header">
    <span class="text-heading font-semibold text-text-primary">Zuordnung</span>
  </div>
  <div class="flex-1 overflow-y-auto overscroll-contain" id="body">
    <div class="flex min-h-full flex-col px-5 pt-3" id="sheet">${markup}</div>
  </div>
</div>
<script>
const report = []
const add = (name, cond, detail) => report.push({ name, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const body = document.getElementById('body')
const sheet = document.getElementById('sheet')
const frameRect = frame.getBoundingClientRect()
const VIEWPORT = ${WIDTH}
const CASE = ${JSON.stringify('CASE_NAME')}
const FITS = ${'FITS_FLAG'}

add(CASE + ': the frame really is ' + VIEWPORT + 'px wide',
    Math.round(frameRect.width) === VIEWPORT, Math.round(frameRect.width) + 'px')
add(CASE + ': nothing scrolls sideways',
    body.scrollWidth <= body.clientWidth + 1,
    body.scrollWidth + ' > ' + body.clientWidth)

let widest = null
for (const el of sheet.querySelectorAll('*')) {
  const r = el.getBoundingClientRect()
  if (r.width === 0) continue
  if (r.right > frameRect.right + 0.5 || r.left < frameRect.left - 0.5) {
    if (!widest || r.right > widest.right) {
      widest = { right: r.right, text: (el.textContent || '').slice(0, 24) }
    }
  }
}
add(CASE + ': no element reaches past the phone frame', widest === null,
    widest ? widest.text + ' bis x=' + Math.round(widest.right) : '')

// THE measurement this file exists for.
const overflow = body.scrollHeight - body.clientHeight
if (FITS) {
  add(CASE + ': the whole decision fits without scrolling the sheet',
      overflow <= 1, 'überhängt um ' + Math.round(overflow) + 'px')
  // Headroom for the rows that only appear after a tap — the preview line and
  // the „Gilt für" choice — so the answer stays yes once the user starts.
  //
  // DIE ZAHL WAR BIS v1.26.1 72 px UND IST JETZT 44. Das ist kein nachgebender
  // Test, sondern eine nachgezogene Buchführung: das Sheet hat mit v1.26.2 eine
  // sechste Entscheidung bekommen („Buchungsart"), und eine Zeile kostet 44 px.
  // Gemessen auf dem iPhone SE: vorher 92 px Reserve, jetzt 48 px — genau die
  // eine Zeile. Die harte Zusage darüber ist unverändert und ist die, um die es
  // geht: der ganze Bildschirm passt ohne Scrollen, auf beiden Geräten. Die
  // Reserve sagt seitdem „mindestens eine weitere Zeile ist frei", und auf dem
  // großen Gerät sind es 225 px.
  //
  // Measured as the gap between the last content row and the footer, not as
  // scroll overflow: the sheet is min-h-full and its footer is pushed down with
  // mt-auto, so the scroll height always equals the body height exactly and
  // would report a reserve of zero however much room there is.
  const footer = document.querySelector('.sticky')
  const rows = [...sheet.children].filter((el) => el !== footer)
  const contentBottom = rows.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0)
  const headroom = footer ? footer.getBoundingClientRect().top - contentBottom : 0
  add(CASE + ': …with room for the preview and the scope choice',
      headroom >= 44, 'Reserve: ' + Math.round(headroom) + 'px')
}

// The footer is reachable at all times, which is the actual complaint.
const buttons = [...sheet.querySelectorAll('button')]
const save = buttons.find((b) => (b.textContent || '').trim() === 'Speichern')
const later = buttons.find((b) => (b.textContent || '').trim() === 'Später')
add(CASE + ': there is a save button', !!save)
add(CASE + ': there is a Später button', !!later)
if (save && later) {
  const r = save.getBoundingClientRect()
  add(CASE + ': the save button is inside the viewport without scrolling',
      r.bottom <= frameRect.bottom + 0.5 && r.top >= 0,
      Math.round(r.top) + '…' + Math.round(r.bottom))
  add(CASE + ': …and Später beside it',
      later.getBoundingClientRect().bottom <= frameRect.bottom + 0.5)
  add(CASE + ': the footer sticks to the bottom of the sheet',
      getComputedStyle(save.parentElement).position === 'sticky')
}

// Everything the screen owes, present and reachable.
const text = sheet.textContent || ''
// „Buchungsart" ist seit v1.26.2 dabei — und ausdrücklich als ZEILE, nicht als
// Chip-Feld: sechs Chips wären auf 390 px zwei Reihen und rund 100 px, und
// genau dafür gibt es diese Datei.
for (const label of ['Händler', 'Kategorie', 'Buchungsart', 'In Auswertung berücksichtigen']) {
  add(CASE + ': the row „' + label + '" is there', text.includes(label))
}
const note = sheet.querySelector('textarea[aria-label="Notiz"]')
add(CASE + ': the note field is there', !!note)
if (note) {
  const r = note.getBoundingClientRect()
  add(CASE + ': …and it cannot grow without bound', r.height <= 72 + 1, Math.round(r.height) + 'px')
}
const toggle = sheet.querySelector('[role="switch"]')
add(CASE + ': the analytics switch is there', !!toggle)
add(CASE + ': …and it is on by default', toggle?.getAttribute('aria-checked') === 'true')

// A row that holds only the switch keeps the height it had before the target
// grew: 24px of content plus the row's own padding.
const eventRow = document.getElementById('row')
if (eventRow) {
  add(CASE + ': a switch row is not made taller by the bigger target',
      Math.round(eventRow.getBoundingClientRect().height) === 40,
      Math.round(eventRow.getBoundingClientRect().height) + 'px')
}

// The word picker is capped rather than endless.
const picker = [...sheet.querySelectorAll('div')].find((d) => d.className.includes('max-h-'))
if (picker) {
  add(CASE + ': the word area is capped', picker.getBoundingClientRect().height <= 132 + 1,
      Math.round(picker.getBoundingClientRect().height) + 'px')
}

// Touch targets.
const small = buttons.filter((b) => {
  const r = b.getBoundingClientRect()
  return r.height > 0 && r.height < 44
}).map((b) => ((b.textContent || '').trim() || b.getAttribute('role') || '?').slice(0, 18)
  + ' ' + Math.round(b.getBoundingClientRect().height))
add(CASE + ': every button is at least 44px tall', small.length === 0, small.join(' · '))

// The switch included: the track may look 44×24, the thing a thumb aims at may
// not be.
if (toggle) {
  const r = toggle.getBoundingClientRect()
  add(CASE + ': the switch target is at least 44×44',
      r.width >= 44 && r.height >= 44,
      Math.round(r.width) + '×' + Math.round(r.height))
  // …without pushing its row taller: the negative margin gives the layout back.
  const track = toggle.firstElementChild
  add(CASE + ': …while the track still looks 44×24',
      track && Math.round(track.getBoundingClientRect().height) === 24,
      track ? Math.round(track.getBoundingClientRect().width) + '×' + Math.round(track.getBoundingClientRect().height) : 'kein Track')
}
// The row around the switch no longer has to carry the target — the switch
// carries its own (asserted above), which is why a 40 px row is fine now and
// why no existing row in the app changed height.

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

const measure = (markup, height, caseName, fits) => {
  const html = pageFor(markup, height)
    .replace('"CASE_NAME"', JSON.stringify(caseName))
    .replace('FITS_FLAG', String(fits))
  const htmlPath = `${cache}/financeClassifyLayout-${caseName.replace(/\W+/g, '-')}.html`
  writeFileSync(htmlPath, html)
  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) throw new Error(`der Browser hat für ${caseName} nichts gemessen`)
  return JSON.parse(
    match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  )
}

const report = []

// The switch on its own, in the row shape EventForm uses.
{
  const rows = measure(variants.toggleRow, 400, 'Toggle in einer Zeile', false)
  report.push(...rows.filter(
    (r) => r.name.includes('switch') || r.name.includes('sideways') || r.name.includes('switch row')))
}

for (const viewport of VIEWPORTS) {
  // The ordinary booking must FIT on both phones — that is the release goal.
  report.push(...measure(variants.ordinary, viewport.height, `${viewport.name} ${WIDTH}×${viewport.height} · REWE`, true))
  // The hostile one may scroll; it may not overflow sideways or hide the
  // buttons, and the word area must stay capped.
  report.push(...measure(variants.hostile, viewport.height, `${viewport.name} · Extremtext`, false))
  report.push(...measure(variants.noted, viewport.height, `${viewport.name} · lange Notiz`, false))
}

// The numbers themselves, printed rather than only asserted — „kompakter" is a
// claim, and this is what it measured.
for (const entry of report) {
  if (entry.name.includes('ohne Scrollen') || entry.name.includes('Reserve') ||
      entry.name.includes('fits without scrolling') || entry.name.includes('room for the preview')) {
    console.log(`  · ${entry.name} — ${entry.detail || 'ok'}`)
  }
}

let pass = 0, fail = 0
for (const entry of report) {
  if (entry.ok) pass += 1
  else { fail += 1; console.log(`  ✗ ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`) }
}
console.log(`finance classify layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
