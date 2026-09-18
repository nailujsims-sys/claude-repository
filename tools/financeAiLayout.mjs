// Der KI-Import-Preview in einem echten Browser, bei 390×844 und 390×667.
//
// Derselbe Grund wie bei tools/financeImportLayout.mjs, nur schärfer: beim
// PDF-Import schreibt eine Bank die Texte, hier schreibt ein Sprachmodell sie —
// und das kann einen Händlernamen über eine ganze Zeile ziehen, eine
// Beschreibung ohne ein einziges Leerzeichen liefern oder hundert Zeilen auf
// einmal. Nichts davon ist in jsdom sichtbar, weil jsdom kein Layout hat.
//
// Gemessen wird deshalb der ECHTE PreviewStep mit dem ECHTEN Stylesheet des
// letzten Builds, dazu die Chip-Auswahl, mit der eine Zeile korrigiert wird —
// die beiden Stellen, an denen der Daumen etwas treffen muss.
//
// Braucht `npm run build` vorher: gelesen wird dist/assets/*.css.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
const WIDTH = 390
// Die zwei Telefone, die die Vorgabe nennt: das große und das kleine.
const HEIGHTS = [844, 667]

const cssDir = 'dist/assets'
const cssFile = existsSync(cssDir)
  ? readdirSync(cssDir).find((f) => f.startsWith('index-') && f.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('finance ai layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

// ── Das Markup, aus den echten Komponenten ──────────────────────────────────
const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MerchantEditor, PreviewStep } from './src/components/FinanceAiImportSheet.jsx'
import { ChipSelect } from './src/components/FinanceManualSheet.jsx'
import { parseAIImport, validateAIImport } from './src/lib/finance/ai/parse.js'
import { buildAIImportPlan } from './src/lib/finance/ai/plan.js'

const CATEGORIES = [
  { id: 'cat-lebensmittel', slug: 'lebensmittel', label: 'Lebensmittel', sort_order: 10 },
  { id: 'cat-restaurant', slug: 'restaurant', label: 'Restaurant', sort_order: 20 },
  { id: 'cat-klamotten', slug: 'klamotten', label: 'Klamotten', sort_order: 30 },
  { id: 'cat-drogerie', slug: 'drogerie', label: 'Drogerie', sort_order: 40 },
  { id: 'cat-sonstige', slug: 'sonstige', label: 'Sonstige', sort_order: 50 },
]

// Das Schlimmste, was ein Modell plausibel liefern kann:
//  - eine Beschreibung, die viel länger ist als das Telefon
//  - eine ohne ein einziges Leerzeichen, an dem gebrochen werden könnte
//  - ein Händlername, der selbst schon zu lang ist
//  - ein Betrag mit Tausendertrennung
//  - jeden Zustand, den der Preview kennt
//  - und hundertzwanzig davon
const LONG = 'DAUERAUFTRAG Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG, Verwendungszweck: Nebenkostenabrechnung 2025 nebst Nachzahlung gemaess Schreiben vom 12.03.2026'
const UNBREAKABLE = 'A'.repeat(220)
const LONG_MERCHANT = 'Bundesanstalt fuer Immobilienaufgaben Sparte Facility Management Niederlassung West'

const records = []
for (let i = 0; i < 120; i += 1) {
  const kind = i % 6
  records.push({
    booking_date: '2026-09-' + String((i % 28) + 1).padStart(2, '0'),
    amount: kind === 0 ? -1234567.89 : kind === 1 ? 98765.43 : -(i * 0.37 + 0.05),
    currency: 'EUR',
    raw_description: kind === 2 ? UNBREAKABLE : kind === 3 ? LONG : 'REWE Musterstadt ' + i,
    merchant: kind === 4 ? null : kind === 5 ? LONG_MERCHANT : 'REWE',
    category: kind === 1 ? 'erfundene-kategorie' : 'lebensmittel',
    transaction_type: kind === 1 ? 'income' : 'purchase',
    include_in_analytics: true,
    note: null,
    needs_review: kind === 4,
  })
}

const parsed = parseAIImport(JSON.stringify({
  format: 'leben-finance-import', version: 1, transactions: records,
}))
const checked = validateAIImport(parsed.payload, { categories: CATEGORIES })
if (!checked.ok) throw new Error('Fixture ungueltig: ' + JSON.stringify(checked.errors.slice(0, 3)))

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
// Ein Drittel schon gespeichert, damit auch „Bereits vorhanden" vermessen wird.
const existing = checked.entries.filter((_, i) => i % 3 === 0).map((entry, i) => ({
  id: 'tx-' + i,
  account_id: ACCOUNT,
  booking_date: entry.bookingDate,
  amount_minor: entry.amountMinor,
  currency: entry.currency,
  raw_description: entry.rawDescription,
}))

const plan = buildAIImportPlan({ entries: checked.entries, existing, accountId: ACCOUNT })

const markup = renderToStaticMarkup(
  createElement(PreviewStep, {
    rows: plan.rows,
    summary: plan.summary,
    categories: CATEGORIES,
    busy: false,
    problems: [],
    onEditRow: () => {},
    onApply: () => {},
    onBack: () => {},
  })
)

const chips = renderToStaticMarkup(
  createElement(ChipSelect, {
    options: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    value: 'cat-restaurant',
    onChange: () => {},
    emptyLabel: 'Keine',
  })
)

// Der Händler-Editor, mit dem eine „Prüfen"-Zeile gelöst wird. Im Preview ist er
// zugeklappt, also wird er hier einzeln gerendert — samt eines Händlernamens,
// der länger ist als das Telefon.
const editor = renderToStaticMarkup(
  createElement(MerchantEditor, {
    merchants: [
      { id: 'm-rewe', canonical_name: 'REWE' },
      { id: 'm-edeka', canonical_name: 'EDEKA' },
      { id: 'm-lang', canonical_name: LONG_MERCHANT },
    ],
    merchantId: 'm-rewe',
    merchantName: 'REWE',
    onChange: () => {},
  })
)

process.stdout.write(JSON.stringify({ markup, chips, editor }))
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'renderAi.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['node:*', 'react', 'react-dom', 'react-dom/server', 'lucide-react', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const cache = `${process.cwd()}/node_modules/.cache`
mkdirSync(cache, { recursive: true })
writeFileSync(`${cache}/financeAiLayout.render.mjs`, bundled.outputFiles[0].text)

let rendered = { markup: '', chips: '', editor: '' }
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  await import(pathToFileURL(`${cache}/financeAiLayout.render.mjs`).href)
  process.stdout.write = original
  rendered = JSON.parse(chunks.join(''))
}

const pageFor = (height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<!-- Der Viewport, festgenagelt: --window-size erreicht einen --dump-dom-Lauf
     nicht zuverlässig, und ein Layout bei irgendeiner Breite ist keine Messung
     dieses Telefons. -->
<style>html,body{margin:0;width:${WIDTH}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame"><div class="px-5 py-5 pb-10" id="sheet">${rendered.markup}</div>
<div id="chips" class="px-5 py-5">${rendered.chips}</div>
<div id="editor" class="px-5 py-5">${rendered.editor}</div></div>
<script>
const VIEWPORT = ${WIDTH}
const SCREEN = ${height}
const report = []
const add = (name, cond, detail) => report.push({ name: name + ' @' + SCREEN, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const sheet = document.getElementById('sheet')
const frameRect = frame.getBoundingClientRect()

add('die Seite scrollt nicht seitwärts',
    document.body.scrollWidth <= VIEWPORT, document.body.scrollWidth + ' > ' + VIEWPORT)
add('…und der Rahmen auch nicht',
    frame.scrollWidth <= frame.clientWidth + 0.5, frame.scrollWidth + ' > ' + frame.clientWidth)
add('…und der Rahmen ist wirklich so breit',
    Math.round(frameRect.width) === VIEWPORT, Math.round(frameRect.width) + 'px')
add('das Sheet scrollt nicht seitwärts',
    sheet.scrollWidth <= sheet.clientWidth + 1, sheet.scrollWidth + ' > ' + sheet.clientWidth)

let outside = null
for (const el of frame.querySelectorAll('*')) {
  const r = el.getBoundingClientRect()
  if (r.width === 0) continue
  if (r.right > frameRect.right + 0.5 || r.left < frameRect.left - 0.5) {
    if (!outside || r.right > outside.right) outside = { right: r.right, tag: el.className }
  }
}
add('nichts ragt über den Telefonrahmen hinaus', outside === null,
    outside ? outside.tag + ' bis x=' + Math.round(outside.right) : '')

// Jede Buchung ist da — auch die, die nicht importiert wird.
const rows = sheet.querySelectorAll('div.overflow-hidden.rounded-card > div')
add('alle 120 Umsätze sind gerendert', rows.length === 120, 'gefunden: ' + rows.length)

let amountsOutside = 0, overlapping = 0, clipped = 0, tallest = 0
for (const row of rows) {
  const title = row.querySelector('p.truncate')
  const amount = row.querySelector('p.shrink-0')
  tallest = Math.max(tallest, row.getBoundingClientRect().height)
  if (!title || !amount) continue
  const t = title.getBoundingClientRect(), a = amount.getBoundingClientRect()
  if (a.right > frameRect.right - 8 || a.width < 30) amountsOutside += 1
  if (t.right > a.left + 0.5) overlapping += 1
  // Gezählt über Händlerzeile UND Originaltext: lang wird bei einem
  // Sprachmodell mal das eine, mal das andere.
  for (const line of row.querySelectorAll('p.truncate')) {
    if (line.scrollWidth > line.clientWidth + 1) clipped += 1
  }
}
add('jeder Betrag bleibt im Bild und behält seine Breite', amountsOutside === 0,
    amountsOutside + ' Beträge außerhalb')
add('keine Beschreibung überlappt die Betragsspalte', overlapping === 0,
    overlapping + ' Überlappungen')
add('lange Beschreibungen werden abgeschnitten statt umgebrochen', clipped >= 55,
    'abgeschnitten: ' + clipped)
// Vier Zeilen: Händler, Originaltext, Status, Prüfgrund. Mehr wäre ein Absatz.
add('keine Zeile wird zur Textwand', tallest <= 120, Math.round(tallest) + 'px')

// Die Zusammenfassung ist das Erste, was zu sehen sein muss — auf beiden Geräten.
const summary = sheet.querySelector('section')
add('die Zusammenfassung steht komplett im ersten Bildschirm',
    summary.getBoundingClientRect().bottom <= SCREEN,
    Math.round(summary.getBoundingClientRect().bottom) + 'px > ' + SCREEN)

// Keine Scroll-Hölle: 120 Umsätze dürfen die Seite nicht länger machen, als 120
// Zeilen lang sind. Gemessen als Höhe pro Umsatz.
const perRow = document.body.scrollHeight / rows.length
add('die Seite wächst nur mit den Umsätzen', perRow <= 110, Math.round(perRow) + 'px pro Umsatz')

// Alles, was ein Daumen trifft.
let small = []
for (const button of frame.querySelectorAll('button')) {
  const r = button.getBoundingClientRect()
  if (r.height < 44) small.push(button.textContent.trim().slice(0, 24) + ' (' + Math.round(r.height) + 'px)')
}
add('jedes Bedienelement ist mindestens 44 px hoch', small.length === 0, small.join(', '))

// Die beiden Aktionen am Fuß sind erreichbar: sie stehen im Dokument, in voller
// Breite, und nichts liegt darüber.
const actions = [...sheet.querySelectorAll('button')].filter((b) => /Importieren|Zurück/.test(b.textContent))
add('Importieren und Zurück sind beide da', actions.length === 2, 'gefunden: ' + actions.length)
for (const action of actions) {
  const r = action.getBoundingClientRect()
  add('„' + action.textContent.trim() + '" nimmt die volle Breite ein',
      r.width >= frameRect.width - 41, Math.round(r.width) + 'px')
  add('„' + action.textContent.trim() + '" liegt im Dokument, nicht darüber hinaus',
      r.bottom <= document.body.scrollHeight + 1, Math.round(r.bottom) + 'px')
}

// Die Chips, mit denen eine Zeile korrigiert wird.
const chips = document.getElementById('chips').querySelectorAll('button')
add('die Kategorie-Auswahl bietet jede Kategorie plus „Keine"', chips.length === 6,
    'gefunden: ' + chips.length)
let chipTooSmall = 0
for (const chip of chips) {
  const r = chip.getBoundingClientRect()
  if (r.height < 44 || r.width < 44) chipTooSmall += 1
}
add('jeder Chip ist mindestens 44×44', chipTooSmall === 0, chipTooSmall + ' zu klein')
add('die Chips bleiben im Rahmen',
    document.getElementById('chips').scrollWidth <= frameRect.width + 1)

// Der Händler-Editor: tippen muss gehen, tippen auf einen Chip auch.
const editor = document.getElementById('editor')
const field = editor.querySelector('input')
add('der Händler lässt sich eintippen', Boolean(field))
add('… das Feld ist hoch genug für einen Daumen',
    field.getBoundingClientRect().height >= 44,
    Math.round(field.getBoundingClientRect().height) + 'px')
add('… und bleibt im Rahmen',
    field.getBoundingClientRect().right <= frameRect.right + 0.5)
let editorTooSmall = 0
for (const button of editor.querySelectorAll('button')) {
  const r = button.getBoundingClientRect()
  if (r.height < 44) editorTooSmall += 1
}
add('… und jeder Händler-Chip ist mindestens 44 px hoch', editorTooSmall === 0,
    editorTooSmall + ' zu klein')
add('… auch ein Händlername, der länger ist als das Telefon, sprengt nichts',
    editor.scrollWidth <= frameRect.width + 1,
    editor.scrollWidth + ' > ' + Math.round(frameRect.width))

const first = rows[0].querySelector('p.shrink-0')
add('Beträge stehen in Tabellenziffern',
    getComputedStyle(first).fontVariantNumeric.includes('tabular-nums'))

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

let pass = 0
let fail = 0
for (const height of HEIGHTS) {
  const htmlPath = `${cache}/financeAiLayout-${height}.html`
  writeFileSync(htmlPath, pageFor(height))

  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )

  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) {
    console.error(`finance ai layout: der Browser hat bei ${height}px nichts gemessen.`)
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

console.log(`finance ai layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
