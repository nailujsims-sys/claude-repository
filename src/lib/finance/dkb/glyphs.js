// Characters the PDF does not encode.
//
// The real export contains glyphs whose ToUnicode table maps them to U+0000 —
// verifiably, in the file itself:
//
//     106 0 obj  <</Filter /FlateDecode /Length 229>>
//     beginbfchar
//       <0B> <0000>
//       <15> <0000>
//     endbfchar
//
// Those two glyphs are the ligatures in "A[ff]airs" and "Charlo[tt]enburg". The
// characters behind them are NOT in the document: PDF.js reads the file
// correctly, the file is what is incomplete. Recovering them would mean
// rendering the glyph and recognising its shape — OCR, which is out of scope —
// and a fixed lookup table cannot help either, because the glyph codes of a
// subset font differ from document to document.
//
// So the parser does the only honest thing: it marks the position instead of
// filling it in. U+0000 becomes U+FFFD (the Unicode replacement character,
// "�"), which is also a hard requirement rather than a preference — PostgreSQL
// text columns cannot store a NUL byte at all, so a raw_description carrying
// one could never be written.
//
// Every replacement raises a structured warning with page, coordinates and the
// surrounding text, so the import preview can show exactly which booking is
// affected and the user can judge it. Nothing is guessed, nothing is silently
// dropped.

/** U+FFFD. What the parser writes where the document encodes nothing. */
export const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)

/** U+0000. What the document delivers for an unmapped glyph. */
const UNMAPPED = String.fromCharCode(0)

/**
 * Replace every unmapped glyph in one text item.
 *
 * @param {unknown} value
 * @returns {{text: string, replaced: number}}
 */
export function sanitizeGlyphs(value) {
  if (typeof value !== 'string') return { text: '', replaced: 0 }
  if (!value.includes(UNMAPPED)) return { text: value, replaced: 0 }
  let replaced = 0
  let text = ''
  for (const char of value) {
    if (char === UNMAPPED) {
      replaced += 1
      text += REPLACEMENT_CHARACTER
    } else {
      text += char
    }
  }
  return { text, replaced }
}

/**
 * Does this text contain a position the document did not encode?
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const hasUnmappedGlyph = (value) =>
  typeof value === 'string' && value.includes(REPLACEMENT_CHARACTER)

/**
 * The warning one affected item produces. `context` is the item's own text,
 * already sanitised — enough for a preview to show the word in question without
 * the caller having to go back to the PDF.
 *
 * @param {{page: number, x: number, y: number, text: string, replaced: number}} item
 * @returns {{code: string, message: string, page: number, x: number, y: number, context: string, count: number}}
 */
export const unmappedGlyphWarning = ({ page, x, y, text, replaced }) => ({
  code: 'unmapped_glyph',
  message:
    `Die Datei kodiert ${replaced === 1 ? 'ein Zeichen' : `${replaced} Zeichen`} an dieser ` +
    `Stelle nicht; ${replaced === 1 ? 'es wurde' : 'sie wurden'} durch „${REPLACEMENT_CHARACTER}" ersetzt.`,
  page,
  x,
  y,
  context: text,
  count: replaced,
})
