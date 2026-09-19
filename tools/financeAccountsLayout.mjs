// Die Kontoverwaltung in einem echten Browser, bei 390×844 und 390×667.
//
// WAS HIER SCHIEFGEHEN KANN, und deshalb gemessen wird: ein Kontoname kommt aus
// dem Tippen eines Menschen — „Gemeinschaftskonto Haushalt und Nebenkosten" ist
// eine plausible Beschriftung, und darunter steht noch der Anbieter. Die Zeilen
// tragen beides, sind anklickbar und müssen deshalb sowohl daumengroß bleiben
// als auch abschneiden statt den Rahmen zu sprengen. Dasselbe gilt für das
// Bearbeiten-Sheet, in dem drei Felder, ein Primärknopf und eine leise Aktion
// übereinander liegen.
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
  console.error('finance accounts layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { AccountDetail, AccountList } from './src/components/FinanceAccountsSheet.jsx'

const LONG_NAME = 'Gemeinschaftskonto Haushalt und Nebenkosten der Wohnungsbaugenossenschaft'
const LONG_PROVIDER = 'Deutsche Kreditbank Aktiengesellschaft Niederlassung Berlin-Mitte'
const UNBREAKABLE = 'K'.repeat(120)

const account = (over) => ({
  id: over.id, name: over.name, provider: over.provider ?? null,
  currency: over.currency ?? 'EUR', archived_at: over.archived_at ?? null,
})

const active = [
  account({ id: 'a1', name: 'DKB Girokonto', provider: 'DKB' }),
  account({ id: 'a2', name: LONG_NAME, provider: LONG_PROVIDER }),
  account({ id: 'a3', name: UNBREAKABLE, provider: null, currency: 'AUD' }),
  account({ id: 'a4', name: 'Bargeld' }),
]
const archived = [
  account({ id: 'b1', name: 'Altes Girokonto', provider: 'ING', archived_at: '2026-01-01T00:00:00Z' }),
  account({ id: 'b2', name: LONG_NAME, provider: LONG_PROVIDER, archived_at: '2026-01-01T00:00:00Z' }),
]

const list = renderToStaticMarkup(
  createElement(AccountList, { active, archived, onOpen: () => {}, onCreate: () => {} })
)
// Ein frisches Konto: nur „Aktiv", keine Archiv-Sektion.
const listOnlyActive = renderToStaticMarkup(
  createElement(AccountList, { active: [active[0]], archived: [], onOpen: () => {}, onCreate: () => {} })
)

// Drei Zustände des Bearbeiten-Sheets, denn sie sind verschieden hoch:
// belegt (archivieren, Währung gesperrt), leer (löschen), archiviert.
const belegt = { transactions: [{ account_id: 'a2' }], imports: [] }
const leer = { transactions: [], imports: [] }
const noop = () => {}
const detailProps = (acc, data) => ({
  account: acc, data, onSave: noop, onArchive: noop, onReactivate: noop,
  onDelete: noop, onToast: noop, onDone: noop,
})
const detailBelegt = renderToStaticMarkup(createElement(AccountDetail, detailProps(active[1], belegt)))
const detailLeer = renderToStaticMarkup(createElement(AccountDetail, detailProps(active[3], leer)))
const detailArchiv = renderToStaticMarkup(createElement(AccountDetail, detailProps(archived[1], belegt)))

process.stdout.write(JSON.stringify({ list, listOnlyActive, detailBelegt, detailLeer, detailArchiv }))
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'renderAccounts.mjs', loader: 'js' },
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
writeFileSync(`${cache}/financeAccountsLayout.render.mjs`, bundled.outputFiles[0].text)

let rendered = { list: '', listOnlyActive: '', detailBelegt: '', detailLeer: '', detailArchiv: '' }
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  await import(pathToFileURL(`${cache}/financeAccountsLayout.render.mjs`).href)
  process.stdout.write = original
  rendered = JSON.parse(chunks.join(''))
}

const pageFor = (height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;width:${WIDTH}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame">
  <div id="list">${rendered.list}</div>
  <div id="listOnlyActive">${rendered.listOnlyActive}</div>
  <div id="detailBelegt">${rendered.detailBelegt}</div>
  <div id="detailLeer">${rendered.detailLeer}</div>
  <div id="detailArchiv">${rendered.detailArchiv}</div>
</div>
<script>
const VIEWPORT = ${WIDTH}
const SCREEN = ${height}
const report = []
const add = (name, cond, detail) => report.push({ name: name + ' @' + SCREEN, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const frameRect = frame.getBoundingClientRect()
const box = (el) => el.getBoundingClientRect()

add('die Seite scrollt nicht seitwärts',
    document.body.scrollWidth <= VIEWPORT, document.body.scrollWidth + ' > ' + VIEWPORT)
add('…und der Rahmen auch nicht',
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
    outside ? outside.tag + ' bis x=' + Math.round(outside.right) : '')

// ── Die Kontenliste ───────────────────────────────────────────────────────
const list = document.getElementById('list')
const rows = [...list.querySelectorAll('section button')]
add('jedes Konto ist eine Zeile', rows.length === 6, rows.length + ' Zeilen')

let tooShort = null
for (const row of rows) {
  const h = box(row).height
  if (h < 44 && (!tooShort || h < tooShort)) tooShort = h
}
add('jede Kontozeile ist mindestens 44px hoch', tooShort === null,
    tooShort ? Math.round(tooShort) + 'px' : '')

// Zweizeilig, aber nicht ausufernd: der lange Name bricht nicht um, er wird
// abgeschnitten — sonst wüchse eine Zeile über den halben Bildschirm.
const longRow = rows[1]
add('ein langer Kontoname sprengt die Zeile nicht', box(longRow).height <= 80,
    Math.round(box(longRow).height) + 'px')
const nameSpan = longRow.querySelectorAll('span span')[0]
add('… er wird abgeschnitten statt umgebrochen', nameSpan.scrollWidth > nameSpan.clientWidth,
    nameSpan.scrollWidth + ' vs ' + nameSpan.clientWidth)
const subSpan = longRow.querySelectorAll('span span')[1]
add('… und der Anbieter darunter ebenfalls', subSpan.scrollWidth > subSpan.clientWidth)
add('ein Name ohne Trennstelle bleibt im Rahmen',
    box(rows[2]).right <= frameRect.right + 0.5)

const sections = [...list.querySelectorAll('section')]
add('es gibt zwei Sektionen', sections.length === 2, sections.length + '')
add('… „Aktiv" zuerst', sections[0].textContent.toLowerCase().startsWith('aktiv'))
add('… dann „Archiviert"', sections[1].textContent.toLowerCase().startsWith('archiviert'))

const neu = [...list.querySelectorAll('button')].find((b) => b.textContent.includes('Neues Konto'))
add('„Neues Konto" steht unten', Boolean(neu))
add('… und ist daumengroß', box(neu).height >= 44, Math.round(box(neu).height) + 'px')

const onlyActive = document.getElementById('listOnlyActive')
add('ohne archivierte Konten gibt es nur eine Sektion',
    onlyActive.querySelectorAll('section').length === 1)

// ── Das Bearbeiten-Sheet ──────────────────────────────────────────────────
for (const [id, expected, forbidden] of [
  ['detailBelegt', 'Konto archivieren', 'Konto löschen'],
  ['detailLeer', 'Konto löschen', 'Konto archivieren'],
  ['detailArchiv', 'Konto reaktivieren', 'Konto archivieren'],
]) {
  const root = document.getElementById(id)
  const buttons = [...root.querySelectorAll('button')]
  const primary = buttons.find((b) => b.textContent.trim().startsWith('Speichern'))
  add(id + ': „Speichern" ist der primäre Knopf', Boolean(primary))
  add(id + ': … und daumengroß', primary && box(primary).height >= 44,
      primary ? Math.round(box(primary).height) + 'px' : '')

  const quiet = buttons.find((b) => b.textContent.trim() === expected)
  add(id + ': die leise Aktion ist „' + expected + '"', Boolean(quiet))
  add(id + ': … und daumengroß', quiet && box(quiet).height >= 44,
      quiet ? Math.round(box(quiet).height) + 'px' : '')
  add(id + ': „' + forbidden + '" wird nicht angeboten',
      !buttons.some((b) => b.textContent.trim() === forbidden))

  const inputs = [...root.querySelectorAll('input')]
  add(id + ': drei Felder', inputs.length === 3, inputs.length + '')
  let small = null
  for (const input of inputs) {
    const h = box(input).height
    if (h < 44 && (!small || h < small)) small = h
  }
  add(id + ': jedes Feld ist mindestens 44px hoch', small === null,
      small ? Math.round(small) + 'px' : '')
  add(id + ': die Felder bleiben im Rahmen',
      inputs.every((i) => box(i).right <= frameRect.right + 0.5))
}

// Die Währung eines belegten Kontos ist gesperrt — und sagt warum.
{
  const root = document.getElementById('detailBelegt')
  const currency = root.querySelector('input[aria-label="Währung"]')
  add('ein belegtes Konto sperrt die Währung', currency.disabled === true)
  add('… und erklärt es mit einem Satz',
      root.textContent.includes('Die Währung kann nicht mehr geändert werden'))
}
{
  const root = document.getElementById('detailLeer')
  const currency = root.querySelector('input[aria-label="Währung"]')
  add('ein leeres Konto lässt die Währung frei', currency.disabled === false)
  add('… und sagt nichts dazu',
      !root.textContent.includes('Die Währung kann nicht mehr geändert werden'))
}

const out = document.createElement('div')
out.id = 'report'
out.textContent = JSON.stringify(report)
document.body.appendChild(out)
</script>
</body></html>`

let pass = 0
let fail = 0
for (const height of HEIGHTS) {
  const htmlPath = `${cache}/financeAccountsLayout-${height}.html`
  writeFileSync(htmlPath, pageFor(height))

  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${WIDTH},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )

  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) {
    console.error(`finance accounts layout: der Browser hat bei ${height}px nichts gemessen.`)
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

console.log(`finance accounts layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
