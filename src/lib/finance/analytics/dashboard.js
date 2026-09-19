import { resolveAnalyticsEntries } from './resolve'
import { comparisonRange, describePeriod, describeRange, normalizePeriod, periodRange, rangeContains } from './period'
import { dashboardSummary } from './summary'
import { categoryBreakdown } from './categories'
import { topMerchants } from './merchants'
import { biggestExpenses } from './biggest'
import { DEFAULT_TREND_RANGE, trendSeries } from './trend'

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

  // 4. Die Zahlen.
  const summary = dashboardSummary({ entries: inRange, comparisonEntries: inComparison })
  const breakdown = categoryBreakdown({ entries: inRange, categories })
  const merchantRows = topMerchants({ entries: inRange, categories, limit: topMerchantCount })
  const biggest = biggestExpenses({ entries: inRange, categories, limit: biggestCount })

  // 5. Der Verlauf, über alle Buchungen dieser Konten.
  const trend = trendSeries({ entries, range: trendRange, today })

  // Die Währung, in der diese Zahlen zu lesen sind — aus den Buchungen, nicht
  // aus einer Annahme. Heute ist alles EUR (0008: „die Währung ist ein Wert,
  // keine fest verdrahtete Annahme"), und der Fall, für den diese Zeilen da
  // sind, ist der Tag, an dem jemand ein zweites Konto in einer anderen Währung
  // anlegt: dann steht wenigstens das richtige Zeichen an der Zahl.
  //
  // WAS SIE AUSDRÜCKLICH NICHT TUN: umrechnen. Eine Summe über zwei Währungen
  // ist keine Summe, und ein Kurs gehört in dieses Modul erst, wenn jemand ihn
  // bestellt — `mixedCurrency` sagt der Oberfläche, dass sie es mit genau
  // diesem Fall zu tun hat, statt ihn stillschweigend zu verrechnen.
  const currencies = new Set(inRange.filter((e) => e.included).map((e) => e.currency))
  const accountCurrency = accountId
    ? accounts.find((a) => a?.id === accountId)?.currency ?? null
    : null
  const currency =
    currencies.size === 1 ? [...currencies][0] : accountCurrency ?? accounts[0]?.currency ?? 'EUR'

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
    mixedCurrency: currencies.size > 1,
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
