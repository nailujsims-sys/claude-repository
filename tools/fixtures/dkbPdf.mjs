// A real PDF file, built from the measured geometry.
//
// WHY THIS EXISTS. Everything else in this folder describes the export at the
// level pdfjs reports it: items with a string, an x, a y and a width. That is
// the right level for testing the parser, and it is how the layout of the real
// statement was measured. But it leaves exactly one link of the chain
// unexercised — the one that turns bytes a person picked in a file dialog into
// those items. A test that starts from item literals cannot fail if pdfjs
// reports something the parser has never seen.
//
// So this module writes an actual PDF: the same page size, the same columns,
// the same blocks, encoded as content streams that any PDF reader can open. The
// test then hands the bytes to the real `readStatementFile` with the real pdfjs
// behind it, and the parser is fed whatever pdfjs makes of them.
//
// The one thing that cannot be copied over is the font. The measurement was
// taken from a document set in the bank's own font; a self-contained fixture
// cannot embed it, so the text is set in Courier, one of the fourteen fonts
// every reader has. Courier is monospaced, which makes the advance width exact
// and knowable here (600/1000 em) instead of a table of guesses. The columns —
// the only geometry the parser actually reads — stay where they were measured:
// each run of items keeps its starting x, and the amount column stays
// right-aligned to 523.5.

const COURIER_ADVANCE = 0.6 // 600/1000 em, the whole font
const AMOUNT_RIGHT = 523.5

const advance = (text, size) => text.length * COURIER_ADVANCE * size

/**
 * Split a line of items into contiguous runs.
 *
 * The fixture emits the spaces between words as items of their own, laid out at
 * the character width it was measured with. Re-flowing a run from its first x
 * with Courier's advance keeps the words in order and non-overlapping, while a
 * gap — the footer's columns, the space between the date and the description —
 * starts a new run and keeps its own x.
 */
function runsOf(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const runs = []
  let current = null
  for (const it of sorted) {
    const continues =
      current &&
      Math.abs(current.y - it.y) < 0.01 &&
      Math.abs(it.x - (current.endX ?? 0)) < 0.5 &&
      current.size === it.fontSize
    if (!continues) {
      current = { y: it.y, x: it.x, size: it.fontSize, text: '', endX: it.x }
      runs.push(current)
    }
    current.text += it.str
    current.endX = it.x + it.width
  }
  return runs
}

const LATIN1 = new Map([
  ['ä', 0xe4], ['ö', 0xf6], ['ü', 0xfc], ['Ä', 0xc4], ['Ö', 0xd6], ['Ü', 0xdc],
  ['ß', 0xdf], ['é', 0xe9], ['è', 0xe8], ['à', 0xe0], ['ç', 0xe7], ['°', 0xb0],
  ['„', 0x22], ['"', 0x22], ['–', 0x2d], ['—', 0x2d],
])

/** WinAnsi bytes, with the characters a PDF string has to escape escaped. */
function pdfString(text) {
  const out = []
  for (const ch of text) {
    const code = LATIN1.get(ch) ?? ch.codePointAt(0)
    const byte = code > 0xff ? 0x3f : code // '?' for anything WinAnsi has no slot for
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c)
    out.push(byte)
  }
  return Uint8Array.from(out)
}

function contentStream(page) {
  const parts = []
  const push = (s) => parts.push(Uint8Array.from([...s].map((c) => c.charCodeAt(0))))
  for (const run of runsOf(page.items)) {
    if (run.text.trim() === '') continue
    const x = Math.abs(run.endX - AMOUNT_RIGHT) < 0.5
      ? AMOUNT_RIGHT - advance(run.text, run.size)
      : run.x
    push(`BT /F1 ${run.size} Tf 1 0 0 1 ${x.toFixed(2)} ${run.y.toFixed(2)} Tm (`)
    parts.push(pdfString(run.text))
    push(') Tj ET\n')
  }
  let length = 0
  for (const p of parts) length += p.length
  const bytes = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return bytes
}

const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

/**
 * Write a document (the shape `buildDocument` returns) as PDF bytes.
 *
 * @param {{pages: Array<{number: number, width: number, height: number, items: Array}>}} document
 * @returns {Uint8Array}
 */
export function buildPdfBytes(document) {
  const pages = document.pages
  // 1 catalog · 2 pages · 3 font · then, per page, the page and its stream.
  const pageObj = (i) => 4 + i * 2
  const streamObj = (i) => 5 + i * 2

  const objects = []
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = ascii(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages
      .map((_, i) => `${pageObj(i)} 0 R`)
      .join(' ')}] >>`
  )
  objects[3] = ascii(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'
  )
  pages.forEach((page, i) => {
    objects[pageObj(i)] = ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObj(i)} 0 R >>`
    )
    const body = contentStream(page)
    const head = ascii(`<< /Length ${body.length} >>\nstream\n`)
    const tail = ascii('\nendstream')
    const whole = new Uint8Array(head.length + body.length + tail.length)
    whole.set(head, 0)
    whole.set(body, head.length)
    whole.set(tail, head.length + body.length)
    objects[streamObj(i)] = whole
  })

  const chunks = [ascii('%PDF-1.4\n')]
  let offset = chunks[0].length
  const offsets = []
  for (let n = 1; n < objects.length; n += 1) {
    offsets[n] = offset
    const head = ascii(`${n} 0 obj\n`)
    const tail = ascii('\nendobj\n')
    chunks.push(head, objects[n], tail)
    offset += head.length + objects[n].length + tail.length
  }

  const count = objects.length
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  chunks.push(ascii(xref))

  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** The File the picker would have handed us, without a browser. */
export function asPickedFile(bytes, name = 'Umsatzexport.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  }
}
