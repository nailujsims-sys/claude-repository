// Die Finanz-Drilldowns (v1.27) in einem echten Browser — bei 390×667,
// 390×844, 430×844 und auf dem Schreibtisch (1280×900).
//
// Gemessen werden die ECHTEN Blöcke aus src/screens/finance/ und die echte
// Kopfzeile, mit Daten aus der echten Pipeline: lange Kategorie- und
// Händlernamen, fünfstellige Euro-Beträge, ein Verlauf mit zwölf Balken, und
// darunter die echte BottomNav — denn „die Navigation deckt die letzte Buchung
// zu" ist genau der Fehler, den man auf einem Telefon zuerst sieht.
//
// Braucht `npm run build` vorher: gelesen wird dist/assets/*.css.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHROMIUM = '/opt/pw-browsers/chromium'
const VIEWPORTS = [[390, 667], [390, 844], [430, 844], [1280, 900]]

const cssDir = 'dist/assets'
const cssFile = existsSync(cssDir)
  ? readdirSync(cssDir).find((f) => f.startsWith('index-') && f.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('finance drilldown layout: dist/assets/index-*.css fehlt — bitte zuerst `npm run build`.')
  process.exit(1)
}
const css = readFileSync(`${cssDir}/${cssFile}`, 'utf-8')

const RENDER = `
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Overview } from './src/screens/Finanzen.jsx'
import { CategoryOverviewView } from './src/screens/finance/CategoryOverview.jsx'
import { CategoryDetailView } from './src/screens/finance/CategoryDetail.jsx'
import { MerchantOverviewView } from './src/screens/finance/MerchantOverview.jsx'
import { MerchantDetailView } from './src/screens/finance/MerchantDetail.jsx'
import { FinanceDetailHeader } from './src/screens/finance/shared.jsx'
import { FinanceScopeBar } from './src/components/FinanceScope.jsx'
import MerchantAvatar from './src/components/MerchantAvatar.jsx'
import BottomNav from './src/components/BottomNav.jsx'
import { UIProvider } from './src/context/UIContext.jsx'
import {
  buildFinanceDashboard, categoryDetail, categoryOverview, financeScope, merchantDetail,
  merchantOverview, resolveAnalyticsEntries,
} from './src/lib/finance/analytics/index.js'
import { financeCategoryRows } from './tools/fixtures/financeCategories.mjs'
import { tokenize } from './src/lib/finance/normalize.js'

const CATEGORIES = financeCategoryRows()
const cat = (slug) => CATEGORIES.find((c) => c.slug === slug).id
const TODAY = '2026-09-12'
const ACCOUNT = 'acc-1'

// Ein selbst angelegter, sehr langer Kategoriename — unter "Wohnen & Haushalt".
const LONG_CATEGORY = 'Reparaturen, Instandhaltung und sonstige Nebenkosten der Eigentumswohnung'
CATEGORIES.push({ id: 'cat-lang', slug: 'eigene_lange', label: LONG_CATEGORY, sort_order: 999,
                  parent_id: cat('wohnen_haushalt') })
const LONG_MERCHANT = 'Wohnungsbaugenossenschaft Berlin-Mitte eingetragene Genossenschaft'
const UNBREAKABLE = 'DB.Vertrieb.GmbH/5083547715681234567890123456789012345678901234567890'

let seq = 0
const tx = (over) => {
  seq += 1
  const raw = over.raw_description ?? ('BUCHUNG ' + seq)
  return {
    id: 'tx-' + String(seq).padStart(3, '0'), account_id: ACCOUNT, currency: 'EUR',
    transaction_type: 'purchase', include_in_analytics: true, manual_lock: false,
    merchant_id: null, category_id: null, ...over,
    raw_description: raw, normalized_tokens: tokenize(raw),
  }
}

const M_LONG = '3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const M_REWE = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const merchants = [
  { id: M_LONG, canonical_name: LONG_MERCHANT, review_mode: 'auto' },
  { id: M_REWE, canonical_name: 'REWE', review_mode: 'auto' },
]
const patterns = [
  { id: 'p1', merchant_id: M_LONG, pattern_type: 'exact_token', tokens: ['MIETE'], active: true },
  { id: 'p2', merchant_id: M_REWE, pattern_type: 'exact_token', tokens: ['REWE'], active: true },
]
const rule = (id, merchant, category) => ({ id, merchant_id: merchant, category_id: category, active: true,
  min_amount_minor: null, max_amount_minor: null, min_inclusive: true, max_inclusive: true, currency: null })
const rules = [rule('r1', M_LONG, 'cat-lang'), rule('r2', M_REWE, cat('lebensmittel'))]

const transactions = [
  // Fuenfstellig: 12.345,67 € unter der langen Kategorie beim langen Haendler.
  tx({ booking_date: '2026-09-02', amount_minor: -1234567, raw_description: 'MIETE SEPTEMBER' }),
  tx({ booking_date: '2026-09-05', amount_minor: -98765, raw_description: 'MIETE NACHZAHLUNG' }),
  tx({ booking_date: '2026-09-03', amount_minor: -29420, raw_description: 'REWE TROISDORF' }),
  tx({ booking_date: '2026-09-06', amount_minor: 1500, raw_description: 'REWE GUTSCHRIFT', transaction_type: 'refund' }),
  tx({ booking_date: '2026-09-04', amount_minor: -12720, category_id: cat('restaurant') }),
  tx({ booking_date: '2026-09-05', amount_minor: -24820, category_id: cat('klamotten') }),
  tx({ booking_date: '2026-09-07', amount_minor: -6065, raw_description: UNBREAKABLE }),
  tx({ booking_date: '2026-09-08', amount_minor: -50000, transaction_type: 'transfer' }),
  tx({ booking_date: '2026-08-05', amount_minor: -1100000, raw_description: 'MIETE AUGUST' }),
  // Ein Jahr Historie, fuenfstellig je Monat — die Balkenbeschriftungen werden breit.
  ...Array.from({ length: 11 }, (_, i) =>
    tx({ booking_date: '2025-' + String(i + 1).padStart(2, '0') + '-15',
         amount_minor: -(1100000 + i * 37000), raw_description: 'MIETE ' + (i + 1) })),
  // Viele Buchungen in einer Kategorie.
  ...Array.from({ length: 24 }, (_, i) =>
    tx({ booking_date: '2026-09-' + String((i % 11) + 1).padStart(2, '0'), amount_minor: -(1000 + i * 37),
         raw_description: 'REWE MARKT ' + i })),
]

const accounts = [{ id: ACCOUNT, name: 'DKB Girokonto', currency: 'EUR' }]
const resolved = resolveAnalyticsEntries({ transactions, merchants, patterns, rules, categories: CATEGORIES })
const scope = financeScope({ entries: resolved, accounts, today: TODAY })
const dashboard = buildFinanceDashboard({ resolved, accounts, categories: CATEGORIES, today: TODAY, trendRange: '1J' })

const noop = () => {}
const parent = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('wohnen_haushalt'), trendRange: '1J' })
const child = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('lebensmittel'), trendRange: '1J' })
const merchant = merchantDetail({ scope, categories: CATEGORIES, merchantKey: M_LONG, trendRange: '1J' })

const wrap = (children) => h('div', { className: 'px-5' }, children)
const screen = (id, title, leading, body) => renderToStaticMarkup(
  h('div', { className: 'pb-6', 'data-screen': id },
    h(FinanceDetailHeader, { title, onBack: noop, leading }),
    wrap([
      h(FinanceScopeBar, { key: 's', className: 'mt-1', periodLabel: scope.periodLabel,
        accountLabel: 'DKB Girokonto mit einem sehr langen Kontonamen', onPeriod: noop, onAccount: noop }),
      h('div', { key: 'b' }, body),
    ])
  )
)

const html = {
  overview: renderToStaticMarkup(wrap(h(Overview, {
    dashboard, currency: 'EUR', trendRange: '1J', onTrendRange: noop, onAdd: noop, onClassify: noop,
    onAllCategories: noop, onOpenCategory: noop, onAllMerchants: noop, onOpenMerchant: noop,
  }))),
  categories: screen('categories', 'Kategorien', null, h(CategoryOverviewView, {
    overview: categoryOverview({ entries: scope.inRange, categories: CATEGORIES }),
    currency: 'EUR', onOpenCategory: noop, onOpenUnassigned: noop,
  })),
  parent: screen('parent', parent.label, null, h(CategoryDetailView, {
    detail: parent, comparisonLabel: scope.comparisonLabel, trendRange: '1J', onTrendRange: noop,
    onOpenCategory: noop, onOpenMerchant: noop, onOpenTransaction: noop,
  })),
  longChild: screen('longChild', LONG_CATEGORY, null, h(CategoryDetailView, {
    detail: categoryDetail({ scope, categories: CATEGORIES, categoryId: 'cat-lang', trendRange: '1J' }),
    comparisonLabel: scope.comparisonLabel, trendRange: '1J', onTrendRange: noop,
    onOpenCategory: noop, onOpenMerchant: noop, onOpenTransaction: noop,
  })),
  child: screen('child', child.label, null, h(CategoryDetailView, {
    detail: child, comparisonLabel: scope.comparisonLabel, trendRange: '1J', onTrendRange: noop,
    onOpenCategory: noop, onOpenMerchant: noop, onOpenTransaction: noop,
  })),
  merchants: screen('merchants', 'Händler', null, h(MerchantOverviewView, {
    merchants: merchantOverview({ scope, categories: CATEGORIES }).merchants, currency: 'EUR', onOpenMerchant: noop,
  })),
  merchant: renderToStaticMarkup(h('div', { className: 'min-h-screen pb-28', 'data-screen': 'merchant' },
    h(FinanceDetailHeader, { title: merchant.name, onBack: noop,
      leading: h(MerchantAvatar, { merchant: merchant.merchant, name: merchant.name, size: 'sm' }) }),
    wrap(h(MerchantDetailView, {
      detail: merchant, comparisonLabel: scope.comparisonLabel, trendRange: '1J', onTrendRange: noop,
      onOpenCategory: noop, onOpenTransaction: noop,
    }))
  )),
  nav: renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/finanzen/haendler/x'] },
    h(UIProvider, null, h(BottomNav)))),
}

process.stdout.write(JSON.stringify({
  html,
  expected: {
    parentChildren: parent.children.length,
    childBookings: child.bookings.length,
    merchantBookings: merchant.bookings.length,
    buckets: merchant.trend.buckets.length,
    longCategory: LONG_CATEGORY,
    longMerchant: LONG_MERCHANT,
  },
}))
`

const bundled = await build({
  stdin: { contents: RENDER, resolveDir: process.cwd(), sourcefile: 'renderDrilldown.mjs', loader: 'js' },
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
writeFileSync(`${cache}/financeDrilldownLayout.render.mjs`, bundled.outputFiles[0].text)

let rendered = null
{
  const chunks = []
  const original = process.stdout.write.bind(process.stdout)
  const originalError = console.error
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  // useLayoutEffect in der BottomNav meldet sich beim Server-Rendern — harmlos.
  console.error = () => {}
  await import(pathToFileURL(`${cache}/financeDrilldownLayout.render.mjs`).href)
  process.stdout.write = original
  console.error = originalError
  rendered = JSON.parse(chunks.join(''))
}

const pageFor = (width, height) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;width:${width}px}</style>
</head><body class="bg-base">
<div class="app-frame" id="frame">
  <div id="overview">${rendered.html.overview}</div>
  ${rendered.html.categories}
  ${rendered.html.parent}
  ${rendered.html.longChild}
  ${rendered.html.child}
  ${rendered.html.merchants}
  ${rendered.html.merchant}
</div>
<div id="nav">${rendered.html.nav}</div>
<script>
const VIEWPORT = ${width}
const SCREEN = '${width}x${height}'
const EXPECTED = ${JSON.stringify(rendered.expected)}
const report = []
const add = (name, cond, detail) => report.push({ name: name + ' @' + SCREEN, ok: !!cond, detail: detail ?? '' })
const frame = document.getElementById('frame')
const frameRect = frame.getBoundingClientRect()
const box = (el) => el.getBoundingClientRect()
const screenEl = (id) => document.querySelector('[data-screen="' + id + '"]')

// ── Kein seitliches Scrollen, nichts ragt hinaus ─────────────────────────
// body, nicht documentElement: das kopflose Chromium hat eine Mindestbreite
// von rund 485 px, und die feste BottomNav spannt sich über das ganze Fenster.
// Gemessen wird deshalb der Inhalt, wie im Dashboard-Test.
add('die Seite scrollt nicht seitwärts', document.body.scrollWidth <= VIEWPORT + 0.5,
    document.body.scrollWidth + ' > ' + VIEWPORT)
add('der Rahmen bleibt bei 430px stehen', frameRect.width <= 430.5, Math.round(frameRect.width) + 'px')
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

// ── Kopfzeilen ────────────────────────────────────────────────────────────
for (const header of frame.querySelectorAll('[data-detail-header]')) {
  const back = header.querySelector('button[aria-label="Zurück"]')
  const title = header.querySelector('h1')
  add('jede Kopfzeile hat „Zurück"', Boolean(back))
  add('…mit derselben 36px-Trefferfläche wie jeder Kopfzeilen-Knopf',
      back && box(back).width >= 36 && box(back).height >= 36,
      back ? Math.round(box(back).width) + 'x' + Math.round(box(back).height) : '')
  add('…und einem einzeiligen Titel', title && box(title).height <= 24, title ? Math.round(box(title).height) + 'px' : '')
  add('…der im Rahmen bleibt', title && box(title).right <= frameRect.right + 0.5)
  add('die Kopfzeile ist 40px hoch', Math.round(box(header.firstElementChild).height) === 40,
      Math.round(box(header.firstElementChild).height) + 'px')
}
{
  const long = [...frame.querySelectorAll('[data-detail-header] h1')]
    .filter((t) => t.textContent === EXPECTED.longCategory || t.textContent === EXPECTED.longMerchant)
  add('lange Kategorie- und Händlernamen im Titel werden abgeschnitten',
      long.length === 2 && long.every((t) => t.scrollWidth > t.clientWidth))
  const avatarHeader = screenEl('merchant').querySelector('[data-detail-header]')
  const avatar = avatarHeader.querySelector('div > div, div > img, span')
  add('der Händler-Kopf trägt seinen Avatar', avatarHeader.textContent.length > 0 &&
      [...avatarHeader.querySelectorAll('*')].some((el) => box(el).width === 32))
}

// ── Touchziele ────────────────────────────────────────────────────────────
{
  let small = null
  for (const el of frame.querySelectorAll('button')) {
    const r = box(el)
    if (r.width === 0 && r.height === 0) continue
    if (r.height < 36 && (!small || r.height < small.h)) small = { h: r.height, tag: String(el.className).slice(0, 50) }
  }
  add('jede Schaltfläche ist mindestens 36px hoch', small === null, small ? Math.round(small.h) + 'px: ' + small.tag : '')
  const rows = [...frame.querySelectorAll('button')].filter((b) => box(b).width > 200)
  const short = rows.filter((r) => box(r).height < 44)
  add('jede Listenzeile ist mindestens 44px hoch', short.length === 0,
      short.length ? Math.round(box(short[0]).height) + 'px: ' + short[0].textContent.slice(0, 40) : '')
  const actions = [...document.querySelectorAll('#overview button')].filter((b) => b.textContent.trim() === 'Alle anzeigen')
  add('„Alle anzeigen" ist zweimal ein echter Knopf', actions.length === 2, actions.length + '')
  add('…mit 44px Trefferfläche', actions.every((a) => box(a).height >= 44),
      actions.map((a) => Math.round(box(a).height)).join(','))
  add('…und bleibt im Rahmen', actions.every((a) => box(a).right <= frameRect.right + 0.5))
  const navRows = [...document.querySelectorAll('#overview button[aria-label^="Kategorie öffnen"], #overview button[aria-label^="Händler öffnen"]')]
  // Drei Oberkategorien und zwei Händler hat dieser Datensatz im September.
  add('die Kategorie- und Händlerzeilen der Übersicht sind Knöpfe', navRows.length === 5, navRows.length + '')
  add('…mit Chevron', navRows.every((b) => b.lastElementChild && b.lastElementChild.tagName.toLowerCase() === 'svg'))
}

// ── Beträge: fünfstellig, nie abgeschnitten ───────────────────────────────
{
  const amounts = [...frame.querySelectorAll('span.tabular-nums, p.tabular-nums')]
    .filter((el) => /€/.test(el.textContent))
  add('es gibt fünfstellige Euro-Beträge', amounts.some((a) => /\\d{2}\\.\\d{3},\\d{2}/.test(a.textContent)),
      amounts.map((a) => a.textContent).slice(0, 4).join(' | '))
  const clipped = amounts.filter((a) => a.scrollWidth > a.clientWidth + 1)
  add('kein Betrag wird abgeschnitten', clipped.length === 0,
      clipped.map((a) => a.textContent + ' ' + a.scrollWidth + '>' + a.clientWidth).slice(0, 3).join(' | '))
  const big = [...frame.querySelectorAll('section p.text-page')]
  add('die Summen-Karten zeigen ihre Zahl ganz', big.length >= 4 && big.every((p) => p.scrollWidth <= p.clientWidth + 1),
      big.map((p) => p.textContent).join(' | '))
}

// ── Prozentzahlen: einzeilig, auch bei 100 % ──────────────────────────────
{
  const pct = [...frame.querySelectorAll('span.tabular-nums')].filter((el) => /^\\d+\\s%$/.test(el.textContent.trim()))
  add('es gibt eine Zeile mit 100 %', pct.some((el) => el.textContent.trim().startsWith('100')))
  const wrapped = pct.filter((el) => box(el).height > parseFloat(getComputedStyle(el).lineHeight) * 1.5)
  add('keine Prozentzahl bricht um', wrapped.length === 0,
      wrapped.map((el) => el.textContent + ' ' + Math.round(box(el).height) + 'px').join(' | '))
}

// ── Lange Namen in Zeilen ─────────────────────────────────────────────────
{
  const truncated = [...frame.querySelectorAll('.truncate')].filter((el) => el.scrollWidth > el.clientWidth)
  add('lange Namen in Zeilen werden abgeschnitten, nicht umgebrochen', truncated.length > 0)
  add('…und keine Zeile wächst über 96px',
      [...frame.querySelectorAll('.min-h-\\\\[56px\\\\]')].every((r) => box(r).height <= 96))
}

// ── Kategorien ────────────────────────────────────────────────────────────
{
  const list = screenEl('categories')
  const rows = [...list.querySelectorAll('button[aria-label^="Kategorie öffnen"]')]
  add('die Kategorie-Übersicht zeigt alle Oberkategorien', rows.length === 9, rows.length + '')
  const empty = rows.filter((r) => !r.querySelector('.bg-accent'))
  add('leere Kategorien stehen ohne Balken da', empty.length > 0 && empty.length < rows.length, empty.length + '')
  add('…und ganz unten', rows.slice(rows.length - empty.length).every((r) => !r.querySelector('.bg-accent')))
  const unassigned = [...list.querySelectorAll('button')].find((b) => b.textContent.includes('Nicht zugeordnet'))
  add('„Nicht zugeordnet" steht getrennt am Ende', unassigned && !unassigned.getAttribute('aria-label') &&
      box(unassigned).top > box(rows[rows.length - 1]).bottom)
  add('…mit Anzahl und Betrag', unassigned && /1 Buchung · 60,65/.test(unassigned.textContent.replace(/\\u00a0/g, ' ')),
      unassigned ? unassigned.textContent : '')
  const bars = [...frame.querySelectorAll('[aria-label^="Kategorie öffnen"] .bg-accent')]
  add('alle Balken sind blau', new Set(bars.map((b) => getComputedStyle(b).backgroundColor)).size === 1)
  add('kein Balken ist breiter als seine Spur', bars.every((b) => box(b).width <= box(b.parentElement).width + 0.5))
}

// ── Kategorie-Detail ──────────────────────────────────────────────────────
{
  const p = screenEl('parent')
  const t = p.textContent
  for (const s of ['Ausgaben', 'deiner Ausgaben', 'Aufteilung', 'Entwicklung', 'Top-Händler', 'Buchungen']) {
    add('Oberkategorie zeigt „' + s + '"', t.includes(s))
  }
  add('…die Aufteilung nennt jede Unterkategorie mit Daten',
      p.querySelectorAll('button[aria-label^="Kategorie öffnen"]').length === EXPECTED.parentChildren,
      p.querySelectorAll('button[aria-label^="Kategorie öffnen"]').length + '')
  const c = screenEl('child')
  add('Unterkategorie: keine weitere Aufteilung', !c.textContent.includes('Aufteilung'))
  add('…aber der Weg zur Oberkategorie', c.textContent.includes('Teil von Essen & Trinken'))
  add('…und alle ihre Buchungen als Zeilen',
      c.querySelectorAll('button[aria-label^="Buchung öffnen"]').length === EXPECTED.childBookings)
  const plus = [...frame.querySelectorAll('section .text-accent')].filter((el) => /%/.test(el.textContent))
  add('der Vergleich ist Akzent, nicht Rot', plus.length > 0 &&
      plus.every((el) => getComputedStyle(el).color === getComputedStyle(document.querySelector('.text-accent')).color))
}

// ── Verlauf: zwölf Balken, Beschriftungen kollidieren nicht ───────────────
for (const id of ['parent', 'child', 'merchant']) {
  const group = screenEl(id).querySelector('[role="group"][aria-label="Ausgaben je Zeitraum"]')
  const cols = group ? [...group.querySelectorAll('button')] : []
  add(id + ': der Verlauf hat ' + EXPECTED.buckets + ' Balken', cols.length === EXPECTED.buckets, cols.length + '')
  const gap = cols.length > 1 ? box(cols[1]).left - box(cols[0]).right : 0
  const labels = cols.map((b) => b.firstElementChild)
  let collision = null
  for (const a of labels) {
    if (a && a.scrollWidth > a.clientWidth + gap - 2 && !collision) collision = a.textContent + ': ' + a.scrollWidth
  }
  add(id + ': zwei Beträge über den Balken berühren sich nie', collision === null, collision ?? '')
  add(id + ': jede Spalte ist mindestens 44px hoch', cols.every((b) => box(b).height >= 44))
  add(id + ': die Balken bleiben im Rahmen', cols.every((b) => box(b).right <= frameRect.right + 0.5))
}

// ── Händler ───────────────────────────────────────────────────────────────
{
  const list = screenEl('merchants')
  const rows = [...list.querySelectorAll('button[aria-label^="Händler öffnen"]')]
  add('die Händler-Übersicht listet jeden Händler als Knopf', rows.length >= 2, rows.length + '')
  add('…mit Avatar, Name, Anzahl, Betrag und Chevron', rows.every((r) =>
    /Buchung/.test(r.textContent) && /€/.test(r.textContent) && r.lastElementChild.tagName.toLowerCase() === 'svg'))
  const m = screenEl('merchant')
  for (const s of ['Ausgaben', 'Entwicklung', 'Kategorien', 'Buchungen']) {
    add('Händler-Detail zeigt „' + s + '"', m.textContent.includes(s))
  }
  add('…alle Buchungen als Zeilen', m.querySelectorAll('button[aria-label^="Buchung öffnen"]').length === EXPECTED.merchantBookings)
}

// ── Die BottomNav deckt nichts zu ─────────────────────────────────────────
{
  window.scrollTo(0, document.documentElement.scrollHeight)
  const nav = document.querySelector('#nav nav')
  const bar = nav && nav.querySelector('div > div')
  const rows = [...screenEl('merchant').querySelectorAll('button[aria-label^="Buchung öffnen"]')]
  const last = rows[rows.length - 1]
  add('die BottomNav ist da und fest unten', Boolean(bar) && getComputedStyle(nav).position === 'fixed')
  add('am Ende der Seite steht die letzte Buchung über der BottomNav',
      last && bar && box(last).bottom <= box(bar).top + 0.5,
      last && bar ? Math.round(box(last).bottom) + ' vs ' + Math.round(box(bar).top) : '')
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
  const htmlPath = `${cache}/financeDrilldownLayout-${width}x${height}.html`
  writeFileSync(htmlPath, pageFor(width, height))
  const dom = execFileSync(
    CHROMIUM,
    ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${width},${height}`,
     '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const match = dom.match(/<div id="report">([\s\S]*?)<\/div>/)
  if (!match) {
    console.error(`finance drilldown layout: der Browser hat bei ${width}×${height} nichts gemessen.`)
    process.exit(1)
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  for (const entry of JSON.parse(decoded)) {
    if (entry.ok) pass += 1
    else {
      fail += 1
      console.log(`  ✗ ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`)
    }
  }
}

console.log(`finance drilldown layout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
