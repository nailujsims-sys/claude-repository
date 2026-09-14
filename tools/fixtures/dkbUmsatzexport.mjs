// Fixtures for the DKB Umsatzexport parser — the real layout, invented content.
//
// The original PDF is not in this repository and must not be: it is a bank
// statement. What is reproduced here is its GEOMETRY, measured with
// pdfjs.getTextContent() on the real file and written down as the coordinates
// the builder below lays out:
//
//   page 597 × 842 pt · page label at y 777 · column header at y 510 (page 1)
//   and y 703 (following pages) · date column x 73 · description column x 155 ·
//   amount column right-aligned to x 523.5 · content font size 8 · footer font
//   size 7 at y 32…82 · description lines 12 pt then 11 pt apart · blocks 42 pt
//   apart, 53 for a four-line block, 64 for a five-line one
//
// Names, IBANs and reference numbers are invented; their SHAPE is not. The
// spaces between words are emitted as their own items, because that is what the
// real file does and what the parser has to survive.

const CONTENT_SIZE = 8
const FOOTER_SIZE = 7
const X_DATE = 73
const X_TEXT = 155
const X_AMOUNT_RIGHT = 523.5
const CHAR_WIDTH = 4.2

const width = (text) => text.length * CHAR_WIDTH

const item = (str, x, y, size = CONTENT_SIZE) => ({
  str,
  x,
  y,
  width: width(str),
  fontSize: size,
})

/**
 * One printed line of the description column, emitted the way the document
 * does it: the words and the spaces between them as separate items.
 */
function textLine(text, y) {
  const items = []
  let x = X_TEXT
  const parts = text.split(/( )/)
  for (const part of parts) {
    if (part === '') continue
    items.push(item(part, x, y))
    x += width(part)
  }
  return items
}

/** The amount column is right aligned — that is how the parser recognises it. */
const amountItem = (text, y) => item(text, X_AMOUNT_RIGHT - width(text), y)

const DKB_FOOTER = [
  ['Deutsche Kreditbank AG', 64, 82],
  ['Taubenstraße 7 - 9', 64, 72],
  ['10117 Berlin', 64, 62],
  ['Ein Unternehmen der', 64, 42],
  ['Bayerischen Landesbank', 64, 32],
  ['Vorsitzender des Aufsichtsrats', 174, 82],
  ['info@dkb.de', 311, 82],
  ['www.dkb.de', 311, 72],
  ['BIC: BYLADEM1001', 413, 82],
  ['USt-ID-Nr.: DE137178746', 413, 62],
].map(([str, x, y]) => item(str, x, y, FOOTER_SIZE))

const columnHeader = (y) => [
  item('Datum', X_DATE, y),
  item(' ', 99.05, y),
  item('Erläuterung', X_TEXT, y),
  item(' ', 199.84, y),
  item('Betrag EUR', 481, y),
]

/**
 * A booking block.
 *
 * @param {{date: string, amount: string, lines: string[]}} spec
 */
export const block = (date, amount, lines) => ({ date, amount, lines })

/** The vertical distance to the next block, by line count — measured. */
const blockHeight = (lineCount) => (lineCount <= 3 ? 42 : 12 + 11 * (lineCount - 2) + 19)

function layoutPage({ number, pageCount, first, blocks, meta }) {
  const items = [item(`Seite ${number} von ${pageCount}`, 485, 777)]

  if (first) {
    items.push(
      item('Max Mustermann', 64, 679),
      item('Musterweg 1', 64, 665),
      item('12345 Musterstadt', 64, 651),
      item('Auszug', 64, 565),
      item('DE00 1203 0000 0000 0000 00', 64, 551),
      item('14. September 2026', 460, 565),
      item(`Anzahl der Transaktionen: ${meta.declaredCount}`, 421, 551),
      item(`Zeitraum: ${meta.periodStart} - ${meta.periodEnd}`, 412, 537)
    )
  }

  const headerY = first ? 510 : 703
  items.push(...columnHeader(headerY))

  let y = headerY - 26
  for (const b of blocks) {
    items.push(item(b.date, X_DATE, y))
    items.push(item(' ', X_DATE + width(b.date), y))
    if (b.amount !== null) items.push(amountItem(b.amount, y))
    b.lines.forEach((line, index) => {
      items.push(...textLine(line, index === 0 ? y : y - 12 - 11 * (index - 1)))
    })
    y -= blockHeight(b.lines.length)
  }

  items.push(...DKB_FOOTER)
  return { number, width: 597, height: 842, items }
}

/**
 * Build a whole document.
 *
 * @param {{pages: Array<Array<object>>, declaredCount?: number,
 *          periodStart?: string, periodEnd?: string}} spec
 */
export function buildDocument({
  pages,
  declaredCount = null,
  periodStart = '07.09.2026',
  periodEnd = '14.09.2026',
}) {
  const count = declaredCount ?? pages.flat().length
  return {
    pages: pages.map((blocks, index) =>
      layoutPage({
        number: index + 1,
        pageCount: pages.length,
        first: index === 0,
        blocks,
        meta: { declaredCount: count, periodStart, periodEnd },
      })
    ),
  }
}

// ── The building blocks the real export is made of ──────────────────────────

/** The ordinary, settled card booking: merchant, IBAN of the card system, date. */
export const cardBooking = (date, amount, merchant, cardDate) =>
  block(date, amount, [
    merchant,
    'IBAN DE96 1203 0000 9005 2909 04',
    `VISA Debitkartenumsatz vom ${cardDate}`,
  ])

/**
 * The second card format: an ISO timestamp down to the minute, the literal
 * "null" prefix the bank itself emits, and the space inside "De bit" — all three
 * exactly as the file writes them, because the parser must not tidy them up.
 */
export const timestampedCardBooking = (date, amount, merchant, timestamp, marker = '(POS)') =>
  block(date, amount, [
    merchant,
    `null${timestamp} Debitk. 0 2099-12 Zahl.System VISA De bit`,
    marker,
  ])

/** A SEPA transfer: name, IBAN, free-text purpose. */
export const transferBooking = (date, amount, name, iban, purpose) =>
  block(date, amount, [name, `IBAN ${iban}`, purpose])

/** PayPal, with its reference number and the two-line purpose it produces. */
export const paypalBooking = (date, amount, reference, shop) =>
  block(date, amount, [
    'PayPal Europe S.a.r.l. et Cie S.C.A',
    'IBAN LU89 7510 0013 5104 200E',
    `${reference}/. ${shop}, Ihr`,
    `Einkauf bei ${shop}`,
  ])

/** A card booking in a foreign currency — five lines, EUR still in the column. */
export const foreignCurrencyBooking = (date, amount, merchant, cardDate, original, rate) =>
  block(date, amount, [
    merchant,
    'IBAN DE96 1203 0000 9005 2909 04',
    `VISA Debitkartenumsatz vom ${cardDate} in Fremdwährung /`,
    `Ursprungsbetrag in Fremdwährung ${original} /`,
    `Umrechnungsrate: 1 Euro=${rate}`,
  ])

// ── Named fixtures ──────────────────────────────────────────────────────────

const NUL = String.fromCharCode(0)

/**
 * The reference document: three pages, twelve bookings, every format the real
 * export contains — including the two bookings that are identical in date,
 * amount and merchant and differ only in their embedded minute.
 */
export const REFERENCE_PAGES = [
  [
    timestampedCardBooking('14.09.2026', '-1.50', 'oePA Verkehrsgesellsch Musterstadt DE', '2026-09-13T09:28'),
    timestampedCardBooking('14.09.2026', '-60.65', 'Deutsche Bahn', '2026-09-12T17:06'),
    timestampedCardBooking('14.09.2026', '-60.65', 'Deutsche Bahn', '2026-09-12T17:02'),
    timestampedCardBooking('14.09.2026', '50.05', 'DB Vertrieb GmbH 564851284265 DE', '2026-09-13T13:44', '(UmsAnk)'),
    transferBooking('14.09.2026', '45.00', 'Erika Musterfrau', 'DE40 1203 0000 1003 0437 24', 'Alles gute noch zum Geburtstag.'),
  ],
  [
    transferBooking('14.09.2026', '350.00', 'Daniel Muster', 'DE43 1203 0000 0011 7466 41', 'Zugtickets'),
    paypalBooking('14.09.2026', '-0.50', '1052983361139', 'Use AI'),
    cardBooking('11.09.2026', '-7.50', 'ARENA Gastronomie', '10.09.2026'),
    cardBooking('10.09.2026', '-14.38', 'REWE', '09.09.2026'),
    cardBooking('10.09.2026', '-0.40', 'EDEKA', '09.09.2026'),
    // The purchase the +50.05 above refunds. In the first export it is the bare
    // merchant name and carries no reference at all — the link only becomes
    // visible in the second export.
    cardBooking('10.09.2026', '-50.05', 'Deutsche Bahn', '09.09.2026'),
    foreignCurrencyBooking('09.09.2026', '-1.72', 'DAVINCI/WESTMINSTER', '08.09.2026', '1,99 USD', '1,15697680 USD'),
  ],
  [
    paypalBooking('09.09.2026', '-549.21', '1052906804694/PP.8169.PP', `Department of Home A${NUL}airs`),
    transferBooking('08.09.2026', '600.00', 'Max Mustermann', 'DE08 6005 0101 7007 7809 17', 'Ruecklage'),
    cardBooking('07.09.2026', '-4.54', 'EDEKA', '04.09.2026'),
  ],
]

export const referenceDocument = () => buildDocument({ pages: REFERENCE_PAGES })

// ── The second, overlapping export ──────────────────────────────────────────
// 10.09.–14.09., i.e. the tail of the first one. It reproduces, with invented
// content, every relationship the two real exports show:
//
//   • the provisional bookings of the first export, now settled and with a
//     completely different text — including the pair that stays a pair
//   • already settled bookings whose text simply got richer
//   • two bookings that are word for word what was imported before
//   • the refund whose reference also sits on the purchase
//   • one booking that is genuinely new
export const SECOND_EXPORT_PAGES = [
  [
    // Genuinely new: nothing in the first export matches it.
    transferBooking('14.09.2026', '-255.00', 'Scalable Capital GmbH', 'DE86 1207 0070 0758 3769 30', 'Broker 2x Sparplaene'),
    cardBooking('14.09.2026', '-1.50', 'OEPA.VERKEHRSGESELLSCH/MUSTERSTADT', '13.09.2026'),
    // Same amount, same card date, different references — and nothing that says
    // which of the two provisional ones each of them settles.
    cardBooking('14.09.2026', '-60.65', 'DB.Vertrieb.GmbH/508354771568', '12.09.2026'),
    cardBooking('14.09.2026', '-60.65', 'DB.Vertrieb.GmbH/198004303927', '12.09.2026'),
    // The settled refund: no "vom" line at all, only a 14-digit timestamp —
    // so its link to the announcement is the shared reference.
    block('14.09.2026', '50.05', [
      'DB.Vertrieb.GmbH/564851284265',
      'IBAN DE96 1203 0000 9005 2909 04',
      '20260914132522 DB.Vertrieb.GmbH DE',
    ]),
  ],
  [
    transferBooking('14.09.2026', '45.00', 'Erika Musterfrau', 'DE40 1203 0000 1003 0437 24', 'Alles gute noch zum Geburtstag.'),
    transferBooking('14.09.2026', '350.00', 'Daniel Muster', 'DE43 1203 0000 0011 7466 41', 'Zugtickets'),
    // Word for word what the first export already carried.
    paypalBooking('14.09.2026', '-0.50', '1052983361139', 'Use AI'),
    cardBooking('11.09.2026', '-7.50', 'ARENA.GASTRO/KOELN', '10.09.2026'),
    cardBooking('10.09.2026', '-14.38', 'REWE.Mohamed.Boufo/Frankfurt', '09.09.2026'),
    cardBooking('10.09.2026', '-0.40', 'EDEKA.FLECK/STUTTGART', '09.09.2026'),
    cardBooking('10.09.2026', '-50.05', 'DB.Vertrieb.GmbH/564851284265', '09.09.2026'),
  ],
]

export const secondExportDocument = () =>
  buildDocument({ pages: SECOND_EXPORT_PAGES, periodStart: '10.09.2026', periodEnd: '14.09.2026' })

/** The same document, but the control value disagrees with what is printed. */
export const wrongCountDocument = () =>
  buildDocument({ pages: REFERENCE_PAGES, declaredCount: 13 })

/** A single booking, nothing else — the smallest valid document. */
export const singleBookingDocument = () =>
  buildDocument({ pages: [[cardBooking('07.09.2026', '-4.54', 'REWE', '04.09.2026')]] })

/** A booking without an amount. */
export const missingAmountDocument = () =>
  buildDocument({ pages: [[block('07.09.2026', null, ['REWE', 'IBAN DE96 1203 0000 9005 2909 04'])]] })

/** A date that has the right shape and is not a day. */
export const invalidDateDocument = () =>
  buildDocument({
    pages: [[cardBooking('31.02.2026', '-4.54', 'REWE', '04.09.2026')]],
    periodStart: '01.02.2026',
    periodEnd: '28.02.2026',
  })

/** An amount written with a thousands separator — a format no export proves. */
export const unknownAmountFormatDocument = () =>
  buildDocument({ pages: [[cardBooking('07.09.2026', '-1,234.56', 'REWE', '04.09.2026')]] })

/** A booking dated outside the period the document claims to cover. */
export const outOfPeriodDocument = () =>
  buildDocument({
    pages: [[cardBooking('01.01.2026', '-4.54', 'REWE', '04.09.2026')]],
    periodStart: '07.09.2026',
    periodEnd: '14.09.2026',
  })

/** A stray item between the date and the description column. */
export function orphanItemDocument() {
  const doc = buildDocument({ pages: [[cardBooking('07.09.2026', '-4.54', 'REWE', '04.09.2026')]] })
  doc.pages[0].items.push(item('Waise', 120, 484))
  return doc
}

/** A scan: pages exist, a text layer does not. */
export const scannedDocument = () => ({
  pages: [
    { number: 1, width: 597, height: 842, items: [] },
    { number: 2, width: 597, height: 842, items: [] },
  ],
})

/** Not a DKB Umsatzexport at all. */
export function foreignDocument() {
  const doc = buildDocument({ pages: [[cardBooking('07.09.2026', '-4.54', 'REWE', '04.09.2026')]] })
  doc.pages[0].items = doc.pages[0].items.filter((i) => i.str !== 'Auszug')
  return doc
}

export { item as fixtureItem, NUL as UNMAPPED_GLYPH }
