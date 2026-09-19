import { sumEffects } from './effect'

// Die vier Zahlen der KPI-Karte, und der eine Vergleich darunter.
//
// WANN EINE PROZENTZAHL LÜGT: wenn der Vergleichswert null ist. „Von 0 € auf
// 240 €" sind keine „+∞ %" und erst recht keine „+100 %" — es ist ein Anfang,
// und genau das soll dastehen. Deshalb ist `percent` hier `null`, wann immer es
// mathematisch nichts zu berechnen gibt, und die Oberfläche hat gar nicht erst
// die Gelegenheit, eine Zahl zu zeigen, die keine ist.
//
// `transactionCount` ist ausdrücklich KEINE Kennzahl, sondern eine Angabe über
// die Daten. Wie viele Zeilen eine Summe hat, sagt nichts über Geld; es steht
// hier, damit ein Bildschirm es erwähnen KANN, nicht damit er es groß macht.

/**
 * Die Veränderung zwischen zwei Beträgen.
 *
 * @param {number} current
 * @param {number} previous
 * @returns {{absolute: number, percent: number|null, direction: 'up'|'down'|'flat',
 *            comparable: boolean}}
 */
export function compare(current, previous) {
  const absolute = current - previous
  // Ein Vergleich mit einem Zeitraum, in dem nichts passiert ist, hat einen
  // absoluten Unterschied und keinen relativen. Beides zu behaupten wäre
  // falsch, keines von beidem zu zeigen wäre zu wenig.
  const comparable = previous !== 0
  return {
    absolute,
    percent: comparable ? (absolute / Math.abs(previous)) * 100 : null,
    direction: absolute === 0 ? 'flat' : absolute > 0 ? 'up' : 'down',
    comparable,
  }
}

/**
 * Die Zusammenfassung eines Zeitraums.
 *
 * @param {{entries?: Array<object>, comparisonEntries?: Array<object>}} input
 */
export function dashboardSummary({ entries = [], comparisonEntries = [], monetary = true } = {}) {
  const totals = sumEffects(entries.map((e) => e.effect))
  const previous = sumEffects(comparisonEntries.map((e) => e.effect))
  // `monetary = false` heißt: in diesem Ausschnitt liegen zwei Währungen, und
  // eine gemeinsame Summe gibt es deshalb nicht (siehe dashboard.js). Sie wird
  // dann nicht berechnet und auch nicht auf 0 gesetzt — `null` ist die einzige
  // Antwort, die eine Oberfläche nicht versehentlich als Betrag anzeigen kann.
  const money = (value) => (monetary ? value : null)

  // Das jüngste Datum, das in diesen Zahlen steckt — die ehrliche Antwort auf
  // „bis wann sind die Daten?". Ausgeschlossene Buchungen zählen dabei nicht:
  // sie sind in keiner der Zahlen darüber enthalten.
  let latestBookingDate = null
  let openClassifications = 0
  for (const entry of entries) {
    if (entry.included && entry.bookingDate && entry.bookingDate > (latestBookingDate ?? '')) {
      latestBookingDate = entry.bookingDate
    }
    if (entry.needsDecision) openClassifications += 1
  }

  return {
    expenses: money(totals.expense),
    income: money(totals.income),
    cashflow: money(totals.cashflow),
    comparisonExpenses: money(previous.expense),
    comparisonIncome: money(previous.income),
    expenseChange: monetary
      ? compare(totals.expense, previous.expense)
      : { absolute: null, percent: null, direction: 'flat', comparable: false },
    // Metadaten, keine Kennzahlen.
    transactionCount: entries.filter((e) => e.included).length,
    latestBookingDate,
    openClassifications,
  }
}
