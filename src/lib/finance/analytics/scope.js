import { comparisonRange, describePeriod, describeRange, normalizePeriod, periodRange, rangeContains } from './period'
import { DEFAULT_FINANCE_CURRENCY } from '../../../config/finance'

// Der Ausschnitt, über den eine Auswertung redet: welche Konten, welcher
// Zeitraum, wogegen verglichen wird, und in welcher Währung.
//
// WARUM DAS SEIT v1.27 EINE EIGENE FUNKTION IST. Bis v1.26.2 standen diese
// Schritte mitten in `buildFinanceDashboard`, und das war richtig, solange es
// genau einen Bildschirm gab. Mit den Detailseiten gibt es vier, und jeder
// braucht exakt dieselben Antworten: dasselbe Konto, denselben Zeitraum,
// DENSELBEN Vergleichszeitraum, dieselbe Währungssperre. Eine Kategorie, die
// „+6 % ggü. Vormonat" sagt, während die Übersicht darüber einen anderen
// Vormonat meint, wäre genau der Widerspruch, den diese Pipeline ausschließen
// soll. Also gibt es den Ausschnitt einmal, hier, und das Dashboard ist nur
// einer seiner Leser.
//
// Die Einordnung ist NICHT Teil davon. Sie hängt nicht am Konto und nicht am
// Zeitraum und wird vorher genau einmal gemacht (resolve.js); dieser Schnitt
// arbeitet auf bereits aufgelösten Einträgen und ist deshalb billig.
//
// ── WELCHE WÄHRUNG? — und was passiert, wenn es zwei sind ─────────────────
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
//
// „ALLE KONTEN" HEISST ALLE, auch die archivierten — die Zusage von v1.25.

/**
 * @param {{
 *   entries?: Array<object>,   aufgelöste Einträge ALLER Buchungen (resolve.js)
 *   accounts?: Array<object>,
 *   accountId?: string|null,
 *   period?: object|null,
 *   today: string,
 * }} input
 */
export function financeScope({
  entries: allEntries = [],
  accounts = [],
  accountId = null,
  period = null,
  today,
} = {}) {
  // Konten. `null` ist „alle Konten", und das schließt archivierte ein.
  const entries = accountId ? allEntries.filter((e) => e.accountId === accountId) : allEntries

  // Die beiden Schnitte.
  const normalized = normalizePeriod(period, today)
  const range = periodRange(normalized, today)
  const comparison = comparisonRange(normalized, today)
  const inRange = entries.filter((e) => rangeContains(range, e.bookingDate))
  const inComparison = comparison
    ? entries.filter((e) => rangeContains(comparison, e.bookingDate))
    : []

  // Die Währung (siehe oben).
  const found = new Set()
  for (const entry of entries) if (entry.included) found.add(entry.currency)
  const currencies = [...found].sort()
  // Ohne eine einzige einbezogene Buchung sagen die KONTEN, worin die Null
  // steht — und wenn die sich uneinig sind, ist das derselbe Fall wie oben:
  // dieselbe Frage, dieselbe Abhilfe, ein Tipp entfernt. So kann gar keine
  // Währung an einer Zahl stehen, die sie nicht trägt.
  const scopedAccounts = accountId ? accounts.filter((a) => a?.id === accountId) : accounts
  const accountCurrencies = [...new Set(scopedAccounts.map((a) => a?.currency).filter(Boolean))].sort()
  const inScope = currencies.length > 0 ? currencies : accountCurrencies
  const mixedCurrency = inScope.length > 1
  const currency = mixedCurrency ? null : inScope[0] ?? DEFAULT_FINANCE_CURRENCY

  return {
    today,
    period: normalized,
    range,
    comparison,
    periodLabel: describePeriod(normalized, today),
    rangeLabel: describeRange(range),
    comparisonLabel: comparison ? describeRange(comparison) : '',
    accountId: accountId ?? null,
    currency,
    currencies: inScope,
    mixedCurrency,
    // Alles, was der Nutzer hat — kontounabhängig. Ein Händler, den es nur auf
    // einem anderen Konto gibt, ist trotzdem ein Händler, den es gibt.
    allEntries,
    // Die gewählten Konten, über die ganze Zeit — die Achse des Verlaufs.
    entries,
    // Die gewählten Konten im Zeitraum, und im Vergleichszeitraum.
    inRange,
    inComparison,
  }
}
