import { TRANSACTION_TYPES } from '../../../config/finance'
import { tokenize } from '../normalize'
import { AI_IMPORT_FORMAT, AI_IMPORT_VERSION, REVIEW_REASONS } from './format'
import { looksLikeSemicolonTable, parseSemicolonTable } from './semicolon'

// Vom eingefügten Text zu geprüften Zeilen — oder zu einer Fehlermeldung.
//
// ZWEI EINGÄNGE, EIN MODELL. Seit v1.23 ist das sichtbare Format eine Tabelle
// mit Semikolons (src/lib/finance/ai/semicolon.js); das JSON aus der ersten
// Fassung bleibt als kompatibler Nebeneingang bestehen, weil ein Nutzer den
// Kontext vielleicht vor Wochen kopiert hat. Beide Wege enden in EXAKT
// denselben Datensätzen, und ab `validateAIImport` gibt es keinen Unterschied
// mehr — keine zweite Prüfung, kein zweiter Abgleich, keine zweite
// Datenbankfunktion. Es gibt einen Importer mit zwei Türen.
//
// ZWEI SCHRITTE, UND SIE SIND ABSICHTLICH GETRENNT:
//
//   parseAIImport    liest Text und gibt die Datensätze zurück (oder sagt, warum
//                    nicht). Kennt keine Kategorien, keine Konten, keine
//                    Datenbank — nur Form und Version.
//   validateAIImport prüft die Buchungen gegen das, was in dieser App
//                    existiert: die Kategorien des Nutzers, die erlaubten
//                    Buchungsarten, die Regeln des Formats.
//
// Der Grund für den Schnitt ist die Fehlermeldung. „Das ist kein gültiges JSON"
// und „Zeile 4 hat keinen Betrag" sind zwei völlig verschiedene Probleme mit
// zwei völlig verschiedenen Lösungen, und ein Parser, der beide in denselben
// Topf wirft, kann dem Nutzer keines von beiden erklären.
//
// STRENG HEISST: NICHTS RATEN. Betrag und Datum werden nie stillschweigend
// korrigiert — eine Zeile ohne Betrag ist ein Fehler, keine Zeile mit Betrag 0.
// Eine Kategorie, die es nicht gibt, wird nicht auf die ähnlichste abgebildet,
// sondern auf null, und die Zeile wandert in die Prüfung. Der Unterschied
// zwischen „ich weiß es nicht" und „ich rate" ist der ganze Punkt dieses Moduls.
//
// Pur und ohne React/Supabase — siehe tools/financeAiLogic.mjs.

/** Ein Fehler, wie ihn der DKB-Parser auch schreibt: Code plus deutscher Satz. */
const error = (code, message) => ({ code, message })

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CURRENCY = /^[A-Z]{3}$/
// Ein Dezimalbetrag als Text, mit höchstens zwei Nachkommastellen. Vorzeichen
// vorne, weil eine Ausgabe negativ ist.
const DECIMAL_TEXT = /^-?\d+(\.\d{1,2})?$/

/** Höchstwert, den `finance_transactions.amount_minor` exakt zurückgeben kann. */
const MAX_AMOUNT_MINOR = 9007199254740991

/**
 * Ist das ein Datum, das es wirklich gibt? `2026-02-30` passt auf das Muster
 * und existiert nicht — und ein Datum, das die Datenbank ablehnt, soll hier
 * auffallen und nicht dort.
 */
function isRealDate(iso) {
  const match = ISO_DATE.exec(iso)
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  )
}

/**
 * Ein Betrag in Minor-Units, exakt.
 *
 * Zwei Formen werden akzeptiert, weil beide vorkommen: JSON-Zahl (`-24.95`) und
 * JSON-String (`"-24.95"`). Der String ist der genauere Weg — er wird als Text
 * zerlegt und mit ganzen Zahlen gerechnet, ohne dass je ein Float entsteht. Bei
 * der Zahl bleibt nur das Runden, und das ist für zwei Nachkommastellen exakt;
 * geprüft wird trotzdem, dass die Zahl nicht mehr Stellen hatte, als ein
 * Geldbetrag haben darf.
 *
 * @param {unknown} value
 * @returns {number|null} Minor-Units oder null, wenn es kein Betrag ist
 */
export function amountToMinor(value) {
  if (typeof value === 'string') {
    const text = value.trim().replace(/\s/g, '')
    if (!DECIMAL_TEXT.test(text)) return null
    const negative = text.startsWith('-')
    const [whole, fraction = ''] = text.replace('-', '').split('.')
    const cents = Number(`${fraction}00`.slice(0, 2))
    const minor = Number(whole) * 100 + cents
    if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT_MINOR) return null
    return negative ? -minor : minor
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const scaled = value * 100
  // Mehr als zwei Nachkommastellen ist kein Betrag, sondern eine Rechnung, die
  // jemand nicht zu Ende geführt hat. 1e-6 ist die Toleranz für die Ungenauigkeit
  // der Multiplikation selbst, nicht für eine dritte Stelle.
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null
  const minor = Math.round(scaled)
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT_MINOR) return null
  return minor
}

/**
 * Den eingefügten Text lesen — Tabelle oder JSON.
 *
 * WAS TOLERIERT WIRD, und warum es kein Raten ist: ChatGPT rahmt seine Antwort
 * oft in einen Markdown-Codeblock und schreibt gelegentlich einen Satz davor
 * („Hier ist die Tabelle:"). Beides ist Verpackung, kein Inhalt — sie zu
 * entfernen ändert an keiner einzigen Buchung etwas. Alles andere ist ein
 * Fehler.
 *
 * `format` sagt, welche Tür benutzt wurde. Kein Aufrufer muss das wissen; es
 * steht da, damit ein Test beweisen kann, dass beide Türen in denselben Raum
 * führen.
 *
 * @param {unknown} text
 * @returns {{ok: boolean, payload: object|null, format: string|null, errors: Array<{code: string, message: string}>}}
 */
export function parseAIImport(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, payload: null, format: null, errors: [error('empty', 'Es wurde nichts eingefügt.')] }
  }

  const unwrapped = stripCodeFence(text)

  // Die Weiche. Das JSON erkennt man an seiner Klammer oder an seinem
  // Formatnamen; alles andere wird als Tabelle gelesen — auch kaputter Text,
  // damit die Fehlermeldung von der Kopfzeile handelt und nicht von einer
  // geschweiften Klammer, die nie jemand tippen wollte.
  const trimmed = unwrapped.trim()
  const looksJson =
    trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes(AI_IMPORT_FORMAT)
  if (!looksJson || looksLikeSemicolonTable(unwrapped)) {
    const table = parseSemicolonTable(unwrapped)
    if (!table.ok) return { ok: false, payload: null, format: 'semicolon', errors: table.errors }
    return {
      ok: true,
      format: 'semicolon',
      payload: {
        format: AI_IMPORT_FORMAT,
        version: AI_IMPORT_VERSION,
        transactions: table.records,
      },
      errors: [],
    }
  }

  const parsed = readJson(unwrapped)
  if (parsed === undefined) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [
        error(
          'not_json',
          'Der eingefügte Text ist keine gültige Antwort. Kopiere die Antwort aus ChatGPT noch einmal vollständig — vom ersten bis zum letzten Zeichen.'
        ),
      ],
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [error('not_an_object', 'Die Antwort hat nicht die erwartete Form.')],
    }
  }

  if (parsed.format !== AI_IMPORT_FORMAT) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [
        error(
          'format_unknown',
          'Diese Antwort stammt nicht aus dem kopierten Kontext. Füge den Kontext in ChatGPT erneut ein und kopiere die Antwort danach noch einmal.'
        ),
      ],
    }
  }
  if (parsed.version !== AI_IMPORT_VERSION) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [
        error(
          'version_unsupported',
          `Diese Antwort ist in Version ${String(parsed.version)} geschrieben, diese App liest Version ${AI_IMPORT_VERSION}. Kopiere den Kontext neu und versuche es noch einmal.`
        ),
      ],
    }
  }
  if (!Array.isArray(parsed.transactions)) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [error('transactions_missing', 'In der Antwort fehlen die Umsätze.')],
    }
  }
  if (parsed.transactions.length === 0) {
    return {
      ok: false,
      payload: null,
      format: 'json',
      errors: [
        error(
          'transactions_empty',
          'Die Antwort enthält keine Umsätze. Hat ChatGPT den Auszug wirklich gelesen?'
        ),
      ],
    }
  }

  return { ok: true, payload: parsed, format: 'json', errors: [] }
}

/** ```csv … ``` und „Hier ist die Tabelle:" — Verpackung, kein Inhalt. */
function stripCodeFence(text) {
  const trimmed = text.trim()
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

/** JSON.parse, und ein zweiter Versuch auf dem äußersten Objekt im Text. */
function readJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

/**
 * Die Buchungen des Umschlags gegen diese App prüfen.
 *
 * @param {object} payload            das Ergebnis von parseAIImport
 * @param {{categories?: Array<{id: string, slug: string, label: string}>}} context
 * @returns {{ok: boolean, entries: Array<object>, errors: Array<object>}}
 */
export function validateAIImport(payload, { categories = [] } = {}) {
  const list = Array.isArray(payload?.transactions) ? payload.transactions : []
  const bySlug = new Map(categories.filter((c) => c?.slug).map((c) => [c.slug, c]))

  const errors = []
  const entries = []

  list.forEach((record, index) => {
    // Die Zeilennummer, die der Nutzer sieht, ist eins-basiert — er zählt
    // Buchungen, nicht Array-Indizes.
    const at = index + 1
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(error('row_not_an_object', `Umsatz ${at} hat nicht die erwartete Form.`))
      return
    }

    const bookingDate = typeof record.booking_date === 'string' ? record.booking_date.trim() : ''
    if (bookingDate === '') {
      errors.push(error('date_missing', `Umsatz ${at} hat kein Datum.`))
      return
    }
    if (!isRealDate(bookingDate)) {
      errors.push(
        error('date_invalid', `Umsatz ${at} hat kein gültiges Datum („${bookingDate}").`)
      )
      return
    }

    if (record.amount === undefined || record.amount === null) {
      errors.push(error('amount_missing', `Umsatz ${at} hat keinen Betrag.`))
      return
    }
    const amountMinor = amountToMinor(record.amount)
    if (amountMinor === null) {
      errors.push(
        error(
          'amount_invalid',
          `Umsatz ${at} hat keinen lesbaren Betrag („${String(record.amount)}"). Erwartet wird z. B. -24,95 — Ausgaben negativ, höchstens zwei Nachkommastellen, keine Tausenderzeichen.`
        )
      )
      return
    }

    const currency = typeof record.currency === 'string' ? record.currency.trim().toUpperCase() : ''
    if (currency === '') {
      errors.push(error('currency_missing', `Umsatz ${at} nennt keine Währung.`))
      return
    }
    if (!CURRENCY.test(currency)) {
      errors.push(error('currency_invalid', `Umsatz ${at} nennt keine gültige Währung („${currency}").`))
      return
    }

    const rawDescription =
      typeof record.raw_description === 'string' ? record.raw_description.trim() : ''
    if (rawDescription === '') {
      errors.push(error('description_missing', `Umsatz ${at} hat keine Beschreibung.`))
      return
    }
    if (rawDescription.length > 2000) {
      errors.push(error('description_too_long', `Die Beschreibung von Umsatz ${at} ist zu lang.`))
      return
    }

    // Ab hier wird nichts mehr abgelehnt. Was unklar ist, wandert in die Prüfung
    // — „keine Buchung still verwerfen" gilt genauso für ein Feld.
    const reviewReasons = []

    let merchantName =
      typeof record.merchant === 'string' && record.merchant.trim() !== ''
        ? record.merchant.trim().slice(0, 120)
        : null
    if (merchantName === null) reviewReasons.push(REVIEW_REASONS.MERCHANT_MISSING)

    let categorySlug = null
    let categoryId = null
    if (typeof record.category === 'string' && record.category.trim() !== '') {
      const slug = record.category.trim().toLowerCase()
      const known = bySlug.get(slug)
      if (known) {
        categorySlug = known.slug
        categoryId = known.id ?? null
      } else {
        // Eine erfundene Kategorie wird nicht auf die ähnlichste abgebildet.
        reviewReasons.push(REVIEW_REASONS.CATEGORY_UNKNOWN)
      }
    } else {
      reviewReasons.push(REVIEW_REASONS.CATEGORY_MISSING)
    }

    let transactionType = null
    if (record.transaction_type === undefined || record.transaction_type === null) {
      transactionType = defaultTypeFor(amountMinor)
    } else if (
      typeof record.transaction_type === 'string' &&
      TRANSACTION_TYPES.includes(record.transaction_type)
    ) {
      transactionType = record.transaction_type
    } else {
      errors.push(
        error(
          'type_unknown',
          `Umsatz ${at} nennt eine unbekannte Buchungsart („${String(record.transaction_type)}").`
        )
      )
      return
    }

    const includeInAnalytics =
      typeof record.include_in_analytics === 'boolean' ? record.include_in_analytics : true

    const note =
      typeof record.note === 'string' && record.note.trim() !== ''
        ? record.note.trim().slice(0, 2000)
        : null

    if (record.needs_review === true) reviewReasons.push(REVIEW_REASONS.MODEL_UNSURE)

    entries.push({
      index,
      bookingDate,
      amountMinor,
      currency,
      rawDescription,
      normalizedTokens: tokenize(rawDescription),
      merchantName,
      categorySlug,
      categoryId,
      transactionType,
      includeInAnalytics,
      note,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    })
  })

  return { ok: errors.length === 0, entries: errors.length === 0 ? entries : [], errors }
}

/**
 * Die Buchungsart, wenn das Modell keine nennt.
 *
 * Abgeleitet allein aus dem Vorzeichen, das die Quelle selbst angibt — nichts
 * wird dabei am Betrag geändert und nichts interpretiert, was nicht dasteht.
 * Geld raus ist ein Kauf, Geld rein eine Einnahme; alles andere kann der Nutzer
 * korrigieren.
 */
function defaultTypeFor(amountMinor) {
  if (amountMinor < 0) return 'purchase'
  if (amountMinor > 0) return 'income'
  return 'other'
}
