import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from '../../../config/finance'
import { AI_CSV_COLUMNS } from './format'

// Das sichtbare Format: eine Zeile je Buchung, Semikolon dazwischen.
//
// WARUM NICHT JSON. Was ChatGPT ausgibt, wandert durch eine Zwischenablage und
// landet in einem Textfeld, in dem ein Mensch es sieht. Eine Tabelle kann man
// überfliegen — zehn Zeilen, zehn Beträge, stimmt das? Ein JSON-Baum mit
// geschweiften Klammern kann man nur glauben. Und ein Modell, das eine Klammer
// vergisst, macht die ganze Antwort unlesbar; eines, das eine Tabellenzeile
// verhaut, macht genau eine Zeile kaputt, und der Parser sagt, welche.
//
// WAS DIESE DATEI NICHT TUT: sie erzeugt kein zweites Importmodell. Sie liest
// die Tabelle und baut daraus exakt dieselben Datensätze, die auch aus dem
// JSON-Weg fallen — und ab da ist alles danach identisch: dieselbe Prüfung,
// derselbe kontobezogene Abgleich, derselbe Preview, dieselbe Datenbankfunktion.
// Es gibt nur einen Importer, und er hat zwei Eingänge.
//
// Pur, ohne React und ohne Supabase (siehe tools/financeAiLogic.mjs).

const error = (code, message) => ({ code, message })

/** Umlaute und Groß-/Kleinschreibung weg — nur zum VERGLEICHEN von Spaltennamen. */
const foldHeader = (value) =>
  String(value ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')

const FOLDED_COLUMNS = AI_CSV_COLUMNS.map(foldHeader)

/**
 * Eine Zeile in ihre Felder, mit Anführungszeichen wie in jeder CSV der Welt.
 *
 * Steht in einem Text ein Semikolon, gehört das Feld in "Anführungszeichen",
 * und ein Anführungszeichen darin wird verdoppelt. Der Prompt sagt dem Modell,
 * es soll Semikolons in Texten gar nicht erst verwenden — aber ein Parser, der
 * sich darauf verlässt, zerlegt eines Tages eine Buchung in zwei.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitSemicolonLine(line) {
  const fields = []
  let field = ''
  let quoted = false
  let i = 0
  const text = String(line ?? '')

  while (i < text.length) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }
    if (char === '"' && field.trim() === '') {
      // Nur am Feldanfang. Ein Anführungszeichen mitten im Text ist Text.
      field = ''
      quoted = true
      i += 1
      continue
    }
    if (char === ';') {
      fields.push(field.trim())
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }
  fields.push(field.trim())
  return fields
}

/**
 * Ein Geldbetrag, wie ein Mensch ihn schreibt → die kanonische Form mit Punkt.
 *
 * Gibt einen STRING zurück, keine Zahl: von hier bis in die Spalte
 * `amount_minor` soll kein Float entstehen, und `amountToMinor` rechnet die
 * Textform mit ganzen Zahlen exakt aus.
 *
 * WAS ERLAUBT IST: „-24,95", „-24.95", „1.234,56", „1,234.56", „1234", ein
 * typografisches Minus, ein führendes Plus, Leerzeichen.
 *
 * WAS BEWUSST ABGELEHNT WIRD: „1.234". Ein einzelnes Trennzeichen mit genau
 * drei Ziffern dahinter kann 1234 oder 1,234 bedeuten, und das ist der einzige
 * Fall, in dem Raten den Betrag um Faktor tausend verfehlt. Lieber eine
 * Fehlermeldung, die der Nutzer in zehn Sekunden behebt, als eine Zahl, die
 * niemand mehr nachrechnet. Der Prompt verbietet Tausenderzeichen deshalb
 * ausdrücklich.
 *
 * @param {unknown} raw
 * @returns {string|null} z. B. "-24.95", oder null
 */
export function germanAmountToCanonical(raw) {
  if (typeof raw !== 'string') return null
  let text = raw.replace(/\s/g, '').replace(/−/g, '-')
  if (text === '') return null
  let negative = false
  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  if (!/^[\d.,]+$/.test(text)) return null

  const dots = (text.match(/\./g) ?? []).length
  const commas = (text.match(/,/g) ?? []).length

  let whole = text
  let fraction = ''

  if (dots > 0 && commas > 0) {
    // Zwei verschiedene Trennzeichen: das letzte ist das Dezimaltrennzeichen,
    // das andere gruppiert Tausender. Eindeutig, ohne Raten.
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ','
    const grouping = decimal === '.' ? ',' : '.'
    const cut = text.lastIndexOf(decimal)
    const groups = text.slice(0, cut).split(grouping)
    // Gruppen müssen Tausendergruppen sein: die erste ein bis drei Ziffern, jede
    // weitere genau drei. „1.23,45" ist keine Zahl, die jemand so meint — und
    // stillschweigend als 123,45 zu lesen wäre wieder Raten.
    if (groups.slice(1).some((group) => group.length !== 3)) return null
    if (groups[0].length < 1 || groups[0].length > 3) return null
    whole = groups.join('')
    fraction = text.slice(cut + 1)
    if (whole.includes('.') || whole.includes(',')) return null
  } else if (dots + commas === 1) {
    const separator = dots === 1 ? '.' : ','
    const [left, right] = text.split(separator)
    if (right.length === 3) return null // 1.234 — siehe oben
    if (right.length < 1 || right.length > 2) return null
    whole = left
    fraction = right
  } else if (dots + commas > 1) {
    // Nur eine Sorte, mehrfach: Tausendergruppen, jede genau drei Ziffern.
    const separator = dots > 0 ? '.' : ','
    const groups = text.split(separator)
    if (groups.slice(1).some((group) => group.length !== 3)) return null
    whole = groups.join('')
  }

  if (!/^\d+$/.test(whole)) return null
  if (fraction !== '' && !/^\d{1,2}$/.test(fraction)) return null
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** true / false, ja / nein, 1 / 0 — oder „das ist keine Antwort auf die Frage". */
function readBoolean(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '') return fallback
  if (['true', 'ja', 'j', '1', 'wahr', 'yes', 'x'].includes(text)) return true
  if (['false', 'nein', 'n', '0', 'falsch', 'no'].includes(text)) return false
  return undefined
}

/** Der technische Wert einer Buchungsart — der Slug selbst oder sein deutscher Name. */
function readType(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  if (TRANSACTION_TYPES.includes(text.toLowerCase())) return text.toLowerCase()
  const byLabel = TRANSACTION_TYPES.find(
    (type) => TRANSACTION_TYPE_LABELS[type].toLowerCase() === text.toLowerCase()
  )
  // Unbekannt bleibt unbekannt und wandert unverändert weiter: die Prüfung
  // meldet es mit genau dem Wort, das dastand.
  return byLabel ?? text
}

const emptyToNull = (value) => {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/**
 * Die Tabelle lesen.
 *
 * @param {string} text der eingefügte Text, Codeblock schon entfernt
 * @returns {{ok: boolean, records: Array<object>, errors: Array<{code: string, message: string}>}}
 */
export function parseSemicolonTable(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => isHeader(line))

  if (headerIndex === -1) {
    return {
      ok: false,
      records: [],
      errors: [
        error(
          'header_missing',
          `Die Antwort beginnt nicht mit der erwarteten Kopfzeile. Sie muss lauten: ${AI_CSV_COLUMNS.join(';')}`
        ),
      ],
    }
  }

  const errors = []
  const records = []
  let position = 0

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    position += 1

    const fields = splitSemicolonLine(line)
    if (fields.length !== AI_CSV_COLUMNS.length) {
      errors.push(
        error(
          fields.length > AI_CSV_COLUMNS.length ? 'row_too_many_fields' : 'row_too_few_fields',
          fields.length > AI_CSV_COLUMNS.length
            ? `Umsatz ${position} hat ${fields.length} Felder statt ${AI_CSV_COLUMNS.length} — steht in einem Text ein Semikolon?`
            : `Umsatz ${position} hat nur ${fields.length} Felder statt ${AI_CSV_COLUMNS.length}.`
        )
      )
      continue
    }

    const [datum, beschreibung, betrag, waehrung, haendler, kategorie, typ, auswertung, notiz, pruefen] =
      fields

    const include = readBoolean(auswertung, true)
    if (include === undefined) {
      errors.push(
        error('analytics_invalid', `Umsatz ${position}: „Auswertung" muss true oder false sein („${auswertung}").`)
      )
      continue
    }
    const review = readBoolean(pruefen, false)
    if (review === undefined) {
      errors.push(
        error('review_invalid', `Umsatz ${position}: „Prüfen" muss true oder false sein („${pruefen}").`)
      )
      continue
    }

    records.push({
      booking_date: datum,
      // Gelingt die Umrechnung nicht, geht der Text UNVERÄNDERT weiter. Die
      // Prüfung meldet ihn dann mit genau dem Wortlaut, den das Modell schrieb —
      // statt dass hier eine zweite, andere Fehlermeldung entsteht.
      amount: germanAmountToCanonical(betrag) ?? betrag,
      currency: waehrung,
      raw_description: beschreibung,
      merchant: emptyToNull(haendler),
      category: emptyToNull(kategorie),
      transaction_type: readType(typ),
      include_in_analytics: include,
      note: emptyToNull(notiz),
      needs_review: review,
    })
  }

  if (records.length === 0 && errors.length === 0) {
    return {
      ok: false,
      records: [],
      errors: [
        error(
          'rows_missing',
          'Unter der Kopfzeile steht keine einzige Buchung. Hat ChatGPT den Auszug wirklich gelesen?'
        ),
      ],
    }
  }

  return { ok: errors.length === 0, records: errors.length === 0 ? records : [], errors }
}

/** Ist das die Kopfzeile — Umlaute, Groß-/Kleinschreibung und ein Semikolon am Ende egal? */
function isHeader(line) {
  const text = String(line ?? '').trim().replace(/;+$/, '')
  if (text === '') return false
  const fields = splitSemicolonLine(text).map(foldHeader)
  if (fields.length !== FOLDED_COLUMNS.length) return false
  return fields.every((field, i) => field === FOLDED_COLUMNS[i])
}

/** Sieht dieser Text nach der Tabelle aus? Für die Weiche in parseAIImport. */
export const looksLikeSemicolonTable = (text) =>
  String(text ?? '').split(/\r?\n/).some((line) => isHeader(line))
