// The one place that touches PDF.js.
//
// Everything else in this folder is pure and testable against fixtures; this
// adapter turns a file the user picked into the document shape the parser
// expects, and does nothing else — no filtering, no cleaning, no interpreting.
// Whatever pdfjs reports is handed on, including the whitespace-only items that
// carry the spaces between words (see lines.js for why that matters).
//
// The extraction runs in the browser, on the user's device: a bank statement
// has no business being uploaded anywhere, and the parser needs no server.
//
// pdfjs is loaded with a dynamic import so it stays out of the main bundle
// until somebody actually opens an import screen.

/**
 * The shape the parser consumes. Kept deliberately small and free of pdfjs
 * types, so a fixture is an ordinary object literal.
 *
 * @typedef {{str: string, x: number, y: number, width: number, fontSize: number}} PdfTextItem
 * @typedef {{number: number, width: number, height: number, items: PdfTextItem[]}} PdfTextPage
 * @typedef {{pages: PdfTextPage[]}} PdfTextDocument
 */

/**
 * Extract the text layer of a PDF.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{getDocument?: Function}} [deps] injection point for tests
 * @returns {Promise<PdfTextDocument>}
 */
export async function extractPdfTextDocument(data, deps = {}) {
  const getDocument = deps.getDocument ?? (await import('pdfjs-dist')).getDocument
  const doc = await getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    // A statement must never pull anything off the network while being read.
    isEvalSupported: false,
  }).promise

  const pages = []
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    pages.push({
      number,
      width: viewport.width,
      height: viewport.height,
      items: content.items
        .filter((item) => typeof item?.str === 'string')
        .map((item) => ({
          str: item.str,
          // transform = [a, b, c, d, e, f]; e/f are the position, d the scale
          // the font is drawn at — which is what distinguishes the 8 pt content
          // from the 7 pt legal footer.
          x: item.transform[4],
          y: item.transform[5],
          width: item.width ?? 0,
          fontSize: item.transform[3],
        })),
    })
  }
  return { pages }
}
