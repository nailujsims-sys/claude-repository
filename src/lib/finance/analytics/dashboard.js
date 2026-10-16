import { resolveAnalyticsEntries } from './resolve'
import { financeScope } from './scope'
import { dashboardSummary } from './summary'
import { categoryBreakdown } from './categories'
import { topMerchants } from './merchants'
import { biggestExpenses } from './biggest'
import { DEFAULT_TREND_RANGE, trendSeries } from './trend'
import { needsDecision } from '../classificationQueue'

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
//   1. Einordnen           — eine Auflösung für ALLE Buchungen (resolve.js)
//   2. Konten filtern      — welches Geld ist gemeint?
//   3. Zeitraum schneiden  — zwei Schnitte: Zeitraum und Vergleichszeitraum
//   4. Zusammenzählen      — Summary, Kategorien, Händler, größte Ausgaben
//   5. Verlauf             — eigene Zeitachse, derselbe Kontenfilter
//
// Schritt 3 kommt NACH Schritt 1, weil der Verlauf dieselben eingeordneten
// Buchungen über eine andere Achse braucht — zweimal einordnen wäre zweimal
// dieselbe Antwort, nur langsamer.
//
// SCHRITT 1 STAND BIS v1.26.2 HINTER DEM KONTENFILTER, aus einem vernünftigen
// Grund: Einordnen ist die teure Operation, Filtern die billige. Es war
// trotzdem falsch, und zwar nicht aus Gründen der Geschwindigkeit — die
// Einordnung hängt gar nicht am Konto (Muster und Regeln gelten
// kontoübergreifend, siehe unten), und die REVIEW-INBOX braucht sie für ALLE
// Buchungen. Jetzt wird einmal alles eingeordnet und danach gefiltert; die
// Auswertung sieht davon nichts, sie bekommt dieselbe Liste wie vorher.
//
// „ALLE KONTEN" HEISST ALLE, auch die archivierten. Das ist die Zusage von
// v1.25: ein archiviertes Konto verschwindet aus der Auswahl für NEUE
// Buchungen, nicht aus der eigenen Geschichte. Wer die Historie liest, liest
// sie vollständig.
//
// ── ZWEI SCOPES, DIE NICHTS MITEINANDER ZU TUN HABEN (v1.26.2) ─────────────
//
// Die AUSWERTUNG beantwortet „was ist in diesem Zeitraum auf diesen Konten
// passiert?". Sie ist gefiltert, und das ist ihr Sinn.
//
// Die REVIEW-INBOX beantwortet „was braucht noch meine Entscheidung?". Das ist
// eine Frage über den Kontostand der ARBEIT, nicht über einen Monat. Sie wird
// deshalb aus ALLEN Buchungen des Nutzers gebildet — ohne Monat, ohne Jahr,
// ohne „Letzte 30 Tage", ohne eigenen Zeitraum, ohne Trend-Achse und ohne
// Kontenfilter.
//
// WARUM DAS EIN ECHTER FEHLER WAR: wer „Letzte 30 Tage" wählte, sah siebzehn
// offene Buchungen aus 2025 nicht mehr — die Warteschlange versteckte sich
// hinter einem Filter, der über sie nichts aussagt. Die Arbeit verschwand nicht,
// nur der Hinweis darauf.
//
// ES GIBT KEINE ZWEITE DEFINITION VON „OFFEN". `needsDecision` kommt aus
// classificationQueue.js und liest dieselbe Antwort, die auch das
// Zuordnungs-Sheet benutzt (effectiveClassification.js). Hier wird gezählt,
// nicht entschieden.

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
 *   resolved?: Array<object>|null,
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
  resolved = null,
  period = null,
  accountId = null,
  trendRange = DEFAULT_TREND_RANGE,
  today,
  topCategories = 5,
  topMerchantCount = 5,
  biggestCount = 3,
} = {}) {
  // 1. Einordnung — einmal, für alles darunter, und über ALLE Buchungen. Die
  //    Muster und Regeln werden dabei nicht auf ein Konto eingeschränkt: ein
  //    Händler ist kontoübergreifend derselbe Händler.
  //
  //    `resolved` (v1.27): wer die Einträge schon aufgelöst hat — der
  //    gemeinsame Finanz-Kontext tut das einmal für alle Finanz-Bildschirme —,
  //    reicht sie herein, und hier wird nicht ein zweites Mal eingeordnet. Es
  //    ist dieselbe Funktion mit denselben Zeilen; nur seltener.
  const allEntries = resolved ?? resolveAnalyticsEntries({
    transactions,
    patterns,
    merchants,
    rules,
    overrides,
    aiSuggestions,
    categories,
  })

  // 1b. Die Review-Inbox: ungefiltert, vor jedem Schnitt. Sie steht hier oben,
  //     damit sichtbar bleibt, dass nichts darunter sie mehr erreichen kann.
  const reviewEntries = allEntries.filter(needsDecision)

  // 2.–3b. Konten, Zeitraum, Vergleichszeitraum, Währung — der Ausschnitt.
  //    Seit v1.27 in scope.js, weil die Detailseiten exakt denselben brauchen.
  const scope = financeScope({ entries: allEntries, accounts, accountId, period, today })
  const { entries, inRange, inComparison, mixedCurrency, currency } = scope

  // 4. Die Zahlen — oder, bei zwei Währungen, ausdrücklich keine.
  const summary = dashboardSummary({
    entries: inRange,
    comparisonEntries: inComparison,
    monetary: !mixedCurrency,
    // Die einzige Zahl der Karte, die NICHT aus `inRange` kommt.
    openClassifications: reviewEntries.length,
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
    period: scope.period,
    range: scope.range,
    comparison: scope.comparison,
    periodLabel: scope.periodLabel,
    rangeLabel: scope.rangeLabel,
    comparisonLabel: scope.comparisonLabel,
    accountId: scope.accountId,
    accountCount: accounts.length,
    currency,
    currencies: scope.currencies,
    mixedCurrency,
    entries,
    periodEntries: inRange,
    // Alles, was der Nutzer hat — für einen Aufrufer, der wirklich alles
    // braucht, und als Beleg, dass `entries` der gefilterte Ausschnitt ist.
    allEntries,
    // Die Review-Inbox, als Liste und als Zahl. Zeitraum- und kontenunabhängig.
    review: { entries: reviewEntries, count: reviewEntries.length },
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
