import { categoriesById, categoryPath, isParentCategory } from '../categories'
import { isExpenseContribution } from './effect'
import { categoryBreakdown } from './categories'
import { topMerchants } from './merchants'
import { DEFAULT_TREND_RANGE, trendSeries } from './trend'
import { compare } from './summary'

// Die Detailseiten des Finanzmoduls (v1.27): eine Kategorie, ein Händler, und
// das, was noch keiner Kategorie gehört.
//
// HIER WIRD NICHTS NEU DEFINIERT. Jede Zahl, die eine Detailseite zeigt, gibt
// es auf der Übersicht schon — nur über alle Kategorien statt über eine. Also
// ist jede Funktion hier ein FILTER vor einer bestehenden Rechnung:
//
//   Betrag           Σ effect.expense über `isExpenseContribution`  (effect.js)
//   Anteil           derselbe Nenner wie „Ausgaben nach Kategorie"  (categoryBreakdown)
//   Aufteilung       die Kindzeilen derselben Oberkategorie          (categoryBreakdown)
//   Vergleich        derselbe Vergleichszeitraum wie die KPI-Karte   (scope.js → period.js)
//                    und dieselbe Prozentregel                        (summary.js → compare)
//   Entwicklung      dieselben Eimer, nur weniger Buchungen darin     (trend.js)
//   Top-Händler      dieselbe Händlerliste, nur weniger Buchungen     (merchants.js)
//
// Damit kann eine Detailseite der Übersicht nicht widersprechen: „Lebensmittel
// 428,30 €" ist auf beiden Seiten dieselbe Summe über dieselben Einträge.
//
// SIE ARBEITEN AUF EINEM AUSSCHNITT, NICHT AUF ROHZEILEN. `scope` kommt aus
// `financeScope` (scope.js) und enthält bereits aufgelöste Einträge — die
// teure Einordnung ist zu diesem Zeitpunkt längst passiert, einmal, für alle
// Bildschirme. Hier wird nur noch gefiltert und gezählt.
//
// ZWEI WÄHRUNGEN HEISSEN KEINE ZAHL, auch hier. Ist der Ausschnitt gemischt,
// kommen alle Beträge als `null` zurück, Verlauf und Aufteilungen leer — und
// die Buchungen trotzdem, denn jede Buchungszeile trägt ihre eigene Währung und
// ist keine Summe. Dieselbe Regel wie auf dem Buchungen-Tab.
//
// DIE BUCHUNGEN EINER DETAILSEITE sind genau die, die in ihrer Summe stecken:
// einbezogen und mit Ausgabenwirkung, Retouren eingeschlossen. Eine Umbuchung
// oder eine ausgeschlossene Buchung, die zufällig eine Kategorie trägt, steht
// nicht unter einer Zahl, zu der sie nichts beiträgt.

const EMPTY_TREND = Object.freeze({ range: DEFAULT_TREND_RANGE, granularity: null, buckets: [], max: 0 })
const NO_CHANGE = Object.freeze({ absolute: null, percent: null, direction: 'flat', comparable: false })

const lastLabel = (path) => path.labels[path.labels.length - 1] ?? ''
const sumExpense = (entries) => entries.reduce((sum, e) => sum + (e.effect?.expense ?? 0), 0)

/**
 * Neueste zuerst — dieselbe Ordnung wie im Buchungen-Tab, damit eine Buchung
 * auf jeder Liste an derselben relativen Stelle steht. Die id ist der
 * Gleichstand: zwei Buchungen vom selben Tag tauschen nicht bei jedem Laden.
 *
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
export function newestFirst(entries = []) {
  return entries
    .slice()
    .sort(
      (a, b) =>
        String(b.bookingDate ?? '').localeCompare(String(a.bookingDate ?? '')) ||
        String(a.id ?? '').localeCompare(String(b.id ?? ''))
    )
}

/**
 * Gehört dieser Eintrag zu dieser Kategorie?
 *
 * Für eine Unterkategorie: genau ihre eigenen Buchungen. Für eine
 * Oberkategorie: die aller ihrer Kinder — und, falls es sie aus alten Daten
 * gibt, die direkt auf ihr gebuchten. Das ist dieselbe Aggregation wie in
 * `categoryBreakdown`; `parentCategoryId` hat `resolveAnalyticsEntries` mit
 * derselben Funktion bestimmt (`parentCategoryOf`).
 */
const inCategory = (categoryId) => (entry) =>
  Boolean(categoryId) && (entry.categoryId === categoryId || entry.parentCategoryId === categoryId)

const ofMerchant = (merchantKey) => (entry) => Boolean(merchantKey) && entry.merchantKey === merchantKey

/**
 * Der Verlauf einer Kategorie — nur ihre Ausgaben, über die Achse des
 * Dashboards. Oberkategorie: alle Kinder zusammen. Unterkategorie: nur sie.
 *
 * @param {{entries?: Array<object>, categoryId: string, range?: string, today: string}} input
 */
export function categoryTrend({ entries = [], categoryId, range = DEFAULT_TREND_RANGE, today }) {
  return trendSeries({ entries: entries.filter(inCategory(categoryId)), range, today })
}

/**
 * Der Verlauf eines Händlers.
 *
 * @param {{entries?: Array<object>, merchantKey: string, range?: string, today: string}} input
 */
export function merchantTrend({ entries = [], merchantKey, range = DEFAULT_TREND_RANGE, today }) {
  return trendSeries({ entries: entries.filter(ofMerchant(merchantKey)), range, today })
}

/**
 * Eine Kategorie, im gewählten Ausschnitt.
 *
 * @param {{
 *   scope: object,                 aus financeScope
 *   categories?: Array<object>,
 *   categoryId: string,
 *   trendRange?: string,
 *   merchantLimit?: number,
 * }} input
 */
export function categoryDetail({
  scope,
  categories = [],
  categoryId,
  trendRange = DEFAULT_TREND_RANGE,
  merchantLimit = 5,
}) {
  const byId = categoriesById(categories)
  const category = categoryId ? byId.get(categoryId) ?? null : null
  if (!category || !scope) return { found: false, category: null }

  const isParent = isParentCategory(category)
  const parent = isParent ? null : byId.get(category.parent_id) ?? null
  const matches = inCategory(category.id)
  const monetary = !scope.mixedCurrency

  const contributing = scope.inRange.filter((e) => matches(e) && isExpenseContribution(e))
  const previous = scope.inComparison.filter((e) => matches(e) && isExpenseContribution(e))
  const amount = sumExpense(contributing)

  // Der Nenner des Anteils und die Kindzeilen kommen aus derselben Aufteilung,
  // die die Übersicht zeichnet — nicht aus einer zweiten Rechnung.
  const breakdown = categoryBreakdown({ entries: scope.inRange, categories })
  const row = isParent ? breakdown.parents.find((p) => p.category?.id === category.id) ?? null : null
  // Balken relativ zur OBERKATEGORIE, nicht zu allen Ausgaben: die Frage
  // dieses Abschnitts ist „wie teilt sich DIESES Geld auf?".
  const children = (row?.children ?? []).map((child) => ({
    ...child,
    percentage: row.amount > 0 ? (child.amount / row.amount) * 100 : null,
  }))

  const percentage =
    breakdown.totalExpenses > 0 ? (amount / breakdown.totalExpenses) * 100 : null

  return {
    found: true,
    category,
    isParent,
    parent,
    label: lastLabel(categoryPath(byId, category.id)),
    monetary,
    currency: scope.currency,
    amount: monetary ? amount : null,
    count: contributing.length,
    percentage: monetary ? percentage : null,
    totalExpenses: monetary ? breakdown.totalExpenses : null,
    comparisonAmount: monetary ? sumExpense(previous) : null,
    change: monetary ? compare(amount, sumExpense(previous)) : NO_CHANGE,
    children: monetary && isParent ? children : [],
    trend: monetary
      ? categoryTrend({ entries: scope.entries, categoryId: category.id, range: trendRange, today: scope.today })
      : { ...EMPTY_TREND, range: trendRange },
    merchants: monetary
      ? topMerchants({ entries: contributing, categories, limit: merchantLimit }).merchants
      : [],
    bookings: newestFirst(contributing),
  }
}

/**
 * Ein Händler, im gewählten Ausschnitt.
 *
 * ZWEI ARTEN VON HÄNDLER, EIN SCHLÜSSEL. Ein angelegter Händler heißt nach
 * seiner `finance_merchants`-ID; ein bloß benannter (getippt oder vom Modell
 * erkannt) heißt `name:<normalisierter Name>` — so, wie `resolveAnalyticsEntries`
 * ihn gebildet hat. „REWE" und „rewe " sind damit ein Händler, ohne dass diese
 * Funktion davon wissen muss.
 *
 * GEFUNDEN IST, WAS ES GIBT — nicht, was im Zeitraum liegt. Ein Händler ohne
 * Buchung im gewählten Monat ist trotzdem ein Händler; die Seite zeigt dann
 * 0 € und sagt warum, statt „nicht gefunden" zu behaupten.
 *
 * @param {{
 *   scope: object,
 *   categories?: Array<object>,
 *   merchantKey: string,
 *   trendRange?: string,
 * }} input
 */
export function merchantDetail({ scope, categories = [], merchantKey, trendRange = DEFAULT_TREND_RANGE }) {
  if (!scope || !merchantKey) return { found: false, merchantKey: merchantKey ?? null }
  const matches = ofMerchant(merchantKey)

  const contributing = scope.inRange.filter((e) => matches(e) && isExpenseContribution(e))
  const previous = scope.inComparison.filter((e) => matches(e) && isExpenseContribution(e))

  // Wer ist das? Zuerst die Zeile aus `finance_merchants`, wenn es eine gibt;
  // sonst der Name aus dem Zeitraum (so steht er auch in der Händlerliste);
  // sonst irgendeine Buchung dieses Händlers, kontounabhängig.
  const all = scope.allEntries ?? scope.entries
  const withRow = all.find((e) => matches(e) && e.merchant)
  const identity = withRow ?? contributing[0] ?? all.find(matches) ?? null
  if (!identity) return { found: false, merchantKey }

  const merchant = withRow?.merchant ?? null
  const name = merchant?.canonical_name ?? identity.merchantName ?? ''
  const monetary = !scope.mixedCurrency
  const amount = sumExpense(contributing)

  // Die Kategorien dieses Händlers, auf Ebene der Unterkategorie. Anteil
  // relativ zum Händler: „wofür habe ich DORT Geld ausgegeben?".
  const byId = categoriesById(categories)
  const buckets = new Map()
  const unassigned = { amount: 0, count: 0 }
  for (const entry of contributing) {
    if (!entry.categoryId) {
      unassigned.amount += entry.effect.expense
      unassigned.count += 1
      continue
    }
    const bucket = buckets.get(entry.categoryId) ?? { categoryId: entry.categoryId, amount: 0, count: 0 }
    bucket.amount += entry.effect.expense
    bucket.count += 1
    buckets.set(entry.categoryId, bucket)
  }
  const categoryRows = [...buckets.values()]
    .map((bucket) => {
      const path = categoryPath(byId, bucket.categoryId)
      return {
        category: path.child ?? path.parent,
        parent: path.parent,
        label: lastLabel(path),
        amount: bucket.amount,
        count: bucket.count,
        percentage: amount > 0 ? (bucket.amount / amount) * 100 : null,
      }
    })
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'de'))

  return {
    found: true,
    merchantKey,
    merchantId: identity.merchantId ?? null,
    merchant,
    name,
    monetary,
    currency: scope.currency,
    amount: monetary ? amount : null,
    count: contributing.length,
    comparisonAmount: monetary ? sumExpense(previous) : null,
    change: monetary ? compare(amount, sumExpense(previous)) : NO_CHANGE,
    categories: monetary ? categoryRows : [],
    unassigned: monetary ? unassigned : { amount: null, count: unassigned.count },
    trend: monetary
      ? merchantTrend({ entries: scope.entries, merchantKey, range: trendRange, today: scope.today })
      : { ...EMPTY_TREND, range: trendRange },
    bookings: newestFirst(contributing),
  }
}

/**
 * Alle Händler mit Aktivität im Ausschnitt — die Liste hinter „Alle anzeigen".
 * Dieselbe Funktion wie die Top-5 der Übersicht, nur ohne Grenze.
 *
 * @param {{scope: object, categories?: Array<object>}} input
 */
export function merchantOverview({ scope, categories = [] }) {
  if (!scope || scope.mixedCurrency) return { merchants: [], total: null }
  return topMerchants({ entries: scope.inRange, categories })
}

/**
 * „Nicht zugeordnet" — KEINE Kategorie, sondern ein Zustand.
 *
 * Die Buchungen im Ausschnitt, die in den Gesamtausgaben stecken und in keiner
 * Kategorie. Betrag und Anzahl sind dieselben, die `categoryBreakdown` als
 * `unassigned` meldet; hier kommen nur die Buchungen dazu, damit man sieht,
 * WELCHE es sind. Keine Entwicklung, keine Händler, kein Anteil — das wären
 * Aussagen über einen Ausgabenbereich, und das ist es nicht.
 *
 * @param {{scope: object}} input
 */
export function unassignedDetail({ scope }) {
  if (!scope) return { amount: null, count: 0, bookings: [] }
  const contributing = scope.inRange.filter((e) => !e.categoryId && isExpenseContribution(e))
  return {
    monetary: !scope.mixedCurrency,
    currency: scope.currency,
    amount: scope.mixedCurrency ? null : sumExpense(contributing),
    count: contributing.length,
    bookings: newestFirst(contributing),
  }
}
