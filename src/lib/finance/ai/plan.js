import { TRANSACTION_TYPES } from '../../../config/finance'
import { AI_IMPORT_FORMAT, AI_IMPORT_VERSION } from './format'
import { matchExisting } from './dedupe'

// Aus geprüften Zeilen wird das, was der Preview zeigt und die Datenbank
// speichert.
//
// Die Aufgabenteilung ist dieselbe wie beim DKB-Import: `validateAIImport` sagt,
// was die Zeilen sind, `matchExisting` sagt, welche es schon gibt, und dieses
// Modul setzt beides zu einem Plan zusammen, den ein Mensch ansehen und ändern
// kann. Entschieden wird hier nichts, was nicht aus den beiden folgt.
//
// KEINE ZEILE VERSCHWINDET. Jede ankommende Buchung bekommt genau eine Zeile im
// Plan, auch die bereits vorhandenen und die unsicheren. Was nicht gespeichert
// wird, wird dem Nutzer trotzdem gezeigt — ein Import, der stillschweigend
// aussortiert, ist ein Import, dem man nicht ansieht, was er weggelassen hat.

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** Die drei Zustände, die der Preview kennt. */
export const AI_ROW_STATUS = Object.freeze({
  NEW: 'new',
  DUPLICATE: 'duplicate',
})

export const AI_STATUS_LABELS = Object.freeze({
  new: 'Neu',
  duplicate: 'Bereits vorhanden',
  review: 'Prüfen',
})

/**
 * Der Plan für einen KI-Import.
 *
 * @param {{
 *   entries?: Array<object>,
 *   existing?: Array<object>,
 *   observations?: Array<object>,
 *   accountId?: string|null,
 * }} input
 * @returns {{rows: Array<object>, summary: {erkannt: number, neu: number, vorhanden: number, pruefen: number}}}
 */
export function buildAIImportPlan({ entries = [], existing = [], observations = [], accountId = null } = {}) {
  const matches = matchExisting({ entries, existing, observations, accountId })
  const byIndex = new Map(matches.map((match) => [match.index, match]))

  const rows = entries.map((entry) => {
    const existingId = byIndex.get(entry.index)?.existingId ?? null
    return {
      index: entry.index,
      status: existingId ? AI_ROW_STATUS.DUPLICATE : AI_ROW_STATUS.NEW,
      existingId,

      // Die Tatsache, unverändert. Betrag und Datum werden auf diesem ganzen Weg
      // nie angefasst — auch nicht, wenn der Nutzer die Zeile im Preview öffnet.
      bookingDate: entry.bookingDate,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      rawDescription: entry.rawDescription,
      normalizedTokens: entry.normalizedTokens,

      // Was das Modell vorgeschlagen hat, so wie es ankam. Wird nie überschrieben
      // — die Korrektur des Nutzers steht daneben, nicht darüber.
      suggestion: {
        merchantName: entry.merchantName,
        categoryId: entry.categoryId,
        categorySlug: entry.categorySlug,
        transactionType: entry.transactionType,
        includeInAnalytics: entry.includeInAnalytics,
        note: entry.note,
        needsReview: entry.needsReview,
      },

      // Was gespeichert würde, wenn jetzt importiert wird.
      //
      // `merchantName` ist ein NAME, kein Fremdschlüssel: solange der Nutzer
      // nichts korrigiert, ist es der des Modells; korrigiert er, ist es seiner.
      // `merchantId` ist nur gesetzt, wenn er einen Händler gewählt hat, den es
      // in dieser App schon gibt — und auch dann entsteht kein Muster.
      merchantId: null,
      merchantName: entry.merchantName,
      categoryId: entry.categoryId,
      transactionType: entry.transactionType,
      includeInAnalytics: entry.includeInAnalytics,
      note: entry.note,

      needsReview: entry.needsReview,
      reviewReasons: entry.reviewReasons,
      // Hat ein Mensch diese Zeile angesehen? „Angesehen" heißt hier: er hat sie
      // aufgeklappt und entweder etwas geändert oder ausdrücklich „Passt so"
      // gedrückt. Beides ist eine Prüfung; nur das erste ist eine Korrektur, und
      // rowIsCorrection() unterscheidet sie.
      reviewed: false,
    }
  })

  return { rows, summary: summarizeAIPlan(rows) }
}

/**
 * Die Zahlen über dem Preview.
 *
 * `pruefen` zählt nur unter den neuen Zeilen: eine bereits vorhandene Buchung
 * wird nicht gespeichert, also ist an ihr auch nichts mehr zu prüfen.
 */
export function summarizeAIPlan(rows = []) {
  const neu = rows.filter((row) => row.status === AI_ROW_STATUS.NEW)
  return {
    erkannt: rows.length,
    neu: neu.length,
    vorhanden: rows.length - neu.length,
    pruefen: neu.filter((row) => row.needsReview && !row.reviewed).length,
  }
}

/**
 * Eine Zeile, vom Nutzer korrigiert.
 *
 * Nur die Interpretation ist änderbar: Händler, Kategorie, Buchungsart, ob sie
 * zählt, die Notiz. Datum, Betrag, Währung und Originaltext stehen nicht in der
 * Patch-Liste und können deshalb aus dem Preview heraus nicht verändert werden —
 * dieselbe Trennung, die die Datenbank seit 0008 mit einem Trigger erzwingt.
 *
 * JEDER Aufruf markiert die Zeile als geprüft — auch der mit einem leeren Patch,
 * den „Passt so" auslöst. Das ist der Punkt: eine unsichere Zeile, die ein
 * Mensch angesehen und für richtig befunden hat, ist geprüft, auch wenn kein
 * Feld anders aussieht als vorher. Ob daraus eine KORREKTUR wird, entscheidet
 * rowIsCorrection() — und nicht dieser Aufruf.
 */
export function applyRowEdit(row, patch = {}) {
  const next = { ...row }
  // Händler: entweder einer aus der Liste (dann reist seine Id mit, damit die
  // Entscheidung auf den Eintrag zeigt) oder ein Name, den der Nutzer getippt
  // hat (dann bleibt die Id leer — ein getippter Name legt keinen Händler an).
  if ('merchantId' in patch) next.merchantId = patch.merchantId ?? null
  if ('merchantName' in patch) {
    const name = typeof patch.merchantName === 'string' ? patch.merchantName.trim() : ''
    next.merchantName = name === '' ? null : name.slice(0, 120)
    if (next.merchantName === null) next.merchantId = null
  }
  if ('categoryId' in patch) next.categoryId = patch.categoryId ?? null
  if ('transactionType' in patch && TRANSACTION_TYPES.includes(patch.transactionType)) {
    next.transactionType = patch.transactionType
  }
  if ('includeInAnalytics' in patch && typeof patch.includeInAnalytics === 'boolean') {
    next.includeInAnalytics = patch.includeInAnalytics
  }
  if ('note' in patch) {
    const note = typeof patch.note === 'string' ? patch.note.trim() : ''
    next.note = note === '' ? null : note.slice(0, 2000)
  }
  next.reviewed = true
  return next
}

/** Sieht die Zeile anders aus als der Vorschlag? Rein der Vergleich, ohne Urteil. */
export function rowDiffersFromSuggestion(row) {
  return (
    (row.merchantName ?? null) !== (row.suggestion.merchantName ?? null) ||
    (row.merchantId ?? null) !== null ||
    (row.categoryId ?? null) !== (row.suggestion.categoryId ?? null) ||
    row.transactionType !== row.suggestion.transactionType ||
    row.includeInAnalytics !== row.suggestion.includeInAnalytics ||
    (row.note ?? null) !== (row.suggestion.note ?? null)
  )
}

/**
 * Was ein Mensch mit dem Vorschlag dieser Zeile gemacht hat.
 *
 * Drei Werte, und der mittlere ist der, um den es geht:
 *
 *   'none'       niemand hat sie angesehen — sie war sicher genug
 *   'confirmed'  angesehen, für richtig befunden, kein Feld geändert
 *   'corrected'  angesehen und geändert
 *
 * WARUM NICHT EIN BOOLEAN. „Bestätigt" ist für v1.24 das wertvollste Signal
 * überhaupt: das Modell hat Unsicherheit gemeldet UND hatte recht. Ein
 * `user_edited`-Boolean könnte das nicht sagen — eine Bestätigung sähe aus wie
 * „nie angefasst", und sie trotzdem als Korrektur zu buchen hieße, v1.24
 * beizubringen, ein richtiger Vorschlag sei falsch gewesen. Das ist keine
 * Kleinigkeit: es ist genau das Gegenteil dessen, was gelernt werden soll.
 *
 * @param {object} row
 * @returns {'none'|'confirmed'|'corrected'}
 */
export function rowHumanReview(row) {
  if (!row?.reviewed) return 'none'
  return rowDiffersFromSuggestion(row) ? 'corrected' : 'confirmed'
}

/** Hat der Mensch an dieser Zeile wirklich etwas geändert? */
export const rowIsCorrection = (row) => rowHumanReview(row) === 'corrected'

/**
 * Der Payload für `finance_apply_ai_import` — nur die neuen Zeilen.
 *
 * Bereits vorhandene Buchungen werden gar nicht erst geschickt. Das ist keine
 * Abkürzung: die Wiederholungssicherheit hängt nicht daran, sondern an der
 * Import-Zeile, die die Datenbank sperrt und ein zweites Mal nicht anwendet.
 *
 * @param {{importId: string, accountId: string, rows?: Array<object>}} input
 */
export function buildAIApplyPayload({ importId, accountId, rows = [] } = {}) {
  if (!isUuid(importId)) throw new Error('Import-ID fehlt oder ist keine UUID.')
  if (!isUuid(accountId)) throw new Error('Konto-ID fehlt oder ist keine UUID.')

  const bookings = rows
    .filter((row) => row.status === AI_ROW_STATUS.NEW)
    .map((row) => {
      const review = rowHumanReview(row)
      return {
        booking_date: row.bookingDate,
        amount_minor: row.amountMinor,
        currency: row.currency,
        raw_description: row.rawDescription,
        normalized_tokens: row.normalizedTokens,
        category_id: row.categoryId ?? null,
        transaction_type: row.transactionType,
        include_in_analytics: row.includeInAnalytics,
        // Herkunft, und sonst nichts. Kein zweites Exemplar des Betrags, kein
        // Händler — der steht im Vorschlag, wo er hingehört.
        source_metadata: {
          origin: 'ai_import',
          format: AI_IMPORT_FORMAT,
          format_version: AI_IMPORT_VERSION,
          source_index: row.index,
        },
        suggestion: {
          merchant_name: row.suggestion.merchantName,
          category_id: row.suggestion.categoryId ?? null,
          transaction_type: row.suggestion.transactionType,
          include_in_analytics: row.suggestion.includeInAnalytics,
          note: row.suggestion.note,
          needs_review: row.suggestion.needsReview,
          human_review: review,
          format_version: AI_IMPORT_VERSION,
        },
        // Was der Mensch gesehen und mitgenommen hat — sobald er die Zeile
        // angesehen hat, auch wenn er nichts geändert hat. „Passt so" ist eine
        // ausdrückliche Bestätigung, und eine Bestätigung von „REWE ·
        // Lebensmittel" ist genau die Entscheidung, die den Umsatz einordnet.
        //
        // Was daraus tatsächlich gespeichert wird, entscheidet nicht dieser
        // Payload: die Datenbank schreibt einen Override nur, wenn die
        // Entscheidung etwas über die Einordnung sagt oder etwas festhält, das
        // sonst verloren ginge (siehe 0011). Eine Bestätigung von „nichts" ist
        // deshalb keine leere Zeile, sondern nur ein `human_review`.
        user_decision: review !== 'none'
          ? {
              merchant_id: row.merchantId ?? null,
              merchant_name: row.merchantName ?? null,
              category_id: row.categoryId ?? null,
              transaction_type: row.transactionType,
              include_in_analytics: row.includeInAnalytics,
              note: row.note,
            }
          : null,
      }
    })

  return { import_id: importId, account_id: accountId, bookings }
}
