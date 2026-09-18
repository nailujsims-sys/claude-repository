// Das verbindliche Importformat — einmal aufgeschrieben, an einer Stelle.
//
// Der KI-Import ist bankunabhängig, und das ist keine Absichtserklärung, sondern
// eine Eigenschaft dieser Datei: alles, was nach dem Einfügen passiert, kennt nur
// noch dieses Format. Ob der Auszug von der DKB, von N26, von Revolut oder von
// einer Bank kam, die es in Deutschland gar nicht gibt, ist ab hier nicht mehr
// unterscheidbar — und genau deshalb funktioniert der Weg für alle.
//
// VERSIONIERT, UND STRENG. `version` ist kein Etikett: der Parser weigert sich,
// eine Version zu lesen, die er nicht kennt, statt zu raten, welche Felder wohl
// gemeint sind. Ein Modell, das morgen ein Feld umbenennt, produziert dann eine
// Fehlermeldung und keine falschen Buchungen.

/** Der Name, an dem eine Antwort als für diese App bestimmt erkennbar ist. */
export const AI_IMPORT_FORMAT = 'leben-finance-import'

/** Die einzige Version, die dieser Parser lesen kann. */
export const AI_IMPORT_VERSION = 1

/**
 * Die Felder einer Buchung im Format, in der Reihenfolge, in der sie im Prompt
 * erklärt werden. Der Prompt und der Parser lesen dieselbe Liste, damit die
 * beiden nicht auseinanderlaufen.
 */
export const AI_IMPORT_FIELDS = Object.freeze([
  'booking_date',
  'amount',
  'currency',
  'raw_description',
  'merchant',
  'category',
  'transaction_type',
  'include_in_analytics',
  'note',
  'needs_review',
])

/** Ein Beispiel-Datensatz, wie er im Prompt steht — dieselbe Quelle, ein Ort. */
export const AI_IMPORT_EXAMPLE = Object.freeze({
  booking_date: '2026-09-18',
  amount: -24.95,
  currency: 'EUR',
  raw_description: 'REWE TROISDORF SAGT DANKE 8407',
  merchant: 'REWE',
  category: 'lebensmittel',
  transaction_type: 'purchase',
  include_in_analytics: true,
  note: null,
  needs_review: false,
})

// ── Das sichtbare Format: eine Zeile je Buchung ─────────────────────────────
// Was ChatGPT seit v1.23 zurückgeben soll. Eine Tabelle kann ein Mensch
// überfliegen, bevor er sie einfügt; einen JSON-Baum kann er nur glauben.
// Der JSON-Weg oben bleibt als kompatibler Nebeneingang bestehen — beide enden
// nach dem Einlesen in exakt demselben internen Modell.

/** Die Spalten, in dieser Reihenfolge. Prompt und Parser lesen dieselbe Liste. */
export const AI_CSV_COLUMNS = Object.freeze([
  'Datum',
  'Beschreibung',
  'Betrag',
  'Währung',
  'Händler',
  'Kategorie',
  'Typ',
  'Auswertung',
  'Notiz',
  'Prüfen',
])

/** Die feste Kopfzeile. */
export const AI_CSV_HEADER = AI_CSV_COLUMNS.join(';')

/** Der Trenner. Genau einer, und er steht hier, damit ihn niemand neu erfindet. */
export const AI_CSV_SEPARATOR = ';'

/** Zwei Beispielzeilen für den Prompt — eine sichere, eine unsichere. */
export const AI_CSV_EXAMPLE_ROWS = Object.freeze([
  '2026-09-18;REWE TROISDORF SAGT DANKE 8407;-24,95;EUR;REWE;lebensmittel;purchase;true;;false',
  '2026-09-19;PAYPAL .Zalando SE;-8,99;EUR;;;purchase;true;;true',
])

/** Kopfzeile plus Beispielzeilen, als ein Block. */
export function formatExampleTable() {
  return [AI_CSV_HEADER, ...AI_CSV_EXAMPLE_ROWS].join('\n')
}

/** Der Umschlag als Text, wie der kompatible JSON-Weg ihn erwartet. */
export function formatExampleJson() {
  return JSON.stringify(
    {
      format: AI_IMPORT_FORMAT,
      version: AI_IMPORT_VERSION,
      transactions: [AI_IMPORT_EXAMPLE],
    },
    null,
    2
  )
}

/**
 * Warum eine Zeile geprüft werden muss. Die Gründe sind Codes, keine Sätze —
 * die Sätze stehen in src/lib/finance/ai/messages.js, damit dieselbe Ursache
 * überall gleich heißt.
 */
export const REVIEW_REASONS = Object.freeze({
  MODEL_UNSURE: 'model_unsure',
  MERCHANT_MISSING: 'merchant_missing',
  CATEGORY_UNKNOWN: 'category_unknown',
  CATEGORY_MISSING: 'category_missing',
})
