import { formatAmountMinor, formatBookingDate, plural } from '../importFlow'
import { AI_STATUS_LABELS, rowIsCorrection } from './plan'
import { REVIEW_REASONS } from './format'

// Die Worte des KI-Imports, an einer Stelle.
//
// Genau wie src/lib/finance/importFlow.js für den PDF-Import: der Plan spricht
// in `duplicate` und `category_unknown`, der Mensch liest „Bereits vorhanden"
// und „Diese Kategorie gibt es hier nicht". Die Übersetzung passiert einmal,
// hier, und die Komponente rendert, was sie bekommt.
//
// KEINE TECHNISCHE SPRACHE. Kein „JSON", kein „Parser", kein „Schema", kein
// „RPC" — nicht, weil die Wörter falsch wären, sondern weil sie in einer App
// nichts erklären, die eine Finanzübersicht sein will. Was der Nutzer sieht,
// heißt „Antwort", „Kontext" und „prüfen".

/** Warum eine Zeile geprüft werden sollte — je Grund ein Satz. */
export const REVIEW_REASON_LABELS = Object.freeze({
  [REVIEW_REASONS.MODEL_UNSURE]: 'Unsicher erkannt',
  [REVIEW_REASONS.MERCHANT_MISSING]: 'Händler nicht eindeutig',
  [REVIEW_REASONS.CATEGORY_UNKNOWN]: 'Kategorie unbekannt',
  [REVIEW_REASONS.CATEGORY_MISSING]: 'Keine Kategorie',
})

/**
 * Die Gründe einer Zeile als ein Satz, ohne Wiederholungen und in fester
 * Reihenfolge — damit dieselbe Zeile nicht heute anders klingt als morgen.
 */
export function reviewReasonText(reasons = []) {
  const order = Object.keys(REVIEW_REASON_LABELS)
  const seen = [...new Set(reasons)].filter((reason) => REVIEW_REASON_LABELS[reason])
  return seen
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((reason) => REVIEW_REASON_LABELS[reason])
    .join(' · ')
}

/** Die Zusammenfassung über dem Preview — eine Zeile je Zahl, die nicht 0 ist. */
export function aiSummaryLines(summary) {
  const lines = []
  if (summary.neu > 0) lines.push(`${plural(summary.neu, 'neuer Umsatz', 'neue Umsätze')}`)
  if (summary.vorhanden > 0) {
    lines.push(
      summary.vorhanden === 1
        ? '1 Umsatz ist bereits gespeichert'
        : `${summary.vorhanden} Umsätze sind bereits gespeichert`
    )
  }
  if (summary.pruefen > 0) {
    lines.push(
      summary.pruefen === 1 ? '1 Umsatz solltest du prüfen' : `${summary.pruefen} Umsätze solltest du prüfen`
    )
  }
  if (lines.length === 0) lines.push('Nichts Neues — alles davon ist schon gespeichert.')
  return lines
}

/** Was der Knopf verspricht. */
export function aiConfirmSentence(summary) {
  if (summary.neu === 0) return 'Es gibt nichts zu übernehmen.'
  return summary.neu === 1
    ? 'Ein neuer Umsatz wird hinzugefügt.'
    : `${summary.neu} neue Umsätze werden hinzugefügt.`
}

/** Was danach passiert ist. */
export function describeAIApplyResult(result, summary) {
  const created = Number.isFinite(result?.created) ? result.created : 0
  const lines = [
    created === 1 ? '1 Umsatz gespeichert' : `${created} Umsätze gespeichert`,
  ]
  if (summary?.vorhanden > 0) {
    lines.push(
      summary.vorhanden === 1
        ? '1 Umsatz war schon da und wurde nicht doppelt gespeichert'
        : `${summary.vorhanden} Umsätze waren schon da und wurden nicht doppelt gespeichert`
    )
  }
  return { lines, replayed: result?.replayed === true }
}

/**
 * Eine Zeile des Previews, fertig zum Rendern.
 *
 * `status` ist das, was mit der Buchung passiert; „Prüfen" ist kein eigener
 * Zustand daneben, sondern der Hinweis auf einer neuen Zeile — eine bereits
 * gespeicherte Buchung wird nicht importiert, also ist an ihr nichts zu prüfen.
 */
export function aiPreviewRow(row, categories = []) {
  const category = categories.find((c) => c.id === row.categoryId) ?? null
  const needsReview = row.status === 'new' && row.needsReview && !row.reviewed
  // Der Händler, der gilt — der des Modells, bis der Mensch ihn korrigiert hat.
  const merchant = row.merchantName || null
  return {
    index: row.index,
    title: merchant || firstLine(row.rawDescription),
    subtitle: merchant ? firstLine(row.rawDescription) : null,
    merchant,
    date: formatBookingDate(row.bookingDate),
    amount: formatAmountMinor(row.amountMinor, row.currency),
    negative: row.amountMinor < 0,
    categoryLabel: category?.label ?? null,
    status: needsReview ? AI_STATUS_LABELS.review : AI_STATUS_LABELS[row.status],
    tone: needsReview ? 'attention' : row.status === 'new' ? 'accent' : 'quiet',
    needsReview,
    reviewText: needsReview ? reviewReasonText(row.reviewReasons) : '',
    editable: row.status === 'new',
    reviewed: row.reviewed === true,
    // „geändert" und „bestätigt" sind zwei verschiedene Nachrichten an den
    // Nutzer, und die Zeile soll die richtige zeigen.
    corrected: rowIsCorrection(row),
  }
}

const firstLine = (text) => String(text ?? '').split('\n')[0]?.trim() || 'Ohne Beschreibung'
