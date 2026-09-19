// Das Dashboard, ohne Browser: die Vorzeichenregel, das Zeitraum-Modell und die
// vier Auswertungen darüber.
//
// WAS HIER GEPRÜFT WIRD, IST NICHT „ES RECHNET", SONDERN „ES RECHNET DIESELBE
// ZAHL". Vor v1.26 gab es im Finanzmodul keine einzige Summe; jetzt gibt es
// sechs Kacheln, die alle dieselben Buchungen anfassen, und der Fehler, den
// niemand bemerkt, ist der, bei dem die Kategorieliste 1.200 € zusammenzählt
// und die Kennzahl darüber 1.284 € behauptet. Also laufen alle Zahlen durch
// `buildFinanceDashboard`, und die Tests vergleichen sie gegeneinander — nicht
// gegen eine zweite Rechnung im Test.
//
// Und ein zweiter Punkt, der genauso zählt: die Einordnung kommt aus
// `resolveEffectiveClassification`, derselben Rangfolge wie in der
// Zuordnungs-Warteschlange. Deshalb steht hier auch ein Regressionsblock, der
// Override, manual_lock und KI-Vorschlag durch die Auswertung schickt.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  biggestExpenses, buildFinanceDashboard, categoryBreakdown, comparisonRange,
  currentMonthPeriod, dashboardSummary, describePeriod, describeRange, isRealExpense,
  normalizePeriod, periodRange, rangeContains, resolveAnalyticsEntries, topMerchants,
  transactionEffect, trendSeries, DEFAULT_TREND_RANGE, TREND_RANGES,
} from './src/lib/finance/analytics/index.js'
import {
  assignableCategories, categoryPath, categoryTree, isAssignableCategory, isParentCategory,
  parentCategoryOf, categoriesById,
} from './src/lib/finance/categories.js'
import { merchantInitials } from './src/config/merchantLogos.js'
import { tokenize } from './src/lib/finance/normalize.js'
import { financeCategoryRows } from './tools/fixtures/financeCategories.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  x ' + name) } }

const CATEGORIES = financeCategoryRows()
const cat = (slug) => CATEGORIES.find((c) => c.slug === slug).id
const A1 = 'acc-1'
const A2 = 'acc-2-archiviert'

let seq = 0
const tx = (over = {}) => {
  seq += 1
  return {
    id: 'tx-' + seq,
    account_id: A1,
    booking_date: '2026-09-10',
    amount_minor: -1000,
    currency: 'EUR',
    raw_description: 'BUCHUNG ' + seq,
    normalized_tokens: tokenize('BUCHUNG ' + seq),
    merchant_id: null,
    category_id: null,
    transaction_type: 'purchase',
    include_in_analytics: true,
    manual_lock: false,
    ...over,
  }
}

const dash = (over = {}) =>
  buildFinanceDashboard({ categories: CATEGORIES, today: '2026-09-12', ...over })

// == 1. Die Hierarchie ======================================================
{
  const parents = CATEGORIES.filter(isParentCategory)
  const leaves = CATEGORIES.filter(isAssignableCategory)
  ok('neun Oberkategorien, sechsundzwanzig Blaetter',
     parents.length === 9 && leaves.length === 26)
  ok('assignableCategories liefert genau die Blaetter',
     assignableCategories(CATEGORIES).length === leaves.length)
  ok('… und keine Oberkategorie',
     assignableCategories(CATEGORIES).every((c) => c.parent_id !== null))
  ok('… sortiert nach Oberkategorie, darin nach Sortierung',
     assignableCategories(CATEGORIES)[0].slug === 'lebensmittel' &&
     assignableCategories(CATEGORIES)[1].slug === 'restaurant')

  const tree = categoryTree(CATEGORIES)
  ok('der Baum hat neun Aeste', tree.length === 9)
  ok('… jeder mit seinen eigenen Kindern',
     tree[0].parent.slug === 'essen_trinken' &&
     tree[0].children.map((c) => c.slug).join(',') === 'lebensmittel,restaurant')
  ok('… und keine dritte Ebene',
     tree.every((node) => node.children.every((c) => c.parent_id === node.parent.id)))

  const byId = categoriesById(CATEGORIES)
  ok('ein Blatt zaehlt bei seiner Oberkategorie',
     parentCategoryOf(byId, cat('restaurant')).slug === 'essen_trinken')
  ok('eine Oberkategorie zaehlt bei sich selbst',
     parentCategoryOf(byId, cat('shopping')).slug === 'shopping')
  ok('nichts zugeordnet bleibt nichts zugeordnet',
     parentCategoryOf(byId, null) === null && parentCategoryOf(byId, 'erfunden') === null)

  ok('der Weg einer Kategorie nennt beide Ebenen',
     categoryPath(CATEGORIES, cat('restaurant')).label === 'Essen & Trinken · Restaurants & Cafés')
  ok('… und fuer eine Oberkategorie nur eine',
     categoryPath(CATEGORIES, cat('shopping')).label === 'Shopping')
  ok('… und ohne Kategorie gar keine',
     categoryPath(CATEGORIES, null).label === '')

  ok('die fuenf alten Slugs sind Blaetter geblieben',
     ['lebensmittel', 'restaurant', 'klamotten', 'drogerie', 'sonstige'].every(
       (slug) => isAssignableCategory(CATEGORIES.find((c) => c.slug === slug))))
  ok('… und tragen die beschlossenen Namen',
     CATEGORIES.find((c) => c.slug === 'restaurant').label === 'Restaurants & Cafés' &&
     CATEGORIES.find((c) => c.slug === 'klamotten').label === 'Kleidung' &&
     CATEGORIES.find((c) => c.slug === 'sonstige').label === 'Allgemeines Sonstiges')
}

// == 2. Die Vorzeichenregel (Paragraph 6) ===================================
{
  const e = (over) => transactionEffect(over)

  ok('ein Kauf ueber -24,83 EUR ist eine Ausgabe von +24,83 EUR',
     e({ amountMinor: -2483, transactionType: 'purchase' }).expense === 2483)
  ok('… und sein Cashflow ist negativ',
     e({ amountMinor: -2483, transactionType: 'purchase' }).cashflow === -2483)
  ok('… und keine Einnahme',
     e({ amountMinor: -2483, transactionType: 'purchase' }).income === 0)

  ok('eine Umbuchung ist ueberall null',
     JSON.stringify(e({ amountMinor: -200000, transactionType: 'transfer' })) ===
     JSON.stringify({ expense: 0, income: 0, cashflow: 0 }))
  ok('… auch eine eingehende',
     e({ amountMinor: 200000, transactionType: 'transfer' }).cashflow === 0)

  ok('eine Einnahme ist eine Einnahme',
     e({ amountMinor: 205000, transactionType: 'income' }).income === 205000)
  ok('… und keine negative Ausgabe',
     e({ amountMinor: 205000, transactionType: 'income' }).expense === 0)

  ok('eine Retoure senkt die Ausgaben',
     e({ amountMinor: 2483, transactionType: 'refund' }).expense === -2483)
  ok('… und erhoeht den Cashflow',
     e({ amountMinor: 2483, transactionType: 'refund' }).cashflow === 2483)

  ok('eine ausgeschlossene Buchung zaehlt nirgends',
     e({ amountMinor: -9999, transactionType: 'purchase', included: false }).expense === 0)

  ok('Gebuehren und Sonstiges sind Ausgaben',
     e({ amountMinor: -350, transactionType: 'fee' }).expense === 350 &&
     e({ amountMinor: -350, transactionType: 'other' }).expense === 350)
  ok('eine Buchung ohne Art ist ein Kauf',
     e({ amountMinor: -350 }).expense === 350)
  ok('ein Kauf mit positivem Betrag netted nach unten statt zu luegen',
     e({ amountMinor: 350, transactionType: 'purchase' }).expense === -350)
  ok('cashflow ist immer income minus expense', [
       { amountMinor: -2483, transactionType: 'purchase' },
       { amountMinor: 2483, transactionType: 'refund' },
       { amountMinor: 205000, transactionType: 'income' },
       { amountMinor: -1, transactionType: 'fee' },
     ].every((input) => {
       const r = e(input)
       return r.cashflow === r.income - r.expense
     }))

  ok('eine echte Ausgabe ist ein Kauf, keine Retoure',
     isRealExpense({ amountMinor: -2483, transactionType: 'purchase', included: true }) &&
     !isRealExpense({ amountMinor: 2483, transactionType: 'refund', included: true }) &&
     !isRealExpense({ amountMinor: -2483, transactionType: 'transfer', included: true }) &&
     !isRealExpense({ amountMinor: 205000, transactionType: 'income', included: true }) &&
     !isRealExpense({ amountMinor: -2483, transactionType: 'purchase', included: false }))
}

// == 3. Das Zeitraum-Modell (Paragraph 7) ===================================
{
  const TODAY = '2026-09-12'

  ok('der Standard ist der laufende Kalendermonat',
     JSON.stringify(currentMonthPeriod(TODAY)) ===
     JSON.stringify({ kind: 'month', year: 2026, month: 9 }))

  const running = periodRange({ kind: 'month', year: 2026, month: 9 }, TODAY)
  ok('ein laufender Monat endet heute',
     running.from === '2026-09-01' && running.to === TODAY && running.running === true)
  const done = periodRange({ kind: 'month', year: 2026, month: 8 }, TODAY)
  ok('ein abgeschlossener Monat endet an seinem letzten Tag',
     done.from === '2026-08-01' && done.to === '2026-08-31' && done.running === false)

  const cmpRunning = comparisonRange({ kind: 'month', year: 2026, month: 9 }, TODAY)
  ok('ein laufender Monat wird gegen denselben Ausschnitt des Vormonats verglichen',
     cmpRunning.from === '2026-08-01' && cmpRunning.to === '2026-08-12')
  const cmpDone = comparisonRange({ kind: 'month', year: 2026, month: 8 }, TODAY)
  ok('ein abgeschlossener Monat gegen den ganzen Vormonat',
     cmpDone.from === '2026-07-01' && cmpDone.to === '2026-07-31')

  // Der Fall, an dem eine naive Rechnung in den Folgemonat rutscht.
  const cmp31 = comparisonRange({ kind: 'month', year: 2026, month: 3 }, '2026-03-31')
  ok('der 31. Maerz vergleicht gegen den 28. Februar statt gegen den 3. Maerz',
     cmp31.from === '2026-02-01' && cmp31.to === '2026-02-28')
  const cmpLeap = comparisonRange({ kind: 'month', year: 2028, month: 3 }, '2028-03-31')
  ok('… und im Schaltjahr gegen den 29.',
     cmpLeap.to === '2028-02-29')

  const yearRunning = periodRange({ kind: 'year', year: 2026 }, TODAY)
  ok('ein laufendes Jahr endet heute',
     yearRunning.from === '2026-01-01' && yearRunning.to === TODAY)
  ok('… und wird gegen denselben Zeitraum im Vorjahr verglichen',
     JSON.stringify(comparisonRange({ kind: 'year', year: 2026 }, TODAY)) ===
     JSON.stringify({ from: '2025-01-01', to: '2025-09-12' }))
  ok('ein abgeschlossenes Jahr gegen das ganze Vorjahr',
     JSON.stringify(comparisonRange({ kind: 'year', year: 2025 }, TODAY)) ===
     JSON.stringify({ from: '2024-01-01', to: '2024-12-31' }))
  ok('der 29. Februar hat im Vorjahr keinen Gegentag und rutscht nicht in den Maerz',
     comparisonRange({ kind: 'year', year: 2028 }, '2028-02-29').to === '2027-02-28')

  const last30 = periodRange({ kind: 'last30' }, TODAY)
  ok('letzte 30 Tage heisst 30 Tage inklusive heute',
     last30.from === '2026-08-14' && last30.to === '2026-09-12')
  ok('… und wird gegen die 30 Tage unmittelbar davor verglichen',
     JSON.stringify(comparisonRange({ kind: 'last30' }, TODAY)) ===
     JSON.stringify({ from: '2026-07-15', to: '2026-08-13' }))

  const custom = { kind: 'custom', from: '2026-05-01', to: '2026-05-10' }
  ok('ein eigener Zeitraum bleibt, wie er ist',
     periodRange(custom, TODAY).to === '2026-05-10')
  ok('… und wird gegen den gleich langen davor verglichen',
     JSON.stringify(comparisonRange(custom, TODAY)) ===
     JSON.stringify({ from: '2026-04-21', to: '2026-04-30' }))
  ok('vertauschte Enden werden getauscht, nicht abgelehnt',
     normalizePeriod({ kind: 'custom', from: '2026-05-10', to: '2026-05-01' }, TODAY).from ===
     '2026-05-01')
  ok('ein unbekannter Zeitraum wird zum laufenden Monat',
     normalizePeriod({ kind: 'jahrzehnt' }, TODAY).kind === 'month' &&
     normalizePeriod(null, TODAY).month === 9 &&
     normalizePeriod({ kind: 'month', month: 13, year: 2026 }, TODAY).month === 9)

  ok('beide Enden zaehlen mit',
     rangeContains(running, '2026-09-01') && rangeContains(running, TODAY) &&
     !rangeContains(running, '2026-08-31') && !rangeContains(running, '2026-09-13'))

  ok('der Zeitraum hat einen Namen, den ein Mensch liest',
     describePeriod({ kind: 'month', year: 2026, month: 9 }, TODAY) === 'September 2026' &&
     describePeriod({ kind: 'year', year: 2026 }, TODAY) === '2026' &&
     describePeriod({ kind: 'last30' }, TODAY) === 'Letzte 30 Tage')
  ok('eine Spanne im selben Monat wird kurz geschrieben',
     describeRange({ from: '2026-08-01', to: '2026-08-19' }) === '1.–19. August')
  ok('eine ueber Jahresgrenzen nennt beide Jahre',
     describeRange({ from: '2025-12-20', to: '2026-01-05' }) === '20. Dez. 2025 – 5. Jan. 2026')
}

// == 4. Zusammenfassung und Vergleich (Paragraph 8) =========================
{
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -2000, category_id: cat('lebensmittel') }),
    tx({ booking_date: '2026-09-05', amount_minor: -1000, category_id: cat('restaurant') }),
    tx({ booking_date: '2026-09-06', amount_minor: 500, transaction_type: 'refund',
         category_id: cat('lebensmittel') }),
    tx({ booking_date: '2026-09-07', amount_minor: 100000, transaction_type: 'income' }),
    tx({ booking_date: '2026-09-08', amount_minor: -50000, transaction_type: 'transfer' }),
    tx({ booking_date: '2026-09-09', amount_minor: -9999, include_in_analytics: false }),
    // Der Vergleichszeitraum: 1.-12. August.
    tx({ booking_date: '2026-08-03', amount_minor: -2500, category_id: cat('lebensmittel') }),
    // Ausserhalb beider Zeitraeume.
    tx({ booking_date: '2026-08-20', amount_minor: -777777, category_id: cat('lebensmittel') }),
  ]
  const d = dash({ transactions })

  ok('die Ausgaben sind netto: 20 + 10 - 5 = 25 EUR',
     d.summary.expenses === 2500)
  ok('die Einnahme steht bei den Einnahmen',
     d.summary.income === 100000)
  ok('die Umbuchung ist in keiner der drei Zahlen',
     d.summary.cashflow === 100000 - 2500)
  ok('die ausgeschlossene Buchung ist in keiner Zahl',
     d.summary.expenses === 2500)
  ok('der Vergleichszeitraum nimmt nur den 1.-12. August',
     d.summary.comparisonExpenses === 2500)
  ok('gleich viel ist null Prozent',
     d.summary.expenseChange.percent === 0 && d.summary.expenseChange.absolute === 0)
  ok('das juengste einbezogene Buchungsdatum ist Metadatum, nicht Kennzahl',
     d.summary.latestBookingDate === '2026-09-08')
  ok('die Anzahl ist ein Metadatum', typeof d.summary.transactionCount === 'number')

  const grown = dash({
    transactions: [
      tx({ booking_date: '2026-09-02', amount_minor: -2700 }),
      tx({ booking_date: '2026-08-02', amount_minor: -2500 }),
    ],
  })
  ok('acht Prozent mehr sind acht Prozent',
     Math.round(grown.summary.expenseChange.percent) === 8 &&
     grown.summary.expenseChange.direction === 'up')

  const fromNothing = dash({ transactions: [tx({ booking_date: '2026-09-02', amount_minor: -2400 })] })
  ok('ohne Vergleichswert gibt es keine Prozentzahl',
     fromNothing.summary.expenseChange.percent === null &&
     fromNothing.summary.expenseChange.comparable === false)
  ok('… aber sehr wohl einen absoluten Unterschied',
     fromNothing.summary.expenseChange.absolute === 2400)

  const empty = dash({ transactions: [] })
  ok('ein leerer Zeitraum ist nicht kaputt, nur leer',
     empty.summary.expenses === 0 && empty.summary.latestBookingDate === null &&
     empty.categories.parents.length === 0 && empty.merchants.merchants.length === 0 &&
     empty.biggest.length === 0)
}

// == 5. Kategorien (Paragraph 9) ============================================
{
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -20000, category_id: cat('lebensmittel') }),
    tx({ booking_date: '2026-09-03', amount_minor: -10000, category_id: cat('restaurant') }),
    tx({ booking_date: '2026-09-04', amount_minor: -5000, category_id: cat('technik') }),
    tx({ booking_date: '2026-09-05', amount_minor: -5000 }), // nicht zugeordnet
  ]
  const d = dash({ transactions })
  const essen = d.categories.parents.find((p) => p.category.slug === 'essen_trinken')

  ok('Unterkategorien summieren sich zu ihrer Oberkategorie',
     essen.amount === 30000)
  ok('… und die Kinder bleiben einzeln sichtbar',
     essen.children.length === 2 &&
     essen.children[0].category.slug === 'lebensmittel' && essen.children[0].amount === 20000)
  ok('der Prozentsatz bezieht sich auf ALLE einbezogenen Ausgaben',
     Math.round(essen.percentage) === 75)
  ok('… also auch auf die nicht zugeordneten',
     d.categories.totalExpenses === 40000)
  ok('nicht zugeordnet ist ein eigener Posten',
     d.categories.unassigned.amount === 5000 && d.categories.unassigned.count === 1)
  ok('… und bekommt keine erfundene Kategorie',
     d.categories.parents.every((p) => p.category.slug !== 'sonstiges_parent'))
  ok('die Summe der Oberkategorien plus nicht zugeordnet ist die Gesamtsumme',
     d.categories.parents.reduce((s, p) => s + p.amount, 0) + d.categories.unassigned.amount ===
     d.categories.totalExpenses)
  ok('die Kategoriesumme stimmt mit der Kennzahl darueber ueberein',
     d.categories.totalExpenses === d.summary.expenses)
  ok('sortiert nach Betrag', d.categories.parents[0].category.slug === 'essen_trinken')

  const refunded = dash({
    transactions: [
      tx({ booking_date: '2026-09-02', amount_minor: -10000, category_id: cat('klamotten') }),
      tx({ booking_date: '2026-09-03', amount_minor: 4000, transaction_type: 'refund',
           category_id: cat('klamotten') }),
    ],
  })
  ok('eine Retoure verrechnet sich in ihrer Kategorie',
     refunded.categories.parents[0].amount === 6000)

  const noisy = dash({
    transactions: [
      tx({ booking_date: '2026-09-02', amount_minor: 100000, transaction_type: 'income',
           category_id: cat('lebensmittel') }),
      tx({ booking_date: '2026-09-03', amount_minor: -50000, transaction_type: 'transfer',
           category_id: cat('lebensmittel') }),
    ],
  })
  ok('eine Einnahme mit Kategorie landet in keiner Ausgabenkategorie',
     noisy.categories.parents.length === 0 && noisy.categories.totalExpenses === 0)

  // Je eine Buchung in jeder der neun Oberkategorien.
  const many = dash({
    transactions: categoryTree(CATEGORIES).map((node, i) =>
      tx({ booking_date: '2026-09-02', amount_minor: -(1000 + i * 100),
           category_id: node.children[0].id })),
  })
  ok('… und fuehrt sie alle im vollstaendigen Ergebnis',
     many.categories.parents.length === 9)
  ok('das Dashboard fuehrt fuenf Oberkategorien', many.categories.top.length === 5)
  ok('… und sagt, dass es mehr gibt', many.categories.hasMore === true)
  ok('… haelt die vollstaendige Liste aber bereit',
     many.categories.parents.length > 5)
}

// == 6. Haendler (Paragraph 10) =============================================
{
  const M = 'merchant-rewe'
  const merchants = [{ id: M, canonical_name: 'REWE', review_mode: 'auto' }]
  const patterns = [{ id: 'p1', merchant_id: M, pattern_type: 'exact_token', tokens: ['REWE'],
                      active: true }]
  const rules = [{ id: 'r1', merchant_id: M, category_id: cat('lebensmittel'), active: true,
                   min_amount_minor: null, max_amount_minor: null,
                   min_inclusive: true, max_inclusive: true, currency: null }]
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -5230, raw_description: 'REWE TROISDORF',
         normalized_tokens: tokenize('REWE TROISDORF') }),
    // Dasselbe Geschaeft, anderes Konto: kontouebergreifend ein Haendler.
    tx({ booking_date: '2026-09-03', amount_minor: -2890, account_id: A2,
         raw_description: 'REWE KOELN', normalized_tokens: tokenize('REWE KOELN') }),
    tx({ booking_date: '2026-09-04', amount_minor: 1000, transaction_type: 'refund',
         raw_description: 'REWE GUTSCHRIFT', normalized_tokens: tokenize('REWE GUTSCHRIFT') }),
    tx({ booking_date: '2026-09-05', amount_minor: -9999,
         raw_description: 'UNBEKANNT XY', normalized_tokens: tokenize('UNBEKANNT XY') }),
  ]
  const d = dash({ transactions, merchants, patterns, rules })

  ok('der Haendler kommt aus der Pattern-Engine, nicht aus der Spalte',
     d.merchants.merchants.length === 1 && d.merchants.merchants[0].name === 'REWE')
  ok('kontouebergreifend aggregiert, Retoure netto: 52,30 + 28,90 - 10,00',
     d.merchants.merchants[0].amount === 5230 + 2890 - 1000)
  ok('die Buchungen werden gezaehlt', d.merchants.merchants[0].count === 3)
  ok('ein unbekannter Haendler wird nicht erfunden',
     d.merchants.merchants.every((m) => m.name !== '' && m.name !== 'Unbekannt'))
  ok('… seine Buchung zaehlt trotzdem in den Gesamtausgaben',
     d.summary.expenses === 5230 + 2890 - 1000 + 9999)
  ok('der Haendler traegt die Kategorie, unter der er meistens gebucht ist',
     d.merchants.merchants[0].category.label === 'Essen & Trinken · Lebensmittel')

  const named = dash({
    transactions: [tx({ booking_date: '2026-09-02', amount_minor: -2000, id: 'tx-named' })],
    overrides: [{ transaction_id: 'tx-named', merchant_name: 'Lotte', category_id: cat('restaurant') }],
  })
  ok('ein von Hand benannter Haendler zaehlt auch ohne eigene Zeile',
     named.merchants.merchants.length === 1 && named.merchants.merchants[0].name === 'Lotte')

  ok('Initialen sind zwei Buchstaben und nie geraten',
     merchantInitials('Deutsche Bahn') === 'DB' && merchantInitials('REWE') === 'RE' &&
     merchantInitials('dm') === 'DM' && merchantInitials('') === '?')
}

// == 7. Groesste Ausgaben (Paragraph 11) ====================================
{
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -200000, transaction_type: 'transfer' }),
    tx({ booking_date: '2026-09-03', amount_minor: 180000, transaction_type: 'income' }),
    tx({ booking_date: '2026-09-04', amount_minor: 40000, transaction_type: 'refund' }),
    tx({ booking_date: '2026-09-05', amount_minor: -50000, include_in_analytics: false }),
    tx({ booking_date: '2026-09-06', amount_minor: -30000, category_id: cat('technik') }),
    tx({ booking_date: '2026-09-07', amount_minor: -20000, category_id: cat('restaurant') }),
    tx({ booking_date: '2026-09-08', amount_minor: -10000 }),
    tx({ booking_date: '2026-09-09', amount_minor: -5000 }),
  ]
  const d = dash({ transactions })
  ok('genau drei', d.biggest.length === 3)
  ok('absteigend nach Betrag',
     d.biggest.map((b) => b.amount).join(',') === '30000,20000,10000')
  ok('keine Umbuchung, keine Einnahme, keine Retoure, nichts Ausgeschlossenes',
     d.biggest.every((b) => ['purchase', 'fee', 'other'].includes(b.entry.transactionType)) &&
     d.biggest.every((b) => b.entry.included))
  ok('Ober- und Unterkategorie stehen dran',
     d.biggest[0].category.label === 'Shopping · Technik')
  ok('ohne Haendler steht der Originaltext da, kein geratener Name',
     d.biggest[2].hasMerchant === false && d.biggest[2].title.startsWith('BUCHUNG'))
}

// == 8. Verlauf (Paragraph 12) ==============================================
{
  ok('fuenf Zeitspannen', TREND_RANGES.map((r) => r.id).join(',') === '3M,6M,1J,3J,Max')
  ok('der Standard ist 6M', DEFAULT_TREND_RANGE === '6M')

  const entries = resolveAnalyticsEntries({
    transactions: [
      tx({ booking_date: '2026-04-15', amount_minor: -98000 }),
      tx({ booking_date: '2026-09-02', amount_minor: -30000 }),
      tx({ booking_date: '2024-02-10', amount_minor: -1000 }),
    ],
    categories: CATEGORIES,
  })

  const m3 = trendSeries({ entries, range: '3M', today: '2026-09-12' })
  ok('3M sind drei Monatseimer', m3.buckets.length === 3 && m3.granularity === 'month')
  ok('… der letzte ist der laufende',
     m3.buckets[2].start === '2026-09-01' && m3.buckets[2].isPartial === true)
  ok('… und die davor sind es nicht', m3.buckets.slice(0, 2).every((b) => !b.isPartial))
  ok('… mit Betrag im richtigen Eimer', m3.buckets[2].amount === 30000)

  const m6 = trendSeries({ entries, range: '6M', today: '2026-09-12' })
  ok('6M sind sechs Monate', m6.buckets.length === 6)
  ok('… und reichen bis April zurueck', m6.buckets[0].start === '2026-04-01')
  ok('… der April traegt seine 980 EUR', m6.buckets[0].amount === 98000)
  ok('… das Maximum ist der groesste Eimer', m6.max === 98000)

  const y1 = trendSeries({ entries, range: '1J', today: '2026-09-12' })
  ok('1J sind zwoelf Monate', y1.buckets.length === 12 && y1.granularity === 'month')
  ok('… und die Monatsgrenze ueber den Jahreswechsel stimmt',
     y1.buckets[0].start === '2025-10-01' && y1.buckets[0].end === '2025-10-31')

  const y3 = trendSeries({ entries, range: '3J', today: '2026-09-12' })
  ok('3J sind zwoelf Quartale', y3.buckets.length === 12 && y3.granularity === 'quarter')
  ok('… das letzte ist Q3 2026 und laeuft noch',
     y3.buckets[11].start === '2026-07-01' && y3.buckets[11].end === '2026-09-30' &&
     y3.buckets[11].isPartial === true)
  ok('… und Q1 2024 faengt am 1. Januar an',
     y3.buckets[0].start === '2023-10-01')

  const max = trendSeries({ entries, range: 'Max', today: '2026-09-12' })
  ok('Max reicht von der aeltesten Buchung bis heute',
     max.granularity === 'year' && max.buckets[0].start === '2024-01-01' &&
     max.buckets[max.buckets.length - 1].start === '2026-01-01')
  ok('… das laufende Jahr ist angeschnitten',
     max.buckets[max.buckets.length - 1].isPartial === true)
  ok('… und das aelteste Jahr traegt seine Buchung', max.buckets[0].amount === 1000)

  const none = trendSeries({ entries: [], range: 'Max', today: '2026-09-12' })
  ok('ohne eine einzige Buchung bleibt das laufende Jahr uebrig',
     none.buckets.length === 1 && none.buckets[0].amount === 0)

  // Der Verlauf hat seine EIGENE Achse: der Dashboard-Zeitraum gilt fuer ihn nicht.
  const d = dash({
    transactions: [
      tx({ booking_date: '2026-04-15', amount_minor: -98000 }),
      tx({ booking_date: '2026-09-02', amount_minor: -30000 }),
    ],
    trendRange: '6M',
  })
  ok('der Verlauf zeigt auch, was ausserhalb des gewaehlten Zeitraums liegt',
     d.trend.buckets[0].amount === 98000 && d.summary.expenses === 30000)
}

// == 9. Kontenfilter (Paragraph 15) =========================================
{
  const accounts = [
    { id: A1, name: 'DKB Girokonto', currency: 'EUR', archived_at: null },
    { id: A2, name: 'Altes Konto', currency: 'EUR', archived_at: '2026-01-01T00:00:00Z' },
  ]
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -10000, account_id: A1 }),
    tx({ booking_date: '2026-09-03', amount_minor: -4000, account_id: A2 }),
  ]

  const all = dash({ transactions, accounts })
  ok('„Alle Konten" enthaelt auch das archivierte Konto', all.summary.expenses === 14000)

  const one = dash({ transactions, accounts, accountId: A1 })
  ok('ein einzelnes Konto zaehlt nur seine Buchungen', one.summary.expenses === 10000)

  const archived = dash({ transactions, accounts, accountId: A2 })
  ok('ein archiviertes Konto ist einzeln auswaehlbar', archived.summary.expenses === 4000)
  ok('… und der Verlauf folgt derselben Auswahl',
     archived.trend.buckets.reduce((s, b) => s + b.amount, 0) === 4000)
}

// == 10. Regression: die Einordnung ist dieselbe wie in der Warteschlange ====
{
  const M = 'merchant-dm'
  const merchants = [{ id: M, canonical_name: 'dm', review_mode: 'auto' }]
  const patterns = [{ id: 'p1', merchant_id: M, pattern_type: 'exact_token', tokens: ['DM'],
                      active: true }]
  const rules = [{ id: 'r1', merchant_id: M, category_id: cat('drogerie'), active: true,
                   min_amount_minor: null, max_amount_minor: null,
                   min_inclusive: true, max_inclusive: true, currency: null }]

  const ruled = tx({ id: 'tx-rule', booking_date: '2026-09-02', amount_minor: -1500,
                     raw_description: 'DM FILIALE', normalized_tokens: tokenize('DM FILIALE') })
  const overridden = tx({ id: 'tx-over', booking_date: '2026-09-03', amount_minor: -2500,
                          raw_description: 'DM FILIALE', normalized_tokens: tokenize('DM FILIALE') })
  const suggested = tx({ id: 'tx-ai', booking_date: '2026-09-04', amount_minor: -3500,
                         raw_description: 'FREMDER LADEN',
                         normalized_tokens: tokenize('FREMDER LADEN') })
  const open = tx({ id: 'tx-open', booking_date: '2026-09-05', amount_minor: -4500,
                    raw_description: 'NOCH FREMDER', normalized_tokens: tokenize('NOCH FREMDER') })

  const d = dash({
    transactions: [ruled, overridden, suggested, open],
    merchants, patterns, rules,
    overrides: [{ transaction_id: 'tx-over', category_id: cat('gesundheit') }],
    aiSuggestions: [{ transaction_id: 'tx-ai', merchant_name: 'Zalando',
                      category_id: cat('technik'), needs_review: false,
                      created_at: '2026-09-04T10:00:00Z' }],
  })
  const of = (slug) => d.categories.parents.find((p) => p.category.slug === slug)?.amount ?? 0

  ok('eine Regel ordnet ein', of('drogerie_pflege') === 1500)
  ok('ein Override schlaegt die Regel des Haendlers',
     of('gesundheit_sport') === 2500 && of('drogerie_pflege') === 1500)
  ok('ein vollstaendiger KI-Vorschlag zaehlt als eingeordnet', of('shopping') === 3500)
  ok('… und der Haendler daraus taucht in der Haendlerliste auf',
     d.merchants.merchants.some((m) => m.name === 'Zalando'))
  ok('was niemand kennt, bleibt offen', d.summary.openClassifications === 1)
  ok('… zaehlt aber trotzdem in den Gesamtausgaben',
     d.summary.expenses === 1500 + 2500 + 3500 + 4500)
  ok('… und steht bei „nicht zugeordnet"', d.categories.unassigned.amount === 4500)

  const locked = dash({
    transactions: [tx({ id: 'tx-lock', booking_date: '2026-09-02', amount_minor: -1000,
                        manual_lock: true, category_id: cat('haushalt') })],
  })
  ok('manual_lock bleibt eine Entscheidung', locked.summary.openClassifications === 0 &&
     locked.categories.parents[0].category.slug === 'wohnen_haushalt')

  const merchantExcluded = dash({
    transactions: [ruled],
    merchants: [{ ...merchants[0], default_include_in_analytics: false }],
    patterns, rules,
  })
  ok('ein ausgeschlossener Haendler faellt komplett aus der Auswertung',
     merchantExcluded.summary.expenses === 0 &&
     merchantExcluded.merchants.merchants.length === 0 &&
     merchantExcluded.trend.buckets.every((b) => b.amount === 0))
}

// == 11. Die Pipeline ist die Pipeline ======================================
{
  const transactions = [
    tx({ booking_date: '2026-09-02', amount_minor: -2000, category_id: cat('lebensmittel') }),
    tx({ booking_date: '2026-09-03', amount_minor: -3000, category_id: cat('parken') }),
    tx({ booking_date: '2026-09-04', amount_minor: 500, transaction_type: 'refund',
         category_id: cat('parken') }),
  ]
  const d = dash({ transactions })
  const entries = resolveAnalyticsEntries({ transactions, categories: CATEGORIES })
  const cut = entries.filter((e) => rangeContains(d.range, e.bookingDate))

  ok('die Zusammenfassung kommt aus denselben Eintraegen',
     dashboardSummary({ entries: cut }).expenses === d.summary.expenses)
  ok('die Kategorien auch',
     categoryBreakdown({ entries: cut, categories: CATEGORIES }).totalExpenses ===
     d.categories.totalExpenses)
  ok('die Haendler auch',
     topMerchants({ entries: cut, categories: CATEGORIES }).merchants.length ===
     d.merchants.merchants.length)
  ok('die groessten Ausgaben auch',
     biggestExpenses({ entries: cut, categories: CATEGORIES }).length === d.biggest.length)
  ok('und der Zeitraum steht als Beschriftung bereit',
     d.periodLabel === 'September 2026' && d.comparisonLabel !== '')

  // Die Waehrung kommt aus den Buchungen, nicht aus einer Annahme — und zwei
  // Waehrungen in einem Zeitraum werden gemeldet, nicht verrechnet.
  ok('eine Waehrung: die der Buchungen', d.currency === 'EUR' && d.mixedCurrency === false)
  const mixed = dash({
    accounts: [{ id: 'acc-1', name: 'Girokonto', currency: 'EUR' }],
    transactions: [
      tx({ booking_date: '2026-09-02', amount_minor: -1000, currency: 'EUR' }),
      tx({ booking_date: '2026-09-03', amount_minor: -1000, currency: 'AUD' }),
    ],
  })
  ok('zwei Waehrungen werden gemeldet statt verrechnet',
     mixed.mixedCurrency === true && mixed.currency === 'EUR')
}

console.log((fail === 0 ? '' : '\\n') + 'finance dashboard: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeDashboardLogic.mjs', loader: 'js' },
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

const out = `${process.env.SCRATCH || '/tmp'}/financeDashboardLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
