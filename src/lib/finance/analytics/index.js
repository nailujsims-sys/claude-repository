// Die Auswertung des Finanzmoduls, an einer Stelle.
//
// Bis v1.25 war das eine Datei: „zählt diese Buchung?" und sonst nichts, weil es
// nichts zu rechnen gab. v1.26 bringt das Dashboard, und damit die Gefahr, vor
// der 0008 und 0010 schon gewarnt haben: dass zwei Bildschirme dieselbe Zahl
// verschieden ausrechnen. Also gibt es GENAU EINE Pipeline
// (`buildFinanceDashboard` in `dashboard.js`), sie geht durch GENAU EINE
// Einordnung (`resolveEffectiveClassification`) und GENAU EINE Vorzeichenregel
// (`transactionEffect` in `effect.js`), und keine React-Komponente rechnet
// etwas davon nach.
//
// Diese Datei ist nur das Verzeichnis. Wer `from '../lib/finance/analytics'`
// importiert, bekommt weiterhin genau das, was vorher in `analytics.js` stand.

export {
  analyticsInclusion,
  analyticsTransactions,
  excludedMerchants,
  resolveAnalyticsInclusion,
} from './inclusion'

export { EFFECT_ZERO, transactionEffect, isRealExpense, sumEffects } from './effect'

export {
  PERIOD_KINDS,
  comparisonRange,
  currentMonthPeriod,
  describePeriod,
  describeRange,
  monthPeriod,
  normalizePeriod,
  periodRange,
  rangeContains,
  yearPeriod,
} from './period'

export { resolveAnalyticsEntries } from './resolve'
export { dashboardSummary } from './summary'
export { categoryBreakdown } from './categories'
export { topMerchants } from './merchants'
export { biggestExpenses } from './biggest'
export { TREND_RANGES, DEFAULT_TREND_RANGE, trendSeries } from './trend'
export { buildFinanceDashboard } from './dashboard'
