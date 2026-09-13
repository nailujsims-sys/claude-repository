// The DKB Umsatzexport, as measured — not as assumed.
//
// Every number in this file was read off a real export with
// pdfjs.getTextContent(); none of it is a guess about "how bank statements
// usually look". The analysis that produced them is summarised here so the next
// person can check a new export against the same evidence instead of
// re-deriving it:
//
//   • 3 pages, 597 × 842 pt, producer Skia/PDF (the bank's web UI printed to
//     PDF by Chrome). Exactly two font sizes: 8 is content, 7 is footer, and
//     nothing else appears.
//   • A booking block begins at an item that sits in the date column AND is
//     exactly dd.mm.yyyy. That single rule found all 27 blocks of the sample,
//     which is precisely what the document's own control value says.
//   • The amount column is RIGHT aligned: its left x moves with the number's
//     length (497…508 in the sample), so the stable anchor is the right edge
//     (x + width), which sat between 523.02 and 523.94 for every one of the 27
//     amounts — while the page header's items end at 532.3.
//   • Description lines live at x = 155, 11–12 pt apart; the gap to the next
//     block is 19 pt or more.
//   • There is no Wertstellung, no balance, no statement number and no bank
//     side reference anywhere in the document. Fields that do not exist are not
//     invented here — see PARSED_FIELDS below.
//
// A future export that deviates from these positions does not get parsed
// leniently. It fails, loudly, with the offending coordinate in the error —
// because a shifted column that is silently tolerated is how a wrong amount
// ends up in a spending report.

/** Content lives at font size 8, the DKB legal footer at 7. Nothing else occurs. */
export const CONTENT_FONT_SIZE = 8
export const FOOTER_FONT_SIZE = 7

/** How far an item may sit from its column and still count as being in it. */
export const X_TOLERANCE = 1.5

/** Column positions, measured. */
export const X_DATE = 73
export const X_DESCRIPTION = 155
export const X_ADDRESS = 64

/** No description item ever starts at or beyond this; the amount always does. */
export const X_AMOUNT_MIN = 450

/**
 * The amount column is right aligned, so this — not the left x — is what
 * identifies it. Measured 523.02…523.94 across 27 amounts; the page header's
 * right-aligned items end at 532.3, well outside the window.
 */
export const AMOUNT_RIGHT_MIN = 519
export const AMOUNT_RIGHT_MAX = 528

/** Below this y only the footer occurs. */
export const FOOTER_Y_MAX = 100

/** Distance kept below the column header before table content may start. */
export const HEADER_GAP = 5

/** The three column headers, at their measured x positions. */
export const COLUMN_HEADERS = [
  { label: 'Datum', x: X_DATE },
  { label: 'Erläuterung', x: X_DESCRIPTION },
  { label: 'Betrag EUR', x: 481 },
]

/**
 * The currency is stated once, in the third column header, and nowhere else —
 * not on the individual booking. So it is read from there and verified, rather
 * than assumed to be EUR.
 */
export const AMOUNT_COLUMN_PREFIX = 'Betrag '

/** dd.mm.yyyy — the only date shape the document uses in the date column. */
export const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/

/**
 * The amount, exactly as the document writes it: optional minus, digits, a DOT
 * as the decimal separator, two decimals.
 *
 * Deliberately without any thousands separator. The largest amount in the
 * sample was 600.00, so how DKB writes 1234.56 is simply not known — and the
 * three plausible spellings (1234.56 / 1,234.56 / 1.234,56) would be read as
 * three different numbers. An export containing one fails validation instead of
 * silently booking the wrong figure; the pattern gets extended once a real
 * export proves the format.
 *
 * Note that the surrounding description text uses German decimal commas
 * ("1,99 USD"). The two formats must never be read by the same function.
 */
export const AMOUNT_PATTERN = /^(-?)(\d+)\.(\d{2})$/

/** "Seite 2 von 3" — on every page, at y = 777. */
export const PAGE_LABEL_PATTERN = /^Seite (\d+) von (\d+)$/

/** The document's own control value. This is what replaces a balance check. */
export const DECLARED_COUNT_PATTERN = /^Anzahl der Transaktionen:\s*(\d+)$/

/** The period the export covers; every booking date has to fall inside it. */
export const PERIOD_PATTERN = /^Zeitraum:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})$/

/** The statement heading on page 1, used to recognise the document type. */
export const DOCUMENT_HEADING = 'Auszug'

/** The issue date on page 1 ("14. September 2026") — known, and not otherwise used. */
export const ISSUE_DATE_PATTERN = /^\d{1,2}\. [A-Za-zÄÖÜäöü]+ \d{4}$/

/**
 * An IBAN as the document prints it: groups of four, with a shorter last group
 * whenever the length does not divide evenly ("… 2909 04").
 */
export const IBAN_PATTERN = /^[A-Z]{2}[0-9A-Z]{2}(?: [0-9A-Z]{2,4})+$/

/**
 * The structural marker of the second card format. Those bookings carry an ISO
 * timestamp down to the minute inside their description, where the ordinary
 * card booking only names a date.
 *
 * The marker is recorded as `source_variant: 'timestamped_card'` and NOTHING is
 * derived from it — not a different dedupe rule, not a different persistence
 * path, and above all not the label "Vormerkung". Whether these bookings later
 * reappear in settled form is a question a single export cannot answer; it gets
 * decided with a second, overlapping export and not by this constant.
 */
export const CARD_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
export const CARD_SYSTEM_MARKER = 'Zahl.System'

/** "VISA Debitkartenumsatz vom 09.09.2026" — the settled card format. */
export const CARD_DATE_PATTERN = /VISA Debitkartenumsatz vom (\d{2}\.\d{2}\.\d{4})/

/** The three lines a foreign-currency booking adds to its description. */
export const FOREIGN_CURRENCY_MARKER = 'Fremdwährung'

/**
 * What the parser produces per booking, and what it deliberately does not.
 *
 * `value_date` is null on purpose and not "not implemented": the document has
 * no Wertstellung. The embedded card date is the card's transaction date, which
 * is a different fact — writing it into value_date would invent a banking
 * statement the bank never made. It stays inside raw_description, where it came
 * from, and is additionally recorded verbatim in source_metadata.
 */
export const PARSED_FIELDS = [
  'booking_date',
  'value_date',
  'amount_minor',
  'currency',
  'raw_description',
  'normalized_tokens',
  'source_variant',
  'source_metadata',
]
