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

/** Der Umschlag als Text, wie ChatGPT ihn zurückgeben soll. */
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
