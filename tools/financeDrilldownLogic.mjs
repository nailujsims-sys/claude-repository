// Die Drilldowns (v1.27), ohne Browser: Kategorie-Übersicht, Kategorie-Detail,
// Händler-Detail, ihre Verläufe — und die Adressen, unter denen sie stehen.
//
// DIE EINE FRAGE, DIE HIER ZÄHLT: rechnet eine Detailseite DIESELBE Zahl wie
// die Übersicht? „Lebensmittel 428,30 €" auf dem Dashboard und „Lebensmittel
// 428,30 €" oben auf der Kategorie-Seite müssen dieselbe Summe über dieselben
// Buchungen sein. Deshalb vergleichen die Tests die Detailfunktionen gegen
// `buildFinanceDashboard` und `categoryBreakdown` — nicht gegen eine zweite
// Rechnung im Test.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  buildFinanceDashboard, categoryBreakdown, categoryDetail, categoryOverview, categoryTrend,
  financeScope, isExpenseContribution, merchantDetail, merchantOverview, merchantTrend,
  newestFirst, resolveAnalyticsEntries, trendSeries, unassignedDetail,
} from './src/lib/finance/analytics/index.js'
import {
  FINANCE_ROUTES, categoryRoute, decodeMerchantKey, encodeMerchantKey, merchantRoute,
} from './src/lib/finance/routes.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { financeCategoryRows } from './tools/fixtures/financeCategories.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  x ' + name) } }

const CATEGORIES = financeCategoryRows()
const cat = (slug) => CATEGORIES.find((c) => c.slug === slug).id
const TODAY = '2026-09-12'
const A1 = 'acc-dkb'
const A2 = 'acc-tagesgeld'
const ACCOUNTS = [
  { id: A1, name: 'DKB Girokonto', currency: 'EUR' },
  { id: A2, name: 'Tagesgeld', currency: 'EUR' },
]

let seq = 0
const tx = (over = {}) => {
  seq += 1
  const raw = over.raw_description ?? ('BUCHUNG ' + seq)
  return {
    id: 'tx-' + String(seq).padStart(3, '0'),
    account_id: A1, booking_date: '2026-09-05', amount_minor: -1000, currency: 'EUR',
    merchant_id: null, category_id: null, transaction_type: 'purchase',
    include_in_analytics: true, manual_lock: false,
    ...over,
    raw_description: raw, normalized_tokens: tokenize(raw),
  }
}

// Ein Haendler mit eigener Zeile (die UUID-Art) — ueber die Pattern-Engine.
const REWE = '7c1f0d6e-1b2a-4c3d-8e9f-0a1b2c3d4e5f'
const merchants = [{ id: REWE, canonical_name: 'REWE', review_mode: 'auto' }]
const patterns = [{ id: 'p-rewe', merchant_id: REWE, pattern_type: 'exact_token', tokens: ['REWE'], active: true }]
const rules = [{ id: 'r-rewe', merchant_id: REWE, category_id: cat('lebensmittel'), active: true,
                 min_amount_minor: null, max_amount_minor: null, min_inclusive: true,
                 max_inclusive: true, currency: null }]

// Der Datensatz. Heute ist der 12.09.2026; der Vergleichszeitraum des
// laufenden Monats ist der 01.–12.08.
const T = {
  rewe1:     tx({ raw_description: 'REWE TROISDORF', booking_date: '2026-09-02', amount_minor: -4000 }),
  rewe2:     tx({ raw_description: 'REWE KOELN', booking_date: '2026-09-08', amount_minor: -2000, account_id: A2 }),
  reweRet:   tx({ raw_description: 'REWE GUTSCHRIFT', booking_date: '2026-09-09', amount_minor: 500, transaction_type: 'refund' }),
  // Ein Restaurant, von Hand benannt — in zwei Schreibweisen.
  lotte1:    tx({ id: 'tx-lotte-1', booking_date: '2026-09-03', amount_minor: -3000, category_id: cat('restaurant') }),
  lotte2:    tx({ id: 'tx-lotte-2', booking_date: '2026-09-10', amount_minor: -1500, category_id: cat('restaurant') }),
  // Kleidung, ein ganz anderer Bereich.
  kleid:     tx({ booking_date: '2026-09-04', amount_minor: -12000, category_id: cat('klamotten') }),
  // Nicht zugeordnet: zaehlt in den Gesamtausgaben, in keiner Kategorie.
  offen:     tx({ booking_date: '2026-09-06', amount_minor: -700 }),
  // Eine Umbuchung MIT Kategorie: zaehlt nirgends.
  umbuchung: tx({ booking_date: '2026-09-07', amount_minor: -50000, transaction_type: 'transfer', category_id: cat('lebensmittel') }),
  // Ausgeschlossen, MIT Kategorie: zaehlt nirgends.
  aus:       tx({ booking_date: '2026-09-07', amount_minor: -9900, include_in_analytics: false, category_id: cat('lebensmittel') }),
  // Eine Einnahme mit Kategorie: keine Ausgabe.
  ein:       tx({ booking_date: '2026-09-01', amount_minor: 200000, transaction_type: 'income', category_id: cat('lebensmittel') }),
  // Der Vergleichszeitraum: 01.–12.08. — und eine Buchung am 20.08., die NICHT hineingehoert.
  augRewe:   tx({ raw_description: 'REWE AUGUST', booking_date: '2026-08-05', amount_minor: -5000 }),
  augSpaet:  tx({ booking_date: '2026-08-20', amount_minor: -7777, category_id: cat('lebensmittel') }),
  // Historie fuer den Verlauf.
  juli:      tx({ booking_date: '2026-07-15', amount_minor: -1200, category_id: cat('restaurant') }),
  maerz:     tx({ raw_description: 'REWE MAERZ', booking_date: '2026-03-15', amount_minor: -3300 }),
}
const transactions = Object.values(T)
const overrides = [
  { transaction_id: 'tx-lotte-1', merchant_name: 'Lotte', category_id: cat('restaurant') },
  { transaction_id: 'tx-lotte-2', merchant_name: '  LOTTE ', category_id: cat('restaurant') },
]

const resolved = resolveAnalyticsEntries({ transactions, merchants, patterns, rules, overrides, categories: CATEGORIES })
const scopeOf = (over = {}) =>
  financeScope({ entries: resolved, accounts: ACCOUNTS, accountId: null, period: null, today: TODAY, ...over })
const dashOf = (over = {}) =>
  buildFinanceDashboard({ resolved, accounts: ACCOUNTS, categories: CATEGORIES, today: TODAY, ...over })

const scope = scopeOf()
const dash = dashOf()

// == 0. Eine Pipeline, nicht zwei ===========================================
{
  const raw = buildFinanceDashboard({
    transactions, merchants, patterns, rules, overrides, accounts: ACCOUNTS,
    categories: CATEGORIES, today: TODAY,
  })
  ok('vorab aufgeloeste Eintraege ergeben dasselbe Dashboard',
     JSON.stringify(raw.summary) === JSON.stringify(dash.summary) &&
     JSON.stringify(raw.categories.parents.map((p) => [p.category.id, p.amount])) ===
     JSON.stringify(dash.categories.parents.map((p) => [p.category.id, p.amount])))
  ok('der Ausschnitt ist der des Dashboards: Zeitraum',
     scope.periodLabel === dash.periodLabel && scope.range.from === dash.range.from &&
     scope.range.to === dash.range.to)
  ok('… und Vergleichszeitraum', scope.comparison.from === '2026-08-01' &&
     scope.comparison.to === '2026-08-12' && scope.comparisonLabel === dash.comparisonLabel)
  ok('period = null ist der laufende Monat', scope.periodLabel === 'September 2026')
  ok('isExpenseContribution: Kauf ja, Retoure ja, Umbuchung/Einnahme/ausgeschlossen nein',
     isExpenseContribution(resolved.find((e) => e.id === T.rewe1.id)) &&
     isExpenseContribution(resolved.find((e) => e.id === T.reweRet.id)) &&
     !isExpenseContribution(resolved.find((e) => e.id === T.umbuchung.id)) &&
     !isExpenseContribution(resolved.find((e) => e.id === T.ein.id)) &&
     !isExpenseContribution(resolved.find((e) => e.id === T.aus.id)))
}

// == 1. Kategorie-Uebersicht ================================================
{
  const overview = categoryOverview({ entries: scope.inRange, categories: CATEGORIES })
  const parents = CATEGORIES.filter((c) => c.parent_id === null)
  const essen = overview.rows.find((r) => r.category.slug === 'essen_trinken')
  const shopping = overview.rows.find((r) => r.category.slug === 'shopping')

  ok('alle Oberkategorien stehen da, auch die leeren', overview.rows.length === parents.length)
  ok('keine Unterkategorie als eigene Zeile',
     overview.rows.every((r) => r.category.parent_id === null))
  ok('Oberkategorie = Summe ihrer Kinder: 40 + 20 - 5 (REWE) + 30 + 15 (Lotte)',
     essen.amount === 4000 + 2000 - 500 + 3000 + 1500)
  ok('… und die Kinder summieren sich zur Oberkategorie',
     essen.children.reduce((s, c) => s + c.amount, 0) === essen.amount)
  ok('Umbuchung, Einnahme und ausgeschlossene Buchung zaehlen in keiner Kategorie',
     essen.count === 5)
  ok('Sortierung: Betrag absteigend (Shopping 120 vor Essen 100)',
     overview.rows[0] === shopping && overview.rows[1] === essen)
  const empty = overview.rows.filter((r) => r.empty)
  ok('leere Kategorien sind markiert', empty.length === parents.length - 2)
  ok('… haben 0 €', empty.every((r) => r.amount === 0 && r.count === 0))
  ok('… stehen hinter allem, was etwas gekostet hat',
     overview.rows.findIndex((r) => r.empty) === 2)
  ok('… und untereinander nach Name (stabiler Gleichstand)',
     empty.map((r) => r.category.label).join('|') ===
     empty.map((r) => r.category.label).slice().sort((a, b) => a.localeCompare(b, 'de')).join('|'))
  ok('die Zeilen sind dieselben wie auf dem Dashboard',
     dash.categories.parents.every((p) =>
       overview.rows.find((r) => r.category.id === p.category.id).amount === p.amount))
  ok('"Nicht zugeordnet" ist keine Zeile',
     overview.rows.every((r) => r.category && r.category.id))
  ok('… sondern ein eigener Posten: 1 Buchung, 7,00 €',
     overview.unassigned.count === 1 && overview.unassigned.amount === 700)
  ok('Gesamtausgaben = Kategorien + nicht zugeordnet',
     overview.totalExpenses ===
       overview.rows.reduce((s, r) => s + r.amount, 0) + overview.unassigned.amount)
  ok('Gleichstand im Betrag wird nach Name entschieden', (() => {
    const tie = resolveAnalyticsEntries({ categories: CATEGORIES, transactions: [
      tx({ amount_minor: -1000, category_id: cat('klamotten') }),
      tx({ amount_minor: -1000, category_id: cat('lebensmittel') }),
    ] })
    const rows = categoryOverview({ entries: tie, categories: CATEGORIES }).rows
    return rows[0].category.label === 'Essen & Trinken' && rows[1].category.label === 'Shopping'
  })())
  ok('ohne Buchungen: alle leer, kein Anteil behauptet', (() => {
    const o = categoryOverview({ entries: [], categories: CATEGORIES })
    return o.rows.length === parents.length && o.rows.every((r) => r.empty && r.percentage === null)
  })())

  const u = unassignedDetail({ scope })
  ok('die Seite "Nicht zugeordnet" nennt dieselbe Zahl',
     u.amount === overview.unassigned.amount && u.count === overview.unassigned.count &&
     u.bookings.length === 1 && u.bookings[0].id === T.offen.id)
}

// == 2. Kategorie-Detail ====================================================
{
  const parent = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('essen_trinken') })
  const child = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('lebensmittel') })
  const resto = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('restaurant') })
  const row = dash.categories.parents.find((p) => p.category.slug === 'essen_trinken')

  ok('gefunden, als Oberkategorie erkannt', parent.found && parent.isParent && parent.label === 'Essen & Trinken')
  ok('Oberkategorie aggregiert ihre Kinder', parent.amount === child.amount + resto.amount)
  ok('… und ist dieselbe Zahl wie auf dem Dashboard', parent.amount === row.amount)
  ok('Unterkategorie enthaelt nur ihre eigenen Buchungen: 40 + 20 - 5',
     child.amount === 5500 && child.bookings.every((e) => e.categoryId === cat('lebensmittel')))
  ok('… ist als Kind erkannt und kennt ihre Oberkategorie',
     !child.isParent && child.parent.slug === 'essen_trinken' && child.label === 'Lebensmittel')
  ok('… und hat keine weitere Aufteilung', child.children.length === 0)
  ok('Aufteilung: genau die Kinder mit Daten',
     parent.children.length === 2 &&
     parent.children.map((c) => c.category.slug).join(',') === 'lebensmittel,restaurant')
  ok('… Balken relativ zur Oberkategorie, nicht zu allen Ausgaben',
     Math.abs(parent.children[0].percentage - (5500 / 10000) * 100) < 1e-9 &&
     Math.abs(parent.children.reduce((s, c) => s + c.percentage, 0) - 100) < 1e-9)
  ok('Anteil an den Gesamtausgaben (inkl. nicht zugeordnet)',
     Math.abs(parent.percentage - (10000 / 22700) * 100) < 1e-9 &&
     parent.totalExpenses === dash.summary.expenses)
  ok('Retoure netto: die Gutschrift senkt die Summe und steht in den Buchungen',
     child.bookings.some((e) => e.id === T.reweRet.id) && child.amount === 4000 + 2000 - 500)
  ok('Umbuchung ausgeschlossen — Summe und Liste',
     child.bookings.every((e) => e.id !== T.umbuchung.id))
  ok('include_in_analytics = false ausgeschlossen — Summe und Liste',
     child.bookings.every((e) => e.id !== T.aus.id))
  ok('Einnahme mit Kategorie ist keine Ausgabe dieser Kategorie',
     child.bookings.every((e) => e.id !== T.ein.id))
  ok('Vergleich: dieselben Tage im Vormonat, nicht der ganze Monat',
     child.comparisonAmount === 5000)
  ok('… mit derselben Prozentregel wie die KPI-Karte: (55 - 50) / 50 = +10 %',
     child.change.comparable && Math.round(child.change.percent) === 10 && child.change.direction === 'up')
  ok('ohne Vergleichswert keine Prozentzahl',
     !resto.change.comparable && resto.change.percent === null)
  ok('Buchungen neueste zuerst', child.bookings.map((e) => e.bookingDate).join(',') ===
     '2026-09-09,2026-09-08,2026-09-02')
  ok('Top-Haendler innerhalb der Kategorie', child.merchants.length === 1 &&
     child.merchants[0].key === REWE && child.merchants[0].amount === 5500)
  ok('… Oberkategorie: beide Haendler, nach Betrag', parent.merchants.map((m) => m.name).join(',') === 'REWE,Lotte')

  // Kontofilter: nur DKB — die REWE-Buchung vom Tagesgeld faellt heraus.
  const dkb = categoryDetail({ scope: scopeOf({ accountId: A1 }), categories: CATEGORIES, categoryId: cat('lebensmittel') })
  ok('Kontofilter: nur Buchungen des gewaehlten Kontos', dkb.amount === 4000 - 500 &&
     dkb.bookings.every((e) => e.accountId === A1))
  ok('… und der Anteil bezieht sich auf die Ausgaben DIESES Kontos',
     Math.abs(dkb.percentage - (3500 / (22700 - 2000)) * 100) < 1e-9)

  // Zeitraum: August komplett — abgeschlossener Monat gegen kompletten Juli.
  const aug = categoryDetail({ scope: scopeOf({ period: { kind: 'month', year: 2026, month: 8 } }),
                               categories: CATEGORIES, categoryId: cat('lebensmittel') })
  ok('Zeitraum: der ganze August, auch der 20.', aug.amount === 5000 + 7777)
  ok('… nichts aus dem September', aug.bookings.every((e) => e.bookingDate.startsWith('2026-08')))
  const last30 = scopeOf({ period: { kind: 'last30' } })
  ok('Letzte 30 Tage gegen die 30 Tage davor', last30.range.from === '2026-08-14' &&
     last30.comparison.to === '2026-08-13' && last30.comparison.from === '2026-07-15')
  const custom = scopeOf({ period: { kind: 'custom', from: '2026-09-01', to: '2026-09-10' } })
  ok('Benutzerdefiniert gegen den gleich langen Zeitraum davor',
     custom.comparison.from === '2026-08-22' && custom.comparison.to === '2026-08-31')
  const year = scopeOf({ period: { kind: 'year', year: 2026 } })
  ok('laufendes Jahr gegen YTD Vorjahr', year.comparison.from === '2025-01-01' && year.comparison.to === '2025-09-12')

  ok('unbekannte Kategorie: nicht gefunden statt erfunden',
     categoryDetail({ scope, categories: CATEGORIES, categoryId: 'gibt-es-nicht' }).found === false)
  const leer = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('wohnen_haushalt') })
  ok('leere Kategorie: 0 €, keine Buchungen, keine Haendler, aber gefunden',
     leer.found && leer.amount === 0 && leer.bookings.length === 0 && leer.merchants.length === 0)

  // Zwei Waehrungen: keine Zahl, die Buchungen trotzdem.
  const mixedResolved = resolveAnalyticsEntries({ categories: CATEGORIES, transactions: [
    tx({ amount_minor: -1000, category_id: cat('lebensmittel') }),
    tx({ amount_minor: -1000, category_id: cat('lebensmittel'), currency: 'AUD', account_id: 'acc-aud' }),
  ] })
  const mixedScope = financeScope({ entries: mixedResolved, accounts: [], today: TODAY })
  const mixed = categoryDetail({ scope: mixedScope, categories: CATEGORIES, categoryId: cat('lebensmittel') })
  ok('zwei Waehrungen: keine Summe, kein Anteil, kein Vergleich',
     mixedScope.mixedCurrency && mixed.amount === null && mixed.percentage === null &&
     mixed.change.comparable === false && !mixed.monetary)
  ok('… kein Verlauf, keine Haendler', mixed.trend.buckets.length === 0 && mixed.merchants.length === 0)
  ok('… aber die Buchungen, jede in ihrer Waehrung', mixed.bookings.length === 2)
  ok('… und keine Haendlerliste', merchantOverview({ scope: mixedScope }).merchants.length === 0)
}

// == 3. Kategorie-Verlauf ===================================================
{
  const range = '6M'
  const parentTrend = categoryTrend({ entries: scope.entries, categoryId: cat('essen_trinken'), range, today: TODAY })
  const childTrend = categoryTrend({ entries: scope.entries, categoryId: cat('restaurant'), range, today: TODAY })
  const all = trendSeries({ entries: scope.entries, range, today: TODAY })
  const bucket = (t, key) => t.buckets.find((b) => b.key === key)

  ok('dieselben Eimer wie der Dashboard-Verlauf',
     parentTrend.buckets.map((b) => b.key).join() === all.buckets.map((b) => b.key).join() &&
     parentTrend.buckets.length === 6 && parentTrend.buckets[0].key === '2026-04')
  ok('September: die Kategorie allein (100 €), nicht alle Ausgaben', bucket(parentTrend, '2026-09').amount === 10000)
  ok('August: 50 + 77,77', bucket(parentTrend, '2026-08').amount === 5000 + 7777)
  ok('Juli: nur das Restaurant', bucket(parentTrend, '2026-07').amount === 1200)
  ok('Unterkategorie: nur ihre eigenen Buchungen',
     bucket(childTrend, '2026-09').amount === 4500 && bucket(childTrend, '2026-08').amount === 0 &&
     bucket(childTrend, '2026-07').amount === 1200)
  ok('Ober = Summe der Kinder in jedem Eimer', parentTrend.buckets.every((b) => {
    const c1 = categoryTrend({ entries: scope.entries, categoryId: cat('lebensmittel'), range, today: TODAY })
    return b.amount === bucket(c1, b.key).amount + bucket(childTrend, b.key).amount
  }))
  ok('der laufende Monat ist angeschnitten', bucket(parentTrend, '2026-09').isPartial === true &&
     bucket(parentTrend, '2026-08').isPartial === false)
  ok('Umbuchung und ausgeschlossene Buchung in keinem Balken', bucket(parentTrend, '2026-09').count === 5)
  ok('1J reicht bis zum Maerz zurueck', bucket(
    categoryTrend({ entries: scope.entries, categoryId: cat('lebensmittel'), range: '1J', today: TODAY }),
    '2026-03').amount === 3300)
  const detail = categoryDetail({ scope, categories: CATEGORIES, categoryId: cat('essen_trinken'), trendRange: '3M' })
  ok('das Detail benutzt die gewaehlte Spanne', detail.trend.range === '3M' && detail.trend.buckets.length === 3)
}

// == 4. Haendler-Detail =====================================================
{
  const rewe = merchantDetail({ scope, categories: CATEGORIES, merchantKey: REWE })
  ok('UUID-Haendler: gefunden, mit Zeile und Namen',
     rewe.found && rewe.merchantId === REWE && rewe.merchant?.canonical_name === 'REWE' && rewe.name === 'REWE')
  ok('kontouebergreifend, Retoure netto: 40 + 20 - 5', rewe.amount === 5500 && rewe.count === 3)
  ok('dieselbe Zahl wie in der Haendlerliste des Dashboards',
     dash.merchants.merchants.find((m) => m.key === REWE).amount === rewe.amount)
  ok('Vergleich mit denselben Tagen im Vormonat', rewe.comparisonAmount === 5000 &&
     Math.round(rewe.change.percent) === 10)
  ok('Kategorienverteilung nach Unterkategorie',
     rewe.categories.length === 1 && rewe.categories[0].label === 'Lebensmittel' &&
     rewe.categories[0].parent.slug === 'essen_trinken' && Math.round(rewe.categories[0].percentage) === 100)
  ok('Verlauf: nur dieser Haendler',
     rewe.trend.buckets.find((b) => b.key === '2026-09').amount === 5500 &&
     merchantDetail({ scope, categories: CATEGORIES, merchantKey: REWE, trendRange: '1J' })
       .trend.buckets.find((b) => b.key === '2026-03').amount === 3300)

  const key = 'name:lotte'
  const lotte = merchantDetail({ scope, categories: CATEGORIES, merchantKey: key })
  ok('name:-Haendler: gefunden, ohne Zeile', lotte.found && lotte.merchant === null && lotte.merchantId === null)
  ok('… zwei Schreibweisen ("Lotte", "  LOTTE ") sind EIN Haendler',
     lotte.count === 2 && lotte.amount === 4500 &&
     resolved.filter((e) => e.merchantKey === key).length === 2)
  ok('… der Name ist so geschrieben, wie er in der Liste steht', lotte.name === 'Lotte')
  ok('… Kategorien: Restaurants & Cafés', lotte.categories.length === 1 &&
     lotte.categories[0].label === 'Restaurants & Cafés')
  ok('… ohne Vergleichswert keine Prozentzahl', lotte.change.comparable === false)

  // Ein Haendler mit gemischten Kategorien, einer Umbuchung und nicht zugeordneten Buchungen.
  const M = 'm-amazon'
  const amz = [{ id: M, canonical_name: 'Amazon', review_mode: 'auto' }]
  const amzPatterns = [{ id: 'p-amz', merchant_id: M, pattern_type: 'exact_token', tokens: ['AMAZON'], active: true }]
  const amzTx = [
    tx({ raw_description: 'AMAZON 1', amount_minor: -6000, category_id: cat('klamotten'), manual_lock: true }),
    tx({ raw_description: 'AMAZON 2', amount_minor: -3000, category_id: cat('drogerie'), manual_lock: true }),
    tx({ raw_description: 'AMAZON 3', amount_minor: 1000, transaction_type: 'refund', category_id: cat('klamotten'), manual_lock: true }),
    tx({ raw_description: 'AMAZON 4', amount_minor: -2000 }),
    tx({ raw_description: 'AMAZON 5', amount_minor: -80000, transaction_type: 'transfer' }),
  ]
  const amzResolved = resolveAnalyticsEntries({ transactions: amzTx, merchants: amz, patterns: amzPatterns, categories: CATEGORIES })
  const amzScope = financeScope({ entries: amzResolved, accounts: ACCOUNTS, today: TODAY })
  const d = merchantDetail({ scope: amzScope, categories: CATEGORIES, merchantKey: M })
  ok('Kategorienverteilung: Kleidung 50 netto, Drogerie 30',
     d.categories.map((c) => c.label + '=' + c.amount).join(',') === 'Kleidung=5000,Drogerie=3000')
  ok('… Anteile relativ zum Haendler', Math.abs(d.categories[0].percentage - 50) < 1e-9)
  ok('… nicht zugeordnet bleibt ein Posten, keine Kategorie',
     d.unassigned.count === 1 && d.unassigned.amount === 2000 && d.categories.every((c) => c.category))
  ok('Retoure netto, Umbuchung ausgeschlossen: 60 + 30 - 10 + 20',
     d.amount === 10000 && d.count === 4 && d.bookings.every((e) => e.transactionType !== 'transfer'))

  // Ein Haendler ohne Buchung im Zeitraum ist trotzdem ein Haendler.
  const quiet = merchantDetail({ scope: scopeOf({ period: { kind: 'month', year: 2026, month: 6 } }),
                                 categories: CATEGORIES, merchantKey: REWE })
  ok('Haendler ohne Buchung im Zeitraum: gefunden, 0 €', quiet.found && quiet.amount === 0 && quiet.count === 0)
  ok('unbekannter Schluessel: nicht gefunden',
     merchantDetail({ scope, categories: CATEGORIES, merchantKey: 'name:gibtsnicht' }).found === false)

  const list = merchantOverview({ scope, categories: CATEGORIES }).merchants
  ok('Haendler-Uebersicht: alle mit Aktivitaet, nach Betrag', list.map((m) => m.name).join(',') === 'REWE,Lotte')
  ok('… dieselben Zahlen wie das Dashboard', list.every((m) =>
    dash.merchants.merchants.find((x) => x.key === m.key).amount === m.amount))
  ok('… nur Haendler mit Aktivitaet im Ausschnitt', merchantOverview({
    scope: scopeOf({ period: { kind: 'month', year: 2026, month: 3 } }), categories: CATEGORIES,
  }).merchants.map((m) => m.name).join(',') === 'REWE')
  ok('merchantTrend = Verlauf ueber nur diesen Haendler',
     merchantTrend({ entries: scope.entries, merchantKey: key, range: '6M', today: TODAY })
       .buckets.reduce((s, b) => s + b.amount, 0) === 4500)
}

// == 5. Adressen ============================================================
{
  ok('eine UUID steht unveraendert in der Adresse', encodeMerchantKey(REWE) === REWE &&
     merchantRoute(REWE) === '/finanzen/haendler/' + REWE)
  const nasty = ['name:lotte', 'name:café müller', 'name:db.vertrieb.gmbh/5083', 'name:a#b?c%d e', 'name:日本']
  ok('name:-Schluessel werden zu einem einzigen, sicheren Pfadsegment',
     nasty.every((k) => /^n~[A-Za-z0-9_-]+$/.test(encodeMerchantKey(k))))
  ok('… und kommen unveraendert zurueck', nasty.every((k) => decodeMerchantKey(encodeMerchantKey(k)) === k))
  ok('eine ID mit unsicheren Zeichen wird ebenfalls kodiert',
     /^k~/.test(encodeMerchantKey('a/b')) && decodeMerchantKey(encodeMerchantKey('a/b')) === 'a/b')
  ok('Unsinn wird zu null, nicht zu einem erfundenen Haendler',
     decodeMerchantKey('n~%%%') === null && decodeMerchantKey('a/b') === null && decodeMerchantKey('') === null)
  ok('Kategorie-Adressen', categoryRoute(cat('lebensmittel')) === '/finanzen/kategorien/' + cat('lebensmittel'))
  ok('die festen Routen', FINANCE_ROUTES.categories === '/finanzen/kategorien' &&
     FINANCE_ROUTES.merchants === '/finanzen/haendler' && FINANCE_ROUTES.overview === '/finanzen')
}

// == 6. Ordnung =============================================================
{
  const sorted = newestFirst([
    { id: 'b', bookingDate: '2026-09-01' }, { id: 'a', bookingDate: '2026-09-01' }, { id: 'c', bookingDate: '2026-09-03' },
  ])
  ok('neueste zuerst, id als Gleichstand', sorted.map((e) => e.id).join('') === 'cab')
}

console.log((fail === 0 ? '' : '\\n') + 'finance drilldown: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeDrilldownLogic.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: {
    'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }),
  },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeDrilldownLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
