// Das Gedächtnis in einem echten Browser, bei 390×844 und 390×667.
//
// Zwei neue Stellen, an denen der Daumen etwas treffen muss, und beide liegen
// hinter einem Overlay — also misst sie kein statisches Rendering und kein
// jsdom: die Wahl des Merk-Umfangs und die Liste des Gelernten.
//
// WAS HIER SCHIEFGEHEN KANN, und deshalb gemessen wird: die Umfänge tragen
// Händlernamen, und ein Händlername kommt aus einem Sprachmodell oder aus dem
// Tippen eines Menschen — „Immer für Bundesanstalt für Immobilienaufgaben …"
// ist eine plausible Beschriftung. Und die Liste wächst mit jedem Import, bis
// sie 40 Beispiele mit bankübleichen Originaltexten zeigt.
//
// Braucht `npm run build` vorher: gelesen wird dist/assets/*.css.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
const WIDTH = 390
const HEIGHTS = [844, 667]

const cssDir = 'dist/assets'
const cssFile = existsSync(cssDir)
  ? readdirSync(cssDir).find((f) => f.startsWith('index-') && f.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('finance learning layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ScopeOptions } from './src/components/FinanceLearningScopeSheet.jsx'
import { MemoryList } from './src/components/FinanceMemoriesSheet.jsx'
import { LearningRow } from './src/components/FinanceAiImportSheet.jsx'
import { buildAIImportPlan, applyRowEdit } from './src/lib/finance/ai/plan.js'
import { learningOptions, memoryGroups, sanitizeLearningMode } from './src/lib/finance/ai/memories.js'

const CATEGORIES = [
  { id: 'cat-lebensmittel', slug: 'lebensmittel', label: 'Lebensmittel', sort_order: 10 },
  { id: 'cat-restaurant', slug: 'restaurant', label: 'Restaurant', sort_order: 20 },
]

const LONG_MERCHANT = 'Bundesanstalt fuer Immobilienaufgaben Sparte Facility Management West'
const LONG_TEXT = 'DAUERAUFTRAG Grundstuecksverwaltungsgesellschaft Musterstadt-Nord mbH & Co. Betriebs-KG, Verwendungszweck: Nebenkostenabrechnung 2025 nebst Nachzahlung'
const UNBREAKABLE = 'B'.repeat(200)

const baseRow = (merchantName) => {
  const plan = buildAIImportPlan({
    entries: [{
      index: 1,
      bookingDate: '2026-09-18',
      amountMinor: -2495,
      currency: 'EUR',
      rawDescription: 'REWE TROISDORF SAGT DANKE 8407',
      normalizedTokens: ['REWE'],
      merchantName: 'Troisdorf',
      categoryId: 'cat-restaurant',
      categorySlug: 'restaurant',
      transactionType: 'purchase',
      includeInAnalytics: true,
      note: null,
      needsReview: true,
      reviewReasons: ['model_unsure'],
    }],
    existing: [],
    observations: [],
    accountId: '11111111-1111-4111-8111-111111111111',
  })
  return applyRowEdit(plan.rows[0], { merchantName, categoryId: 'cat-lebensmittel' })
}

// Ein Name, der in keine Zeile passt — die Beschriftungen tragen ihn zweimal.
const longRow = baseRow(LONG_MERCHANT)
const scope = renderToStaticMarkup(
  createElement(ScopeOptions, {
    options: learningOptions(longRow),
    chosen: sanitizeLearningMode(longRow),
    onChoose: () => {},
  })
)

// Derselbe Zustand für PayPal: dort steht die Dienstleister-Option oben, also
// sind alle vier Zeilen sichtbar, ohne „Weitere Regel".
const paypalRow = baseRow('PayPal')
const scopeProvider = renderToStaticMarkup(
  createElement(ScopeOptions, {
    options: learningOptions(paypalRow),
    chosen: 'payment_provider',
    onChoose: () => {},
  })
)

const line = renderToStaticMarkup(
  createElement(LearningRow, {
    row: applyRowEdit(longRow, { learningMode: 'merchant_rule' }),
    onOpen: () => {},
  })
)

// Das volle Gedächtnis: die starken Regeln, die Dienstleister und 40 Beispiele,
// wie sie nach einem halben Jahr aussehen.
const memories = []
memories.push({
  id: 'r-long', kind: 'merchant_rule', merchant_name: LONG_MERCHANT,
  merchant_key: LONG_MERCHANT.toUpperCase(), category_id: 'cat-lebensmittel',
  transaction_type: 'transfer', include_in_analytics: false, active: true,
  created_at: '2026-09-18T12:00:00Z',
})
memories.push({
  id: 'p-1', kind: 'payment_provider', merchant_name: 'PayPal', merchant_key: 'PAYPAL',
  active: true, created_at: '2026-09-18T11:00:00Z',
})
for (let i = 0; i < 40; i += 1) {
  memories.push({
    id: 'e-' + i,
    kind: 'similar_example',
    merchant_name: i % 3 === 0 ? LONG_MERCHANT : 'REWE',
    merchant_key: 'K' + i,
    category_id: 'cat-lebensmittel',
    source_description: i % 4 === 0 ? UNBREAKABLE : i % 4 === 1 ? LONG_TEXT : 'REWE Musterstadt ' + i,
    suggested_merchant_name: i % 5 === 0 ? null : 'Musterstadt',
    suggested_category_id: 'cat-restaurant',
    example_key: 'key-' + i,
    active: true,
    created_at: '2026-09-1' + (i % 9) + 'T10:00:00Z',
  })
}

const list = renderToStaticMarkup(
  createElement(MemoryList, { groups: memoryGroups(memories, CATEGORIES), onForget: () => {} })
)
const leer = renderToStaticMarkup(
  createElement(MemoryList, { groups: [], onForget: () => {} })
)

process.stdout.write(JSON.stringify({ scope, scopeProvider, line, list, leer }))
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'renderLearning.mjs', loader: 'js' },
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
writeFileSync(`${cache}/financeLearningLayout.render.mjs`, bundled.outputFiles[0].text)

let rendered = { scope: '', scopeProvider: '', line: '', list: '', leer: '' }
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  await import(pathToFileURL(`${cache}/financeLearningLayout.render.mjs`).href)
  process.stdout.write = original
  rendered = JSON.parse(chunks.join(''))
}

const pageFor = (height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;width:${WIDTH}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame">
  <div id="line" class="px-5 py-4">${rendered.line}</div>
  <div id="scope">${rendered.scope}</div>
  <div id="scopeProvider">${rendered.scopeProvider}</div>
  <div id="list">${rendered.list}</div>
  <div id="leer">${rendered.leer}</div>
</div>
<script>
const VIEWPORT = ${WIDTH}
const SCREEN = ${height}
const report = []
const add = (name, cond, detail) => report.push({ name: name + ' @' + SCREEN, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const frameRect = frame.getBoundingClientRect()

add('die Seite scrollt nicht seitwärts',
    document.body.scrollWidth <= VIEWPORT, document.body.scrollWidth + ' > ' + VIEWPORT)
add('…und der Rahmen auch nicht',
    frame.scrollWidth <= frame.clientWidth + 0.5, frame.scrollWidth + ' > ' + frame.clientWidth)

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

// ── Die Zeile im geöffneten Editor ────────────────────────────────────────
const line = document.getElementById('line').querySelector('button')
add('„Für die Zukunft merken" ist eine Zeile', Boolean(line))
add('… hoch genug für einen Daumen', line.getBoundingClientRect().height >= 44,
    Math.round(line.getBoundingClientRect().height) + 'px')
add('… sie bleibt einzeilig', line.getBoundingClientRect().height <= 64,
    Math.round(line.getBoundingClientRect().height) + 'px')
const answer = line.querySelectorAll('span')[1]
add('… die Antwort steht rechts und wird abgeschnitten statt umgebrochen',
    answer.scrollWidth > answer.clientWidth,
    answer.scrollWidth + ' vs ' + answer.clientWidth)
add('… und die Frage bleibt lesbar', line.querySelectorAll('span')[0].clientWidth >= 120,
    line.querySelectorAll('span')[0].clientWidth + 'px')

// ── Die Wahl des Umfangs ──────────────────────────────────────────────────
const scope = document.getElementById('scope')
const scopeButtons = scope.querySelectorAll('button')
// Drei Umfänge plus „Weitere Regel …": der Dienstleister liegt für einen
// gewöhnlichen Händler eine Ebene tiefer.
add('drei Umfänge und der Weg zur vierten', scopeButtons.length === 4,
    'gefunden: ' + scopeButtons.length)
let scopeSmall = 0
for (const button of scopeButtons) {
  if (button.getBoundingClientRect().height < 44) scopeSmall += 1
}
add('jede Wahl ist mindestens 44 px hoch', scopeSmall === 0, scopeSmall + ' zu klein')
add('die Wahl passt auf einen Bildschirm',
    scope.getBoundingClientRect().height <= SCREEN - 120,
    Math.round(scope.getBoundingClientRect().height) + 'px von ' + SCREEN)
add('auch mit einem Händlernamen, der länger ist als das Telefon',
    scope.scrollWidth <= frameRect.width + 1,
    scope.scrollWidth + ' > ' + Math.round(frameRect.width))

const providerScope = document.getElementById('scopeProvider')
add('für einen bekannten Dienstleister stehen vier Umfänge direkt da',
    providerScope.querySelectorAll('button').length === 4,
    'gefunden: ' + providerScope.querySelectorAll('button').length)
add('… und die gewählte trägt einen Haken',
    providerScope.querySelectorAll('svg').length === 1,
    providerScope.querySelectorAll('svg').length + ' Haken')

// ── Die Liste des Gelernten ───────────────────────────────────────────────
const list = document.getElementById('list')
const groups = list.querySelectorAll('section')
add('drei Gruppen', groups.length === 3, 'gefunden: ' + groups.length)
const entries = list.querySelectorAll('section > div > div')
add('jede Erinnerung ist eine Zeile', entries.length === 42, 'gefunden: ' + entries.length)

let entrySmall = 0, entryTall = 0, clipped = 0
for (const entry of entries) {
  const r = entry.getBoundingClientRect()
  if (r.height > 80) entryTall += 1
  const button = entry.querySelector('button')
  const b = button.getBoundingClientRect()
  if (b.height < 44 || b.width < 44) entrySmall += 1
  for (const p of entry.querySelectorAll('p.truncate')) {
    if (p.scrollWidth > p.clientWidth + 1) clipped += 1
  }
}
add('jedes Entfernen ist mindestens 44×44', entrySmall === 0, entrySmall + ' zu klein')
add('keine Erinnerung wird zur Textwand', entryTall === 0, entryTall + ' zu hoch')
add('lange Texte werden abgeschnitten statt umgebrochen', clipped >= 20,
    'abgeschnitten: ' + clipped)
add('die Liste bleibt im Rahmen', list.scrollWidth <= frameRect.width + 1,
    list.scrollWidth + ' > ' + Math.round(frameRect.width))
// Keine Scroll-Hölle: 42 Erinnerungen dürfen die Liste nicht länger machen, als
// 42 Zeilen lang sind.
add('die Liste wächst nur mit den Erinnerungen',
    list.getBoundingClientRect().height / entries.length <= 80,
    Math.round(list.getBoundingClientRect().height / entries.length) + 'px pro Erinnerung')
add('die erste Gruppe steht im ersten Bildschirm',
    groups[0].getBoundingClientRect().top < list.getBoundingClientRect().top + SCREEN)

const leer = document.getElementById('leer')
add('ohne Erinnerungen steht dort ein Satz statt einer leeren Liste',
    leer.textContent.includes('Noch nichts gemerkt'))
add('… und keine Gruppe', leer.querySelectorAll('section').length === 0)

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

let pass = 0
let fail = 0
for (const height of HEIGHTS) {
  const htmlPath = `${cache}/financeLearningLayout-${height}.html`
  writeFileSync(htmlPath, pageFor(height))

  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )

  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) {
    console.error(`finance learning layout: der Browser hat bei ${height}px nichts gemessen.`)
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

console.log(`finance learning layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
