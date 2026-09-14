// Fixture tests for the DKB Umsatzexport parser.
//
// Every fixture reproduces the geometry of a real export (see
// tools/fixtures/dkbUmsatzexport.mjs) with invented content — the original PDF
// is a bank statement and stays out of this repository.
//
// The assertions are mostly about what the parser REFUSES. A parser that reads
// nine of ten bookings and says nothing is worse than one that reads none: the
// missing tenth becomes a spending total that is quietly too small. So every
// defect below has to stop the whole import, and the test proves it does.
//
// Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
import { parseAmountMinor, parseGermanDate } from './src/lib/finance/dkb/amount.js'
import { sanitizeGlyphs, REPLACEMENT_CHARACTER } from './src/lib/finance/dkb/glyphs.js'
import { groupIntoLines, lineText } from './src/lib/finance/dkb/lines.js'
import { fingerprintReport, indistinguishable } from './src/lib/finance/dkb/fingerprint.js'
import { extractPdfTextDocument } from './src/lib/finance/dkb/extract.js'
import { tokenize, unreliableTokens } from './src/lib/finance/normalize.js'
import { buildLearnRequest } from './src/lib/finance/learning.js'
import {
  buildDocument,
  cardBooking,
  foreignDocument,
  invalidDateDocument,
  missingAmountDocument,
  orphanItemDocument,
  outOfPeriodDocument,
  referenceDocument,
  scannedDocument,
  singleBookingDocument,
  unknownAmountFormatDocument,
  wrongCountDocument,
} from './tools/fixtures/dkbUmsatzexport.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const codes = (result) => result.errors.map((e) => e.code)
const has = (result, code) => codes(result).includes(code)

// ── 1. Money: string to integer, never through a float ──────────────────────
{
  ok('a negative amount becomes negative minor units', parseAmountMinor('-54.80').minor === -5480)
  ok('a positive amount has no sign', parseAmountMinor('50.05').minor === 5005)
  ok('a whole amount keeps its cents', parseAmountMinor('600.00').minor === 60000)
  ok('the smallest amount survives', parseAmountMinor('-0.01').minor === -1)
  ok('0.07 is 7 cents and not 7.000000000000001',
     parseAmountMinor('0.07').minor === 7 && Number.isInteger(parseAmountMinor('0.07').minor))
  ok('a thousands separator is refused, not guessed',
     parseAmountMinor('1,234.56').reason === 'amount_format_unknown')
  ok('a German decimal comma is refused', parseAmountMinor('1.234,56').reason === 'amount_format_unknown')
  ok('a bare four-digit amount without separator is still read',
     parseAmountMinor('1234.56').minor === 123456)
  ok('one decimal is not an amount', parseAmountMinor('12.3').reason === 'amount_format_unknown')
  ok('three decimals are not an amount', parseAmountMinor('12.345').reason === 'amount_format_unknown')
  ok('a currency symbol is not an amount', parseAmountMinor('12.34 EUR').reason === 'amount_format_unknown')
  ok('a trailing minus is not an amount', parseAmountMinor('12.34-').reason === 'amount_format_unknown')
  ok('an amount beyond the safe range is refused',
     parseAmountMinor('99999999999999999.99').reason === 'amount_out_of_range')
  ok('nothing is not an amount', parseAmountMinor('').reason === 'amount_missing')

  ok('a date becomes ISO', parseGermanDate('14.09.2026') === '2026-09-14')
  ok('a day that does not exist is refused', parseGermanDate('31.02.2026') === null)
  ok('a month that does not exist is refused', parseGermanDate('01.13.2026') === null)
  ok('another shape is refused', parseGermanDate('2026-09-14') === null)
}

// ── 2. Lines: the whitespace items must survive ─────────────────────────────
{
  const items = [
    { str: 'oePA Verkehrsgesellsch', x: 155, y: 484, width: 93.58, fontSize: 8 },
    { str: ' ', x: 248.58, y: 484, width: 6.29, fontSize: 8 },
    { str: 'Musterstadt', x: 254.87, y: 484, width: 34.34, fontSize: 8 },
    { str: ' ', x: 289.2, y: 484, width: 7.79, fontSize: 8 },
    { str: 'DE', x: 297, y: 484, width: 10.46, fontSize: 8 },
  ]
  const [line] = groupIntoLines(items)
  ok('a line is rebuilt with its spaces intact',
     lineText(line) === 'oePA Verkehrsgesellsch Musterstadt DE')
  ok('dropping blank items would have broken it — this is the failure being guarded',
     items.filter((i) => i.str.trim() !== '').map((i) => i.str).join('') !== lineText(line))

  const shuffled = groupIntoLines([items[4], items[0], items[2], items[3], items[1]])
  ok('drawing order does not matter, x order does',
     lineText(shuffled[0]) === 'oePA Verkehrsgesellsch Musterstadt DE')

  const twoLines = groupIntoLines([
    { str: 'unten', x: 155, y: 472, width: 20, fontSize: 8 },
    { str: 'oben', x: 155, y: 484, width: 20, fontSize: 8 },
  ])
  ok('lines come back top first', twoLines[0].y === 484 && twoLines[1].y === 472)
}

// ── 3. Unmapped glyphs ──────────────────────────────────────────────────────
{
  const NUL = String.fromCharCode(0)
  const s = sanitizeGlyphs('Home A' + NUL + 'airs')
  ok('a NUL becomes the replacement character', s.text === 'Home A' + REPLACEMENT_CHARACTER + 'airs')
  ok('the replacement is counted', s.replaced === 1)
  ok('text without a NUL is untouched', sanitizeGlyphs('REWE').text === 'REWE' && sanitizeGlyphs('REWE').replaced === 0)
  ok('no NUL survives — PostgreSQL text could not store it', !s.text.includes(NUL))
}

// ── 4. The reference document ───────────────────────────────────────────────
{
  const result = parseDkbUmsatzexport(referenceDocument())
  ok('the reference document parses', result.ok === true)
  ok('…with no errors', result.errors.length === 0)
  ok('all fifteen bookings are found', result.transactions.length === 15)
  ok('the control value is read', result.header.declared_count === 15)
  ok('the period is read', result.header.period_start === '2026-09-07' && result.header.period_end === '2026-09-14')
  ok('the currency comes from the column header', result.header.currency === 'EUR')
  ok('three pages are seen', result.header.page_count === 3)

  const t = result.transactions
  ok('a negative booking stays negative', t[0].amount_minor === -150)
  ok('a positive booking stays positive', t[3].amount_minor === 5005)
  ok('a transfer over 600 euros is 60000 cents', t.find((x) => x.amount_minor === 60000) !== undefined)
  ok('every amount is a safe integer', t.every((x) => Number.isSafeInteger(x.amount_minor)))
  ok('every booking carries the document currency', t.every((x) => x.currency === 'EUR'))
  ok('no value date is invented', t.every((x) => x.value_date === null))
  ok('booking dates are ISO', t.every((x) => /^\\d{4}-\\d{2}-\\d{2}$/.test(x.booking_date)))
  ok('every booking date lies inside the period',
     t.every((x) => x.booking_date >= '2026-09-07' && x.booking_date <= '2026-09-14'))

  // Multi-page: the bookings of pages 2 and 3 are there, in order.
  ok('bookings come from all three pages',
     new Set(t.map((x) => x.source_metadata.page)).size === 3)
  ok('the page footer never becomes a booking',
     t.every((x) => !x.raw_description.includes('Deutsche Kreditbank AG')))
  ok('the page header never becomes a booking',
     t.every((x) => !x.raw_description.includes('Anzahl der Transaktionen')))
  ok('the column header never becomes a booking',
     t.every((x) => !x.raw_description.includes('Erläuterung')))

  // Multi-line descriptions, verbatim.
  // The one PayPal booking that carries an unencoded position — there is a
  // second, clean one in the fixture, and picking whichever comes first would
  // make these assertions depend on the order of the pages.
  const paypal = t.find((x) => x.source_metadata.unmapped_glyphs > 0)
  ok('a four-line description keeps all four lines', paypal.raw_description.split('\\n').length === 4)
  ok('…and its reference number', paypal.raw_description.includes('1052906804694/PP.8169.PP'))
  ok('…and is recorded as such', paypal.source_metadata.line_count === 4)

  const foreign = t.find((x) => x.source_metadata.foreign_currency)
  ok('a foreign-currency booking keeps its five lines', foreign.raw_description.split('\\n').length === 5)
  ok('…keeps the original amount in the text', foreign.raw_description.includes('1,99 USD'))
  ok('…keeps the conversion rate in the text', foreign.raw_description.includes('1,15697680'))
  ok('…but is booked in euros', foreign.amount_minor === -172 && foreign.currency === 'EUR')
  ok('…and no second currency column is invented', foreign.source_metadata.original_amount === undefined)

  // The two card formats.
  const timestamped = t.filter((x) => x.source_variant === 'timestamped_card')
  const standard = t.filter((x) => x.source_variant === 'standard')
  ok('the timestamped variant is recognised structurally', timestamped.length === 4)
  ok('everything else is standard', standard.length === 11)
  ok('the variant is only ever these two',
     t.every((x) => x.source_variant === 'standard' || x.source_variant === 'timestamped_card'))
  ok('the timestamp is kept verbatim in the metadata',
     timestamped[0].source_metadata.card_timestamp === '2026-09-13T09:28')
  ok('the literal "null" prefix the bank emits is preserved',
     timestamped[0].raw_description.includes('null2026-09-13T09:28'))
  ok('the space inside "De bit" is preserved, not tidied up',
     timestamped[0].raw_description.includes('VISA De bit'))
  ok('the settled card date is kept as a substring, not as a value date',
     standard.some((x) => x.source_metadata.card_transaction_date !== null) &&
     standard.every((x) => x.value_date === null))
  ok('no booking is labelled a Vormerkung anywhere',
     JSON.stringify(result).toLowerCase().includes('vormerkung') === false)

  // The glyph the file does not encode.
  ok('the unmapped glyph raises a warning', result.warnings.some((w) => w.code === 'unmapped_glyph'))
  ok('both occurrences are reported', result.warnings.filter((w) => w.code === 'unmapped_glyph').length === 2)
  ok('the warning names its page', result.warnings.find((w) => w.code === 'unmapped_glyph').page === 3)
  ok('the warning carries the surrounding text',
     result.warnings.find((w) => w.code === 'unmapped_glyph').context.includes(REPLACEMENT_CHARACTER))
  ok('the warning says whether it reaches the data',
     result.warnings.every((w) => w.in_transaction === true))
  ok('a warning does not stop the import', result.ok === true)
  ok('the affected booking carries the replacement character',
     paypal.raw_description.includes(REPLACEMENT_CHARACTER))
  ok('…and no NUL', !paypal.raw_description.includes(String.fromCharCode(0)))
  ok('…and the count is on the booking', paypal.source_metadata.unmapped_glyphs === 2)

  // Tokens: the module's one normaliser, not a second one.
  ok('tokens come from the canonical tokenizer',
     t.every((x) => JSON.stringify(x.normalized_tokens) === JSON.stringify(tokenize(x.raw_description))))
  ok('a city is not removed', t[0].normalized_tokens.includes('MUSTERSTADT'))
  ok('a number is not removed', paypal.normalized_tokens.includes('1052906804694'))
  ok('REWE is a token of the REWE booking',
     t.find((x) => x.raw_description.startsWith('REWE')).normalized_tokens.includes('REWE'))
}

// ── 5. Two identical bookings on one day ────────────────────────────────────
{
  const result = parseDkbUmsatzexport(referenceDocument())
  const sameDay = result.transactions.filter(
    (x) => x.booking_date === '2026-09-14' && x.amount_minor === -6065
  )
  ok('two bookings share date, amount and merchant', sameDay.length === 2)
  ok('…and both survive as separate bookings', sameDay[0] !== sameDay[1])
  ok('…and differ only in the embedded minute',
     sameDay[0].raw_description !== sameDay[1].raw_description &&
     sameDay[0].raw_description.replace(/T\\d{2}:\\d{2}/, 'T') ===
       sameDay[1].raw_description.replace(/T\\d{2}:\\d{2}/, 'T'))

  const report = fingerprintReport(result.transactions)
  ok('date + amount collides on real data', report.date_amount.collisions.length === 1)
  ok('date + amount + first line collides too', report.date_amount_first_line.collisions.length === 1)
  ok('the full description separates them', report.date_amount_description.collisions.length === 0)
  ok('…but only because of the timestamp',
     report.date_amount_description_without_timestamp.collisions.length === 1)
  ok('nothing is indistinguishable in this export', indistinguishable(result.transactions).length === 0)
  ok('no dedupe hash is written anywhere',
     result.transactions.every((x) => x.dedupe_hash === undefined))
}

// ── 6. Fail-closed: every defect stops the whole import ─────────────────────
{
  const single = parseDkbUmsatzexport(singleBookingDocument())
  ok('a single booking is a valid document', single.ok === true && single.transactions.length === 1)

  const wrongCount = parseDkbUmsatzexport(wrongCountDocument())
  ok('a control value that disagrees stops the import', wrongCount.ok === false)
  ok('…with the reason named', has(wrongCount, 'count_mismatch'))
  ok('…and nothing is handed out', wrongCount.transactions.length === 0)

  const noAmount = parseDkbUmsatzexport(missingAmountDocument())
  ok('a booking without an amount stops the import', noAmount.ok === false)
  ok('…with the reason named', has(noAmount, 'block_amount_missing'))

  const badDate = parseDkbUmsatzexport(invalidDateDocument())
  ok('a date that is not a day stops the import', badDate.ok === false)
  ok('…with the reason named', has(badDate, 'block_date_invalid'))

  const badAmount = parseDkbUmsatzexport(unknownAmountFormatDocument())
  ok('an unproven amount format stops the import', badAmount.ok === false)
  ok('…with the reason named', has(badAmount, 'amount_format_unknown'))
  ok('…and blames the separator, not the number of digits',
     badAmount.errors[0].message.includes('Tausendertrennung') &&
     !badAmount.errors[0].message.includes('Vierstellige'))

  const orphan = parseDkbUmsatzexport(orphanItemDocument())
  ok('a stray text item stops the import', orphan.ok === false)
  ok('…with the reason named', has(orphan, 'orphan_item'))
  ok('…and its coordinates', orphan.errors.find((e) => e.code === 'orphan_item').x === 120)

  const outside = parseDkbUmsatzexport(outOfPeriodDocument())
  ok('a booking outside the period stops the import', outside.ok === false)
  ok('…with the reason named', has(outside, 'date_out_of_period'))

  const scanned = parseDkbUmsatzexport(scannedDocument())
  ok('a scan is refused', scanned.ok === false)
  ok('…as not machine-readable', has(scanned, 'no_text_layer'))
  ok('…and no OCR is attempted', scanned.transactions.length === 0)

  const foreign = parseDkbUmsatzexport(foreignDocument())
  ok('a document that is not a DKB export is refused', foreign.ok === false)
  ok('…with the reason named', has(foreign, 'document_not_recognised'))

  ok('an empty input is refused', parseDkbUmsatzexport({}).ok === false)
  ok('null is refused', parseDkbUmsatzexport(null).ok === false)
  ok('a document without pages says why', has(parseDkbUmsatzexport({ pages: [] }), 'no_text_layer'))
}

// ── 7. Structural damage the count alone would not catch ────────────────────
{
  // The column header moved: the file may be a different layout, and reading it
  // as if it had not moved is how an amount lands under the wrong booking.
  const shifted = singleBookingDocument()
  shifted.pages[0].items = shifted.pages[0].items.map((i) =>
    i.str === 'Erläuterung' ? { ...i, x: 200 } : i
  )
  const shiftedResult = parseDkbUmsatzexport(shifted)
  ok('a moved column stops the import', shiftedResult.ok === false)
  ok('…with the reason named', has(shiftedResult, 'column_header_missing'))

  // A page label that disagrees with what was actually read.
  const mislabelled = singleBookingDocument()
  mislabelled.pages[0].items = mislabelled.pages[0].items.map((i) =>
    i.str.startsWith('Seite ') ? { ...i, str: 'Seite 2 von 7' } : i
  )
  const mislabelledResult = parseDkbUmsatzexport(mislabelled)
  ok('a page that names itself wrongly stops the import', mislabelledResult.ok === false)
  ok('…with the reason named', has(mislabelledResult, 'page_sequence_invalid'))

  // A missing control value is not a document to guess at.
  const noCount = singleBookingDocument()
  noCount.pages[0].items = noCount.pages[0].items.filter(
    (i) => !i.str.startsWith('Anzahl der Transaktionen')
  )
  ok('a missing control value stops the import',
     has(parseDkbUmsatzexport(noCount), 'declared_count_missing'))

  const noPeriod = singleBookingDocument()
  noPeriod.pages[0].items = noPeriod.pages[0].items.filter((i) => !i.str.startsWith('Zeitraum:'))
  ok('a missing period stops the import', has(parseDkbUmsatzexport(noPeriod), 'period_missing'))

  // Two amounts on one booking line.
  const twoAmounts = singleBookingDocument()
  twoAmounts.pages[0].items.push({ str: '-9.99', x: 460, y: 484, width: 20, fontSize: 8 })
  const twoAmountsResult = parseDkbUmsatzexport(twoAmounts)
  ok('two amounts on one booking stop the import', twoAmountsResult.ok === false)
  ok('…with the reason named', has(twoAmountsResult, 'block_amount_ambiguous'))

  // An amount that is not in the amount column.
  const misaligned = singleBookingDocument()
  misaligned.pages[0].items = misaligned.pages[0].items.map((i) =>
    i.str === '-4.54' ? { ...i, x: 455, width: 20 } : i
  )
  ok('an amount outside the right-aligned column stops the import',
     has(parseDkbUmsatzexport(misaligned), 'amount_column_misaligned'))

  // Footer text where footer text does not belong.
  const strayFooter = singleBookingDocument()
  strayFooter.pages[0].items.push({ str: 'Kleingedrucktes', x: 64, y: 300, width: 40, fontSize: 7 })
  ok('footer-sized text inside the table stops the import',
     has(parseDkbUmsatzexport(strayFooter), 'orphan_item'))

  // An unencoded glyph in the bank's own footer is true, but it is not a
  // problem with the user's statement — and the preview has to be able to tell.
  const footerGlyph = singleBookingDocument()
  footerGlyph.pages[0].items = footerGlyph.pages[0].items.map((i) =>
    i.str === '10117 Berlin' ? { ...i, str: 'A' + String.fromCharCode(0) + 'airs' } : i
  )
  const footerGlyphResult = parseDkbUmsatzexport(footerGlyph)
  ok('a glyph in the footer still parses', footerGlyphResult.ok === true)
  ok('…is still reported', footerGlyphResult.warnings.some((w) => w.code === 'unmapped_glyph'))
  ok('…but marked as not reaching the data',
     footerGlyphResult.warnings.every((w) => w.in_transaction === false))
  ok('…and no booking carries it',
     footerGlyphResult.transactions.every((t) => t.source_metadata.unmapped_glyphs === 0))

  // Dates that jump around mean a block boundary was read wrongly.
  const unsorted = buildDocument({
    pages: [[
      cardBooking('07.09.2026', '-1.00', 'REWE', '04.09.2026'),
      cardBooking('14.09.2026', '-2.00', 'EDEKA', '04.09.2026'),
      cardBooking('09.09.2026', '-3.00', 'REWE', '04.09.2026'),
    ]],
  })
  ok('unsorted booking dates stop the import',
     has(parseDkbUmsatzexport(unsorted), 'date_order_not_monotonic'))

  // Ascending order is a sort direction, not a defect.
  const ascending = buildDocument({
    pages: [[
      cardBooking('07.09.2026', '-1.00', 'REWE', '04.09.2026'),
      cardBooking('09.09.2026', '-3.00', 'REWE', '04.09.2026'),
      cardBooking('14.09.2026', '-2.00', 'EDEKA', '04.09.2026'),
    ]],
  })
  ok('an export sorted the other way round is still valid', parseDkbUmsatzexport(ascending).ok === true)
}

// ── 8. A broken word may never become a merchant pattern ────────────────────
{
  const raw = '1052906804694/PP.8169.PP/. Department of Home A' + REPLACEMENT_CHARACTER + 'airs, Ihr'
  const unreliable = unreliableTokens(raw)
  ok('the fragments of the broken word are unreliable',
     unreliable.includes('A') && unreliable.includes('AIRS'))
  ok('the readable words of the same booking are not',
     !unreliable.includes('DEPARTMENT') && !unreliable.includes('HOME'))
  ok('a clean description has no unreliable tokens', unreliableTokens('REWE TROISDORF 8407').length === 0)
  ok('a non-string is handled', unreliableTokens(null).length === 0)

  const transaction = { id: 't1', raw_description: raw, normalized_tokens: tokenize(raw), currency: 'EUR' }
  const broken = buildLearnRequest({
    transaction,
    selection: 'AIRS',
    categorySlug: 'sonstige',
    merchantName: 'Department of Home Affairs',
  })
  ok('learning a pattern from the broken word is refused', broken.valid === false)
  ok('…with a reason the screen can show',
     broken.errors.some((e) => e.code === 'selection_unmapped_glyph'))

  const fine = buildLearnRequest({
    transaction,
    selection: 'DEPARTMENT',
    categorySlug: 'sonstige',
    merchantName: 'Department of Home Affairs',
  })
  ok('the rest of the same booking can still teach a pattern', fine.valid === true)
  ok('…and the tokens are unchanged', JSON.stringify(fine.tokens) === JSON.stringify(['DEPARTMENT']))
}

// ── 9. The gaps a review found: silence is the failure mode to hunt ─────────
{
  // Content below the table band belonged to no block, no header and no footer,
  // and vanished without a word — with the count check none the wiser, because
  // the booking still had its date and its amount.
  const lowLine = singleBookingDocument()
  lowLine.pages[0].items.push({ str: 'Verlorene Zeile', x: 155, y: 90, width: 60, fontSize: 8 })
  const lowLineResult = parseDkbUmsatzexport(lowLine)
  ok('content below the table band stops the import', lowLineResult.ok === false)
  ok('…as an orphan', has(lowLineResult, 'orphan_item'))
  ok('…and never reaches a booking', lowLineResult.transactions.length === 0)

  // A third font size is either an unknown layout or content that would have
  // been folded into a description unnoticed.
  const oddSize = singleBookingDocument()
  oddSize.pages[0].items.push({ str: 'Fremdes', x: 155, y: 470, width: 30, fontSize: 11 })
  ok('an unknown font size stops the import', has(parseDkbUmsatzexport(oddSize), 'orphan_item'))

  // An item without usable coordinates compares false against every boundary,
  // so without an explicit check it would fall through in silence.
  const noCoords = singleBookingDocument()
  noCoords.pages[0].items.push({ str: 'Ohne Position', width: 30, fontSize: 8 })
  const noCoordsResult = parseDkbUmsatzexport(noCoords)
  ok('an item without coordinates stops the import', noCoordsResult.ok === false)
  ok('…with the reason named', has(noCoordsResult, 'item_coordinates_invalid'))
}

// ── 10. Only what touches the missing character is unusable ─────────────────
{
  const damaged = 'EDEKA/Charlo' + REPLACEMENT_CHARACTER + 'enburg'
  const marked = unreliableTokens(damaged)
  ok('the fragments either side of the gap are marked',
     marked.includes('CHARLO') && marked.includes('ENBURG'))
  ok('a readable merchant in the same word is NOT condemned with them',
     !marked.includes('EDEKA'))
  ok('…so that booking can still teach its merchant',
     buildLearnRequest({
       transaction: { id: 't', raw_description: damaged, normalized_tokens: tokenize(damaged), currency: 'EUR' },
       selection: 'EDEKA', categorySlug: 'lebensmittel', merchantName: 'EDEKA',
     }).valid === true)

  const besideSeparator = 'REWE ' + REPLACEMENT_CHARACTER + ' MARKT'
  ok('a gap next to a separator damages no token', unreliableTokens(besideSeparator).length === 0)

  // Without the original text the check cannot run at all — and a guard that
  // cannot run must refuse, not wave things through.
  const tokensOnly = { id: 't', normalized_tokens: ['REWE'], currency: 'EUR' }
  const withoutText = buildLearnRequest({
    transaction: tokensOnly, selection: 'REWE', categorySlug: 'lebensmittel', merchantName: 'REWE',
  })
  ok('a booking loaded without its text cannot teach a pattern', withoutText.valid === false)
  ok('…with the reason named',
     withoutText.errors.some((e) => e.code === 'description_unavailable'))
}

// ── 11. The adapter: what it must release, and what it must not consume ─────
{
  const calls = { destroy: 0, cleanup: 0, data: null }
  const fakeGetDocument = (options) => {
    calls.data = options.data
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 597, height: 842 }),
          getTextContent: async () => ({
            items: [{ str: '14.09.2026', transform: [8, 0, 0, 8, 73, 484], width: 36.67 }],
          }),
          cleanup: () => { calls.cleanup += 1 },
        }),
        destroy: async () => { calls.destroy += 1 },
      }),
    }
  }

  const original = new Uint8Array([1, 2, 3, 4])
  const doc = await extractPdfTextDocument(original, { getDocument: fakeGetDocument })
  ok('the adapter returns the page shape the parser expects',
     doc.pages.length === 1 && doc.pages[0].number === 1 && doc.pages[0].items.length === 1)
  ok('the font size comes from the transform, which is what separates content from footer',
     doc.pages[0].items[0].fontSize === 8)
  ok('the position comes from the transform',
     doc.pages[0].items[0].x === 73 && doc.pages[0].items[0].y === 484)
  ok('the document is released', calls.destroy === 1)
  ok('every page is released', calls.cleanup === 1)
  ok('the caller keeps its buffer — a refused import has to be retryable',
     original.byteLength === 4 && calls.data !== original)

  const failing = () => ({ promise: Promise.reject(new Error('kaputt')) })
  let threw = false
  try {
    await extractPdfTextDocument(new Uint8Array([1]), { getDocument: failing })
  } catch {
    threw = true
  }
  ok('a broken file still reaches the caller as an error', threw === true)
}

console.log(\`dkb parser: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'dkbParserLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/dkbParserLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
