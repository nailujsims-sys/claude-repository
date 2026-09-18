import { parseNumber } from '../listParsing'
import { tokenize } from './normalize'

// Eine Buchung von Hand — vom Formular zu dem, was die Datenbank bekommt.
//
// Das Formular kennt „Ausgabe oder Einnahme" und einen Betrag ohne Vorzeichen,
// weil das die Frage ist, die ein Mensch beantwortet. Die Datenbank kennt einen
// vorzeichenbehafteten Betrag in Minor-Units, weil das die Frage ist, die ein
// Kontoauszug beantwortet. Diese Datei ist die Übersetzung zwischen beiden — und
// sie ist der einzige Ort, an dem sie stattfindet.
//
// DER BETRAG IST EINE GANZE ZAHL, von hier an bis in die Spalte. „24,95" wird
// über den Zahl-Parser der Listen gelesen (derselbe, der „1.250,50" überall
// sonst in dieser App richtig versteht — ein zweiter Parser wäre der Anfang
// davon, dass die beiden sich irgendwann uneinig sind) und sofort in 2495
// verwandelt. Es gibt keine Stelle dazwischen, an der ein Float gerundet werden
// könnte.
//
// PROVENANCE, EHRLICH. Eine manuelle Buchung gehört zu keinem Import, also
// bekommt sie keine `import_id` — und schon gar keine erfundene Datei. Woher sie
// kommt, steht in `source_metadata`, an derselben Stelle, an der der PDF-Parser
// auch hinterlässt, was er gesehen hat.
//
// Pur, ohne React und ohne Supabase (siehe tools/financeAiLogic.mjs).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_AMOUNT_MINOR = 9007199254740991

/** Geld raus / Geld rein — die einzige Entscheidung, die das Vorzeichen setzt. */
export const DIRECTIONS = Object.freeze(['out', 'in'])

/** Die Buchungsart, die zu einer Richtung gehört, solange nichts anderes gesagt wird. */
export const typeForDirection = (direction) => (direction === 'in' ? 'income' : 'purchase')

/**
 * Den Betrag eines Formularfelds als Minor-Units.
 *
 * Immer positiv: das Vorzeichen kommt aus der Richtung, nicht aus dem, was
 * jemand vor die Zahl getippt hat.
 *
 * @param {unknown} input
 * @returns {number|null}
 */
export function amountInputToMinor(input) {
  const value = parseNumber(input)
  if (value === null || value <= 0) return null
  const minor = Math.round(value * 100)
  // Mehr als zwei Nachkommastellen sind kein Geldbetrag. Geprüft an der Zahl
  // selbst, nicht am Text, damit auch „24,999" auffällt.
  if (Math.abs(value * 100 - minor) > 1e-6) return null
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null
  return minor
}

/**
 * Was das Formular an `finance_create_manual_transaction` schickt.
 *
 * @param {{
 *   accountId?: string|null,
 *   amountInput?: string|number,
 *   direction?: 'out'|'in',
 *   date?: string,
 *   description?: string,
 *   merchantId?: string|null,
 *   categoryId?: string|null,
 *   note?: string|null,
 *   includeInAnalytics?: boolean,
 *   currency?: string,
 * }} form
 * @returns {{ok: boolean, errors: string[], payload: object|null}}
 */
export function buildManualTransactionPayload({
  accountId = null,
  amountInput = '',
  direction = 'out',
  date = '',
  description = '',
  merchantId = null,
  categoryId = null,
  note = null,
  includeInAnalytics = true,
  currency = 'EUR',
} = {}) {
  const errors = []

  if (!accountId) errors.push('Bitte wähle ein Konto.')
  if (!ISO_DATE.test(String(date))) errors.push('Bitte wähle ein Datum.')

  const magnitude = amountInputToMinor(amountInput)
  if (magnitude === null) errors.push('Bitte gib einen Betrag größer als 0 ein.')

  const text = String(description ?? '').trim()
  if (text === '') errors.push('Bitte gib eine Beschreibung ein.')
  else if (text.length > 2000) errors.push('Die Beschreibung ist zu lang.')

  if (!DIRECTIONS.includes(direction)) errors.push('Bitte wähle Ausgabe oder Einnahme.')

  if (errors.length > 0) return { ok: false, errors, payload: null }

  const cleanNote = typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 2000) : null

  return {
    ok: true,
    errors: [],
    payload: {
      p_account_id: accountId,
      p_booking_date: date,
      p_amount_minor: direction === 'in' ? magnitude : -magnitude,
      p_currency: currency,
      p_raw_description: text,
      // An genau einer Stelle normalisiert, wie überall in diesem Modul.
      p_normalized_tokens: tokenize(text),
      p_category_id: categoryId ?? null,
      p_merchant_id: merchantId ?? null,
      p_transaction_type: typeForDirection(direction),
      p_include_in_analytics: includeInAnalytics !== false,
      p_note: cleanNote,
      p_source_metadata: { origin: 'manual', entered_via: 'finance_manual_sheet' },
    },
  }
}
