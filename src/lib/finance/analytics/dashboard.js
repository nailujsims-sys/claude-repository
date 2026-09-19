import { resolveAnalyticsEntries } from './resolve'
import { comparisonRange, describePeriod, describeRange, normalizePeriod, periodRange, rangeContains } from './period'
import { dashboardSummary } from './summary'
import { categoryBreakdown } from './categories'
import { topMerchants } from './merchants'
import { biggestExpenses } from './biggest'
import { DEFAULT_TREND_RANGE, trendSeries } from './trend'
import { DEFAULT_FINANCE_CURRENCY } from '../../../config/finance'

// Was `categoryBreakdown` zurückgibt, wenn es nichts zurückgeben darf. Eine
// eigene Konstante, damit „keine Zahlen" überall dieselbe Form hat wie „Zahlen".
const EMPTY_BREAKDOWN = Object.freeze({
  parents: [],
  totalExpenses: null,
  assignedExpenses: null,
  unassigned: { amount: null, count: 0, percentage: null },
})

// Die eine Pipeline. Rohzeilen rein, fertiges Dashboard raus.
//
// WAS SIE SEIN MUSS UND WAS SIE DESHALB NICHT TUT: Sie ist die einzige Stelle,
// an der aus Buchungen Zahlen werden. Kein `useMemo` in einer Komponente
// summiert nebenher etwas mit, keine Kachel rechnet ihren Anteil selbst aus.
// Deshalb ist sie pur — kein React, kein Supabase, keine Uhr: `today` wird
// hereingereicht, und damit ist jede Zahl dieses Bildschirms reproduzierbar
// und testbar.
//
// DIE REIHENFOLGE IST DIE ARCHITEKTUR:
//
//   1. Konten filtern      — welches Geld ist gemeint?
//   2. Einordnen           — eine Auflösung für alle (resolve.js)
//   3. Zeitraum schneiden  — zwei Schnitte: Zeitraum und Vergleichszeitraum
//   4. Zusammenzählen      — Summary, Kategorien, Händler, größte Ausgaben
//   5. Verlauf             — eigene Zeitachse, derselbe Kontenfilter
//
// Schritt 1 kommt VOR Schritt 2, weil das Einordnen die teure Operation ist und
// der Kontenfilter der billige. Schritt 3 kommt NACH Schritt 2, weil der
// Verlauf dieselben eingeordneten Buchungen über eine andere Achse braucht —
// zweimal einordnen wäre zweimal dieselbe Antwort, nur langsamer.
//
// „ALLE KONTEN" HEISST ALLE, auch die archivierten. Das ist die Zusage von
// v1.25: ein archiviertes Konto verschwindet aus der Auswahl für NEUE
// Buchungen, nicht aus der eigenen Geschichte. Wer die Historie liest, liest
// sie vollständig.

/**
 * @param {{
 *   transactions?: Array<object>,
 *   accounts?: Array<object>,
 *   categories?: Array<object>,
 *   merchants?: Array<object>,
 *   patterns?: Array<object>,
 *   rules?: Array<object>,
 *   overrides?: Array<object>,
 *   aiSuggestions?: Array<object>,
 *   period?: object,
 *   accountId?: string|null,
 *   trendRange?: string,
 *   today: string,
 *   topCategories?: number,
 *   topMerchantCount?: number,
 *   biggestCount?: number,
 * }} input
 */
export function buildFinanceDashboard({
  transactions = [],
  accounts = [],
  categories = [],
  merchants = [],
  patterns = [],
  rules = [],
  overrides = [],
  aiSuggestions = [],
  period = null,
  accountId = null,
  trendRange = DEFAULT_TREND_RANGE,
  today,
  topCategories = 5,
  topMerchantCount = 5,
  biggestCount = 3,
} = {}) {
  // 1. Konten. `null` ist „alle Konten", und das schließt archivierte ein.
  const scoped = accountId
    ? transactions.filter((t) => t?.account_id === accountId)
    : transactions

  // 2. Einordnung — einmal, für alles darunter. Die Muster und Regeln werden
  //    dabei NICHT auf das Konto eingeschränkt: ein Händler ist kontoübergreifend
  //    derselbe Händler.
  const entries = resolveAnalyticsEntries({
    transactions: scoped,
    patterns,
    merchants,
    rules,
    overrides,
    aiSuggestions,
    categories,
  })

  // 3. Die beiden Schnitte.
  const normalized = normalizePeriod(period, today)
  const range = periodRange(normalized, today)
  const comparison = comparisonRange(normalized, today)
  const inRange = entries.filter((e) => rangeContains(range, e.bookingDate))
  const inComparison = comparison
    ? entries.filter((e) => rangeContains(comparison, e.bookingDate))
    : []

  // 3b. WELCHE WÄHRUNG? — und was passiert, wenn es zwei sind.
  //
  // Beträge liegen in Minor Units, ohne Kurs und ohne Kontext. 2483 EUR-Cent und
  // 2483 AUD-Cent zu addieren ergibt 4966 von nichts. Eine Summe über zwei
  // Währungen ist keine Summe — sie ist eine Zahl, die aussieht wie eine.
  //
  // UMGERECHNET WIRD NICHT (v1.26). Ein Kurs ist eine eigene Entscheidung mit
  // eigenen Fragen (welcher Kurs, von wann, gespeichert oder live?), und das
  // Ausgaben-Modul zeigt, dass sie nicht nebenbei zu beantworten sind. Also wird
  // hier NICHT gerechnet, sondern gesagt.
  //
  // DER MASSSTAB IST DIE KONTENAUSWAHL, nicht der Zeitraum — und das ist die
  // strengere der beiden möglichen Lesarten, mit Absicht. Ein Dashboard, das im
  // September rechnet, weil dort zufällig nur Euro liegen, und im August nicht,
  // wäre eins, dessen Zahlen beim Blättern die Bedeutung wechseln. Vor allem
  // aber hat der Verlauf seine eigene, längere Zeitachse: er würde sonst
  // unbemerkt EUR und AUD in einen Balken legen, sobald sie nur weit genug
  // auseinander liegen. Eine Auswahl, eine Währung, eine Antwort.
  //
  // Die Abhilfe steht in der Meldung und ist einen Tipp entfernt: ein einzelnes
  // Konto wählen. Mehrere Konten in DERSELBEN Währung rechnen normal weiter.
  const currenciesOf = (list) => {
    const found = new Set()
    for (const entry of list) if (entry.included) found.add(entry.currency)
    return [...found].sort()
  }
  // Ohne eine einzige einbezogene Buchung sagen die KONTEN, worin die Null
  // steht — und wenn die sich uneinig sind, ist das derselbe Fall wie oben:
  // dieselbe Frage, dieselbe Abhilfe, ein Tipp entfernt. So kann gar keine
  // Währung an einer Zahl stehen, die sie nicht trägt.
  const scopedAccounts = accountId ? accounts.filter((a) => a?.id === accountId) : accounts
  const accountCurrencies = [...new Set(scopedAccounts.map((a) => a?.currency).filter(Boolean))].sort()

  const currencies = currenciesOf(entries)
  const inScope = currencies.length > 0 ? currencies : accountCurrencies
  const mixedCurrency = inScope.length > 1
  const currency = mixedCurrency ? null : inScope[0] ?? DEFAULT_FINANCE_CURRENCY

  // 4. Die Zahlen — oder, bei zwei Währungen, ausdrücklich keine.
  const summary = dashboardSummary({
    entries: inRange,
    comparisonEntries: inComparison,
    monetary: !mixedCurrency,
  })
  const breakdown = mixedCurrency
    ? EMPTY_BREAKDOWN
    : categoryBreakdown({ entries: inRange, categories })
  const merchantRows = mixedCurrency
    ? { merchants: [], total: 0 }
    : topMerchants({ entries: inRange, categories, limit: topMerchantCount })
  const biggest = mixedCurrency
    ? []
    : biggestExpenses({ entries: inRange, categories, limit: biggestCount })

  // 5. Der Verlauf, über alle Buchungen dieser Konten — und über eine längere
  //    Achse als alles darüber, weshalb er dieselbe Sperre braucht.
  const trend = mixedCurrency
    ? { range: trendRange, granularity: null, buckets: [], max: 0 }
    : trendSeries({ entries, range: trendRange, today })

  return {
    today,
    period: normalized,
    range,
    comparison,
    periodLabel: describePeriod(normalized, today),
    rangeLabel: describeRange(range),
    comparisonLabel: comparison ? describeRange(comparison) : '',
    accountId: accountId ?? null,
    accountCount: accounts.length,
    currency,
    currencies: inScope,
    mixedCurrency,
    entries,
    periodEntries: inRange,
    summary,
    categories: {
      ...breakdown,
      top: breakdown.parents.slice(0, Math.max(0, topCategories)),
      hasMore: breakdown.parents.length > topCategories,
    },
    merchants: merchantRows,
    biggest,
    trend,
  }
}
