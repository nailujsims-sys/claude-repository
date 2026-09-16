// Text items back into lines — the step that is easy to get wrong once and then
// wrong forever, because the mistake looks like a rendering detail and lands in
// a frozen raw_description.
//
// PDF.js returns items in drawing order, not reading order, and a single
// printed line arrives as several items. The trap the real file sets: the
// spaces BETWEEN words are their own items, carrying the string " ". Filtering
// out "items without visible content" — the obvious first move — produces
//
//     "oePA VerkehrsgesellschTroisdorfDE"
//
// where the document says
//
//     "oePA Verkehrsgesellsch Troisdorf DE"
//
// Measured on the real export: of the 15 transitions between items of one line,
// 13 are exactly gapless (next x === previous x + width) and 2 sit below 1 pt
// of kerning, once slightly negative. So plain concatenation in x order
// reproduces the line exactly, and inserting spaces derived from x gaps would
// be inventing characters. Items are therefore kept as they are — including the
// whitespace-only ones — sorted by x, and joined with nothing between them.

/**
 * Group the items of one page into lines.
 *
 * Items on the same printed line share their y coordinate exactly: they come
 * from one text-showing operation with one transform. No tolerance band is
 * used, because introducing one would merge the 11 pt line spacing of a
 * multi-line description at the first font change.
 *
 * @param {Array<{str: string, x: number, y: number, width: number}>} items
 * @returns {Array<{y: number, items: Array<object>}>} lines, top-most first
 */
export function groupIntoLines(items) {
  const byY = new Map()
  for (const item of items) {
    const bucket = byY.get(item.y)
    if (bucket) bucket.push(item)
    else byY.set(item.y, [item])
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, group]) => ({ y, items: [...group].sort((a, b) => a.x - b.x) }))
}

/**
 * The printed text of one line, or of the part of it inside an x window.
 *
 * Verbatim: the strings are concatenated in x order and nothing is trimmed,
 * collapsed, or inserted. What comes out is what the document shows.
 *
 * @param {{items: Array<{str: string, x: number}>}} line
 * @param {{from?: number, to?: number}} [window] inclusive from, exclusive to
 * @returns {string}
 */
export function lineText(line, { from = -Infinity, to = Infinity } = {}) {
  return line.items
    .filter((item) => item.x >= from && item.x < to)
    .map((item) => item.str)
    .join('')
}

/**
 * The items of one line inside an x window, in reading order.
 *
 * @param {{items: Array<object>}} line
 * @param {{from?: number, to?: number}} [window]
 * @returns {Array<object>}
 */
export const lineItems = (line, { from = -Infinity, to = Infinity } = {}) =>
  line.items.filter((item) => item.x >= from && item.x < to)

/** Has this line any ink at all? A line of pure spacing items has not. */
export const isBlank = (line) => lineText(line).trim() === ''

/**
 * Adjacent items of one line, joined back into the runs they were printed as.
 *
 * WHY THIS IS NEEDED. pdfjs decides for itself where one text item ends and the
 * next begins, and that decision is not part of the document — it is a
 * heuristic over glyph advances that can differ between pdfjs versions, between
 * fonts, and between two files that print the same words. Measured on a
 * generated PDF of the very same layout (tools/fixtures/dkbPdf.mjs), the page
 * label the real export delivers as one item "Seite 1 von 3" arrived as three:
 * "Seite", " ", "1 von 3".
 *
 * The table band never cared: it reads whole lines through `lineText`. The
 * header did, because it tests its patterns against single items — so a
 * different chunking of the same page turned every header fact into "missing"
 * and refused an import that was perfectly readable.
 *
 * So the header reads runs instead of items. A run is what the eye sees as one
 * piece of text: items that touch (the real export is gapless to within a point
 * of kerning — see above), including the narrow whitespace items that carry the
 * spaces between words. A WIDE whitespace item is not a space, it is the gap to
 * the next column — "Auszug" and the issue date share a baseline and must stay
 * two facts — so it ends the run instead of joining it.
 *
 * Nothing is invented: the run's text is its items concatenated, and every run
 * keeps its `parts` so an unrecognised one can still be reported at the
 * coordinates it was printed at.
 *
 * @param {Array<{str: string, x: number, y: number, width: number, fontSize: number}>} items
 * @returns {Array<{str: string, x: number, y: number, width: number, fontSize: number, parts: Array<object>}>}
 */
export function mergeAdjacent(items) {
  const KERNING = 1.5 // measured: 13 of 15 transitions gapless, 2 below 1 pt
  const COLUMN_GAP = 2.5 // × font size — wider whitespace separates columns
  const sorted = [...items].sort((a, b) => a.x - b.x)
  const runs = []
  let current = null
  for (const item of sorted) {
    const isWideSpace =
      item.str.trim() === '' && item.width > item.fontSize * COLUMN_GAP
    const touches =
      current &&
      current.fontSize === item.fontSize &&
      Math.abs(item.x - (current.x + current.width)) <= KERNING
    if (isWideSpace || !touches) {
      current = isWideSpace
        ? null
        : { str: item.str, x: item.x, y: item.y, width: item.width, fontSize: item.fontSize, parts: [item] }
      if (current) runs.push(current)
      continue
    }
    current.str += item.str
    current.width = item.x + item.width - current.x
    current.parts.push(item)
  }
  return runs
}
