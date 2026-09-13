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
