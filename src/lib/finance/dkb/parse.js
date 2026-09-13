// The DKB Umsatzexport parser: PDF.js text items in, bookings out — or a
// refusal, with reasons.
//
// It is pure. It never touches pdfjs, React or Supabase; it receives a document
// that has already been extracted (see extract.js for the thin adapter that
// does that in the browser) and returns a plain result. That is what makes the
// whole thing testable against fixtures instead of against a PDF nobody may
// commit.
//
// THE RULE IT IS BUILT ON, measured rather than assumed: a booking block begins
// at an item that sits in the date column and is exactly dd.mm.yyyy, and ends
// before the next such item. On the real export that rule produced 27 blocks —
// exactly the count the document states about itself — and consumed all 147
// content items of the table with none left over.
//
// FAIL-CLOSED, AND WHOLE. Any single problem stops the entire import. There is
// no "import what we could read": a statement half-read is a spending total
// silently missing a booking, which is worse than an import that refused.
//
// WHAT IT WILL NOT DO: no OCR, no guessing at characters the file does not
// encode, no field that the document does not contain, no float anywhere near
// an amount, and no interpretation of what a booking MEANS. Recognising the
// merchant is a separate, already-tested step that runs afterwards on the
// tokens this parser produces with the module's one canonical normaliser.

import { tokenize } from '../normalize'
import {
  AMOUNT_COLUMN_PREFIX,
  AMOUNT_RIGHT_MAX,
  AMOUNT_RIGHT_MIN,
  CARD_DATE_PATTERN,
  CARD_SYSTEM_MARKER,
  CARD_TIMESTAMP_PATTERN,
  COLUMN_HEADERS,
  CONTENT_FONT_SIZE,
  DATE_PATTERN,
  DECLARED_COUNT_PATTERN,
  DOCUMENT_HEADING,
  FOOTER_FONT_SIZE,
  FOOTER_Y_MAX,
  FOREIGN_CURRENCY_MARKER,
  HEADER_GAP,
  IBAN_PATTERN,
  ISSUE_DATE_PATTERN,
  PAGE_LABEL_PATTERN,
  PERIOD_PATTERN,
  X_ADDRESS,
  X_AMOUNT_MIN,
  X_DATE,
  X_DESCRIPTION,
  X_TOLERANCE,
} from './layout'
import { parseAmountMinor, parseGermanDate } from './amount'
import { sanitizeGlyphs, unmappedGlyphWarning } from './glyphs'
import { groupIntoLines, lineText } from './lines'

/** Booking blocks that carry a card timestamp are marked — and nothing more. */
export const SOURCE_VARIANTS = ['standard', 'timestamped_card']

const fail = (code, message, extra = {}) => ({ code, message, ...extra })
const atX = (item, x) => Math.abs(item.x - x) <= X_TOLERANCE
const hasInk = (item) => item.str.trim() !== ''
const near = (value, size) => Math.abs(value - size) < 0.5

/**
 * Read one extracted document.
 *
 * @param {{pages?: Array<{number?: number, items?: Array<{str: string, x: number, y: number, width: number, fontSize: number}>}>}} doc
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{code: string, message: string}>,
 *   warnings: Array<{code: string, message: string}>,
 *   header: {period_start: string|null, period_end: string|null, declared_count: number|null,
 *            currency: string|null, page_count: number},
 *   transactions: Array<object>,
 * }}
 */
export function parseDkbUmsatzexport(doc) {
  const errors = []
  const warnings = []
  const header = {
    period_start: null,
    period_end: null,
    declared_count: null,
    currency: null,
    page_count: 0,
  }

  const rawPages = Array.isArray(doc?.pages) ? doc.pages : []
  if (rawPages.length === 0) {
    errors.push(fail('no_text_layer', 'Die Datei enthält keine lesbaren Seiten.'))
    return { ok: false, errors, warnings, header, transactions: [] }
  }
  header.page_count = rawPages.length

  // ── 1. Sanitise, and record every position the file does not encode ───────
  const pages = rawPages.map((page, index) => {
    const number = Number.isInteger(page?.number) ? page.number : index + 1
    const items = (Array.isArray(page?.items) ? page.items : []).map((item) => {
      const { text, replaced } = sanitizeGlyphs(item?.str)
      const x = Number(item?.x)
      const y = Number(item?.y)
      if (replaced > 0) {
        warnings.push(unmappedGlyphWarning({ page: number, x, y, text, replaced }))
      }
      return {
        str: text,
        x,
        y,
        width: Number(item?.width ?? 0),
        fontSize: Number(item?.fontSize ?? 0),
        unmapped: replaced,
      }
    })
    return { number, items }
  })

  // A scan, or a PDF whose text layer is an image, arrives here as pages
  // without any content. That is the one case that must never be "parsed
  // leniently" — it is rejected before anything else is attempted.
  const contentItems = pages.flatMap((page) =>
    page.items.filter((item) => hasInk(item) && near(item.fontSize, CONTENT_FONT_SIZE))
  )
  if (contentItems.length === 0) {
    errors.push(
      fail('no_text_layer', 'Die Datei hat keine auswertbare Textebene — ein Scan kann nicht importiert werden.')
    )
    return { ok: false, errors, warnings, header, transactions: [] }
  }

  // ── 2. Per page: the column header, the page label, the known header band ──
  const blocks = []
  const orphans = []

  pages.forEach((page, pageIndex) => {
    const lines = groupIntoLines(page.items)

    const headerLine = lines.find((line) =>
      COLUMN_HEADERS.every(({ label, x }) =>
        line.items.some((item) => hasInk(item) && atX(item, x) && item.str.trim() === label)
      )
    )
    if (!headerLine) {
      // Either this is not a DKB Umsatzexport, or its columns have moved. Both
      // are reasons to stop: a shifted column read as if it had not moved is
      // how an amount ends up under the wrong booking.
      errors.push(
        fail('column_header_missing', `Seite ${page.number}: die Spaltenüberschrift „Datum / Erläuterung / Betrag EUR" fehlt.`, {
          page: page.number,
        })
      )
      return
    }

    // The currency is stated once, here, and nowhere else in the document.
    const amountHeader = headerLine.items.find(
      (item) => hasInk(item) && item.str.trim().startsWith(AMOUNT_COLUMN_PREFIX)
    )
    const currency = amountHeader ? amountHeader.str.trim().slice(AMOUNT_COLUMN_PREFIX.length).trim() : ''
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push(
        fail('currency_unknown', `Seite ${page.number}: die Währung der Betragsspalte ist nicht lesbar.`, {
          page: page.number,
        })
      )
    } else if (header.currency === null) {
      header.currency = currency
    } else if (header.currency !== currency) {
      errors.push(
        fail('currency_inconsistent', `Seite ${page.number}: die Betragsspalte nennt eine andere Währung als Seite 1.`, {
          page: page.number,
        })
      )
    }

    const pageLabelItem = page.items.find(
      (item) => hasInk(item) && PAGE_LABEL_PATTERN.test(item.str.trim())
    )
    if (!pageLabelItem) {
      errors.push(fail('page_label_missing', `Seite ${page.number}: die Seitenangabe „Seite k von n" fehlt.`, { page: page.number }))
    } else {
      const [, current, total] = PAGE_LABEL_PATTERN.exec(pageLabelItem.str.trim())
      if (Number(current) !== pageIndex + 1 || Number(total) !== pages.length) {
        errors.push(
          fail('page_sequence_invalid',
            `Seite ${page.number}: die Datei nennt sich „Seite ${current} von ${total}", ` +
            `gelesen wurde Seite ${pageIndex + 1} von ${pages.length}.`,
            { page: page.number })
        )
      }
    }

    // ── the band the table lives in ──
    const bandTop = headerLine.y - HEADER_GAP
    const inBand = (item) => item.y < bandTop && item.y > FOOTER_Y_MAX

    // ── everything above the table: known header shapes only ──
    for (const item of page.items) {
      if (!hasInk(item)) continue
      if (near(item.fontSize, FOOTER_FONT_SIZE)) {
        // The DKB legal footer. Known, repeated identically on every page, and
        // deliberately discarded — but only where it belongs.
        if (item.y > FOOTER_Y_MAX) {
          orphans.push({ page: page.number, item, where: 'Fußzeilentext oberhalb der Fußzeile' })
        }
        continue
      }
      if (item === pageLabelItem) continue
      if (item.y >= bandTop) {
        if (headerLine.items.includes(item)) continue
        const text = item.str.trim()
        if (atX(item, X_ADDRESS)) continue // Anschrift, „Auszug", IBAN des Kontos
        if (ISSUE_DATE_PATTERN.test(text)) continue
        const countMatch = DECLARED_COUNT_PATTERN.exec(text)
        if (countMatch) {
          header.declared_count = Number(countMatch[1])
          continue
        }
        const periodMatch = PERIOD_PATTERN.exec(text)
        if (periodMatch) {
          header.period_start = parseGermanDate(periodMatch[1])
          header.period_end = parseGermanDate(periodMatch[2])
          continue
        }
        orphans.push({ page: page.number, item, where: 'Kopfbereich' })
      }
    }

    // ── the blocks of this page ──
    const bandLines = lines.filter((line) => line.y < bandTop && line.y > FOOTER_Y_MAX)
    const anchorIndices = []
    bandLines.forEach((line, index) => {
      const isAnchor = line.items.some(
        (item) => hasInk(item) && atX(item, X_DATE) && DATE_PATTERN.test(item.str.trim())
      )
      if (isAnchor) anchorIndices.push(index)
    })

    // Content in the table band that sits above the first booking has no block
    // to belong to. Rather than ignoring it, it is reported.
    const firstAnchor = anchorIndices.length > 0 ? anchorIndices[0] : bandLines.length
    for (const line of bandLines.slice(0, firstAnchor)) {
      for (const item of line.items) {
        if (hasInk(item)) orphans.push({ page: page.number, item, where: 'Tabellenbereich ohne Buchung' })
      }
    }

    anchorIndices.forEach((start, position) => {
      const end = position + 1 < anchorIndices.length ? anchorIndices[position + 1] : bandLines.length
      blocks.push({
        page: page.number,
        lines: bandLines.slice(start, end),
        inBand,
      })
    })
  })

  // ── 3. Each block: one date, one amount, at least one description line ────
  const parsedBlocks = blocks.map((block, index) => {
    const [anchor, ...rest] = block.lines
    const result = {
      page: block.page,
      index,
      y: anchor.y,
      date: null,
      amountText: null,
      lines: [],
      unmapped: 0,
    }

    const dateItems = anchor.items.filter((item) => hasInk(item) && atX(item, X_DATE))
    if (dateItems.length !== 1 || !DATE_PATTERN.test(dateItems[0].str.trim())) {
      errors.push(
        fail('block_date_invalid', `Seite ${block.page}: eine Buchung hat kein eindeutiges Buchungsdatum.`, {
          page: block.page,
          y: anchor.y,
        })
      )
    } else {
      const iso = parseGermanDate(dateItems[0].str.trim())
      if (iso === null) {
        errors.push(
          fail('block_date_invalid', `Seite ${block.page}: „${dateItems[0].str.trim()}" ist kein gültiges Datum.`, {
            page: block.page,
            y: anchor.y,
          })
        )
      } else {
        result.date = iso
      }
    }

    const amountItems = anchor.items.filter((item) => hasInk(item) && item.x >= X_AMOUNT_MIN)
    if (amountItems.length !== 1) {
      errors.push(
        fail(amountItems.length === 0 ? 'block_amount_missing' : 'block_amount_ambiguous',
          `Seite ${block.page}: eine Buchung hat ${amountItems.length === 0 ? 'keinen' : 'mehr als einen'} Betrag.`,
          { page: block.page, y: anchor.y })
      )
    } else {
      const item = amountItems[0]
      const rightEdge = item.x + item.width
      if (rightEdge < AMOUNT_RIGHT_MIN || rightEdge > AMOUNT_RIGHT_MAX) {
        // The amount column is right aligned; an amount whose right edge is not
        // where the column ends is not an amount of this column.
        errors.push(
          fail('amount_column_misaligned',
            `Seite ${block.page}: ein Betrag steht nicht in der Betragsspalte (rechte Kante ${rightEdge.toFixed(2)}).`,
            { page: block.page, y: anchor.y })
        )
      } else {
        result.amountText = item.str.trim()
      }
    }

    // Description lines, verbatim: everything between the description column
    // and the amount column, every line of the block, spacing items included.
    for (const line of block.lines) {
      const text = lineText(line, { from: X_DESCRIPTION - X_TOLERANCE, to: X_AMOUNT_MIN })
      if (text.trim() !== '') result.lines.push(text)
    }
    if (result.lines.length === 0) {
      errors.push(
        fail('block_description_missing', `Seite ${block.page}: eine Buchung hat keinen Buchungstext.`, {
          page: block.page,
          y: anchor.y,
        })
      )
    }

    // Nothing may fall between the columns, and nothing may sit in the date or
    // amount column of a continuation line.
    block.lines.forEach((line, lineIndex) => {
      for (const item of line.items) {
        if (!hasInk(item)) continue
        result.unmapped += item.unmapped
        const isDate = lineIndex === 0 && atX(item, X_DATE)
        const isAmount = lineIndex === 0 && item.x >= X_AMOUNT_MIN
        const isDescription = item.x >= X_DESCRIPTION - X_TOLERANCE && item.x < X_AMOUNT_MIN
        if (!isDate && !isAmount && !isDescription) {
          orphans.push({ page: block.page, item, where: 'Buchungsblock' })
        }
      }
    })

    return result
  })

  for (const orphan of orphans) {
    errors.push(
      fail('orphan_item',
        `Seite ${orphan.page}: „${orphan.item.str.trim()}" (x ${orphan.item.x}, y ${orphan.item.y}) ` +
        `konnte im ${orphan.where} keiner Buchung zugeordnet werden.`,
        { page: orphan.page, x: orphan.item.x, y: orphan.item.y })
    )
  }

  // ── 4. The document's statements about itself ─────────────────────────────
  if (!contentItems.some((item) => item.str.trim() === DOCUMENT_HEADING)) {
    errors.push(
      fail('document_not_recognised', 'Die Datei ist kein DKB-Umsatzexport (die Überschrift „Auszug" fehlt).')
    )
  }
  if (header.declared_count === null) {
    errors.push(fail('declared_count_missing', 'Der Kontrollwert „Anzahl der Transaktionen" fehlt.'))
  } else if (header.declared_count !== parsedBlocks.length) {
    // This is the check that replaces the balance reconciliation the document
    // does not offer — and it is the stricter one: it counts records, where a
    // sum could coincidentally balance out across wrongly split blocks.
    errors.push(
      fail('count_mismatch',
        `Die Datei nennt ${header.declared_count} Transaktionen, erkannt wurden ${parsedBlocks.length}.`)
    )
  }
  if (header.period_start === null || header.period_end === null) {
    errors.push(fail('period_missing', 'Der Zeitraum des Auszugs fehlt oder ist unlesbar.'))
  } else if (header.period_start > header.period_end) {
    errors.push(fail('period_invalid', 'Der Zeitraum des Auszugs endet vor seinem Beginn.'))
  }

  // ── 5. Amounts, dates, order ──────────────────────────────────────────────
  const transactions = []
  for (const block of parsedBlocks) {
    if (block.date === null || block.amountText === null || block.lines.length === 0) continue

    const amount = parseAmountMinor(block.amountText)
    if (!amount.ok) {
      errors.push(
        fail(amount.reason,
          amount.reason === 'amount_format_unknown'
            ? `Seite ${block.page}: „${block.amountText}" ist kein bekanntes Betragsformat. ` +
              'Vierstellige Beträge sind bislang durch keinen echten Auszug belegt und werden nicht geraten.'
            : `Seite ${block.page}: „${block.amountText}" liegt außerhalb des darstellbaren Bereichs.`,
          { page: block.page, y: block.y })
      )
      continue
    }

    if (
      header.period_start !== null &&
      header.period_end !== null &&
      (block.date < header.period_start || block.date > header.period_end)
    ) {
      errors.push(
        fail('date_out_of_period',
          `Seite ${block.page}: die Buchung vom ${block.date} liegt außerhalb des Zeitraums ` +
          `${header.period_start} bis ${header.period_end}.`,
          { page: block.page, y: block.y })
      )
      continue
    }

    const rawDescription = block.lines.join('\n')
    const variant =
      CARD_TIMESTAMP_PATTERN.test(rawDescription) && rawDescription.includes(CARD_SYSTEM_MARKER)
        ? 'timestamped_card'
        : 'standard'
    const timestamp = CARD_TIMESTAMP_PATTERN.exec(rawDescription)
    const cardDate = CARD_DATE_PATTERN.exec(rawDescription)

    transactions.push({
      booking_date: block.date,
      // Not "not implemented": the document has no Wertstellung, and the card's
      // own transaction date is a different fact than the bank's value date.
      value_date: null,
      amount_minor: amount.minor,
      currency: header.currency,
      raw_description: rawDescription,
      normalized_tokens: tokenize(rawDescription),
      source_variant: variant,
      source_metadata: {
        page: block.page,
        block_index: block.index,
        y: block.y,
        line_count: block.lines.length,
        amount_text: block.amountText,
        // Verbatim substrings, extracted but not interpreted: they exist for
        // the preview and for the later dedupe decision, and none of them is
        // promoted to a column of its own.
        card_timestamp: timestamp ? timestamp[0] : null,
        card_transaction_date: cardDate ? parseGermanDate(cardDate[1]) : null,
        foreign_currency: rawDescription.includes(FOREIGN_CURRENCY_MARKER),
        has_iban_line: block.lines.some((line) => IBAN_PATTERN.test(line.replace(/^IBAN /, ''))),
        unmapped_glyphs: block.unmapped,
      },
    })
  }

  // The whole document is sorted by booking date in one direction. A block
  // boundary that was placed wrongly shows up here as a date that breaks the
  // run — a cheap check against a failure mode the count alone would miss when
  // two errors cancel out.
  const order = transactions.map((t) => t.booking_date)
  const nonIncreasing = order.every((value, i) => i === 0 || value <= order[i - 1])
  const nonDecreasing = order.every((value, i) => i === 0 || value >= order[i - 1])
  if (order.length > 1 && !nonIncreasing && !nonDecreasing) {
    errors.push(
      fail('date_order_not_monotonic',
        'Die Buchungsdaten sind nicht durchgehend sortiert — vermutlich wurde eine Blockgrenze falsch erkannt.')
    )
  }

  // Say which warnings actually reach the data. The real export raises three of
  // its five unmapped-glyph warnings inside the bank's own address in the page
  // footer — text that is discarded and never becomes a booking. Keeping those
  // warnings is right (they are true), presenting them to the user as a problem
  // with their statement is not, so each one says where it landed.
  const bookingLineKeys = new Set(
    blocks.flatMap((block) => block.lines.map((line) => `${block.page}|${line.y}`))
  )
  for (const warning of warnings) {
    warning.in_transaction = bookingLineKeys.has(`${warning.page}|${warning.y}`)
  }

  const ok = errors.length === 0
  return { ok, errors, warnings, header, transactions: ok ? transactions : [] }
}
