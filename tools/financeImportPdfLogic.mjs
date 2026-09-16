// The last unproven link: a real PDF file.
//
// tools/financeImportFlowLogic.mjs drives the whole import flow, but it injects
// `extract` — because pdfjs wants a browser, and because the real statement is
// a bank document that must never live in this repository. That leaves one
// piece of the chain covered by nothing: the step that turns the bytes a person
// picked in a file dialog into the items the parser reads.
//
// So this suite writes an actual PDF (tools/fixtures/dkbPdf.mjs — the measured
// geometry of the real export, encoded as content streams), hands the bytes to
// the real `readStatementFile`, and lets the REAL pdfjs open them. Nothing
// about the reading path is stubbed: real bytes, real PDF parsing, real text
// layer, real parser, real matcher, real payload.
//
// What this cannot prove — and what therefore still has to be checked at the
// first productive import — is the bank's own font and any glyph mapping that
// comes with it. The fixture is set in Courier, because a self-contained test
// cannot embed a licensed font. Everything the parser actually reads (columns,
// baselines, right-aligned amounts, page structure) is the measured original.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'

const TEST = `
import { extractPdfTextDocument } from './src/lib/finance/dkb/extract.js'
import { parseDkbUmsatzexport } from './src/lib/finance/dkb/parse.js'
import { buildPayload, buildPlan, previewRows, readStatementFile, summarizePlan, describeParseFailure }
  from './src/lib/finance/importFlow.js'
import {
  buildDocument, REFERENCE_PAGES, SECOND_EXPORT_PAGES,
  referenceDocument, secondExportDocument, scannedDocument, foreignDocument,
} from './tools/fixtures/dkbUmsatzexport.mjs'
import { buildPdfBytes, asPickedFile } from './tools/fixtures/dkbPdf.mjs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const ACCOUNT = '11111111-2222-4333-8444-000000000002'
const uuid = (n) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0')

// The real reading path: no injected extract, only the real pdfjs behind it.
// (\`workerSrc\` is a bundler concern — under Node pdfjs runs on the main thread,
// which is why the entry point is handed in instead of resolved by URL.)
const read = (bytes, name) =>
  readStatementFile(asPickedFile(bytes, name), {
    extract: (data) => extractPdfTextDocument(data, { getDocument: (options) => pdfjs.getDocument({ ...options, verbosity: 0 }) }),
  })

const key = (t) => \`\${t.booking_date}|\${t.amount_minor}|\${t.currency}|\${t.raw_description}\`

// ── 1. A real PDF file, opened by the real pdfjs ────────────────────────────
{
  const bytes = buildPdfBytes(referenceDocument())
  ok('the fixture really is a PDF file',
     String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-' && bytes.length > 2000)

  const document = await extractPdfTextDocument(bytes, { getDocument: (options) => pdfjs.getDocument({ ...options, verbosity: 0 }) })
  ok('pdfjs opens it and reports both pages', document.pages.length === REFERENCE_PAGES.length)
  ok('…with the page geometry the parser measures against',
     document.pages[0].width === 597 && document.pages[0].height === 842)
  ok('…and a text layer', document.pages[0].items.length > 40)
  ok('…whose items carry the shape the parser expects', document.pages[0].items.every(
     (i) => typeof i.str === 'string' && Number.isFinite(i.x) && Number.isFinite(i.y) &&
            Number.isFinite(i.width) && Number.isFinite(i.fontSize)))
}

// ── 2. The parser reads the real file exactly as it reads the fixture ───────
//
// This is the assertion the whole suite exists for. The fixture path and the
// PDF path must not merely both "work" — they must produce the same bookings,
// or the parser has been tested against a document that does not exist.
{
  const fixture = parseDkbUmsatzexport(referenceDocument())
  const real = parseDkbUmsatzexport(
    await extractPdfTextDocument(buildPdfBytes(referenceDocument()), { getDocument: (options) => pdfjs.getDocument({ ...options, verbosity: 0 }) })
  )

  ok('the real PDF parses', real.ok === true)
  ok('…with no errors', (real.errors ?? []).length === 0)
  ok('…and the same number of bookings as the fixture',
     real.transactions.length === fixture.transactions.length)
  ok('…the same period', real.header.period_start === fixture.header.period_start &&
     real.header.period_end === fixture.header.period_end)
  ok('…the same declared count', real.header.declared_count === fixture.header.declared_count)
  // The one character a generated PDF cannot reproduce. The fixture carries a
  // deliberately unmappable glyph — the parser replaces it with "\uFFFD" and
  // warns — and a file can only produce one through a font whose ToUnicode
  // table is broken, which a fixture built from the fourteen standard fonts has
  // no way to forge. It is compared as the space the encoder writes for it;
  // every other character is compared exactly.
  const comparable = (t) => key(t).replaceAll('\uFFFD', ' ')
  ok('…and every booking identical, in order',
     real.transactions.map(comparable).join('\\n') === fixture.transactions.map(comparable).join('\\n'))
  ok('…including the fingerprints the matcher keys on',
     real.transactions.every((t, i) =>
       comparable(t) !== comparable(fixture.transactions[i]) ||
       t.fingerprint === fixture.transactions[i].fingerprint))
  ok('…and the references it pulls out of the text',
     real.transactions.every((t, i) =>
       (t.external_reference ?? null) === (fixture.transactions[i].external_reference ?? null)))
}

// ── 3. The whole flow, starting from bytes ──────────────────────────────────
{
  const bytes = buildPdfBytes(referenceDocument())
  const { hash, result } = await read(bytes, 'Umsatzexport.pdf')

  ok('a real file gets a real 64-character hash', typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
  const again = await read(buildPdfBytes(referenceDocument()), 'Umsatzexport.pdf')
  ok('the same export hashes the same twice', again.hash === hash)
  ok('reading the file does not consume it — it parses the second time too', again.result.ok === true)

  const plan = buildPlan({ parsed: result, existing: [], accountId: ACCOUNT })
  const totals = summarizePlan(plan)
  ok('a first import of a real file is all new', totals.neu === result.transactions.length)
  ok('…and nothing needs review', totals.pruefen === 0)

  const rows = previewRows(result.transactions, plan)
  ok('the preview has a row per booking', rows.length === result.transactions.length)
  ok('…and every row is readable', rows.every(
     (r) => r.title.length > 0 && /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(r.date) && r.amount.includes('€')))

  const payload = buildPayload({ importId: uuid(1), accountId: ACCOUNT, parsed: result, plan })
  ok('…and the payload carries exactly those bookings',
     payload.bookings.length === result.transactions.length)
  // The file itself never leaves the device: not the bytes, not the name.
  const wire = JSON.stringify(payload)
  ok('no PDF bytes are in the payload', !wire.includes('%PDF'))
  ok('no file name is in the payload', !wire.includes('Umsatzexport.pdf'))
}

// ── 4. Two real files in sequence ───────────────────────────────────────────
//
// The second export overlaps the first. Driven from bytes, the matcher has to
// reach the same conclusion it reaches from the fixtures — otherwise the
// reconciliation is only correct on data that never came out of a PDF.
{
  const first = await read(buildPdfBytes(referenceDocument()), 'export-1.pdf')
  const second = await read(buildPdfBytes(secondExportDocument()), 'export-2.pdf')
  ok('the second export parses from a real file too', second.result.ok === true)

  const stored = first.result.transactions.map((t, i) => ({
    id: uuid(100 + i), account_id: ACCOUNT, booking_date: t.booking_date,
    amount_minor: t.amount_minor, currency: t.currency,
    raw_description: t.raw_description, manual_lock: false,
  }))

  const fromPdf = summarizePlan(buildPlan({ parsed: second.result, existing: stored, accountId: ACCOUNT }))
  const fixtureStored = parseDkbUmsatzexport(referenceDocument()).transactions.map((t, i) => ({
    id: uuid(100 + i), account_id: ACCOUNT, booking_date: t.booking_date,
    amount_minor: t.amount_minor, currency: t.currency,
    raw_description: t.raw_description, manual_lock: false,
  }))
  const fromFixture = summarizePlan(buildPlan({
    parsed: parseDkbUmsatzexport(secondExportDocument()), existing: fixtureStored, accountId: ACCOUNT,
  }))

  ok('the real files reconcile exactly as the fixtures do',
     JSON.stringify(fromPdf) === JSON.stringify(fromFixture))
  ok('…and the overlap is recognised rather than imported twice', fromPdf.vorhanden > 0)
  ok('…while the genuinely new bookings are kept', fromPdf.neu > 0)
}

// ── 5. The same real file twice ─────────────────────────────────────────────
{
  const a = await read(buildPdfBytes(referenceDocument()), 'export.pdf')
  const stored = a.result.transactions.map((t, i) => ({
    id: uuid(200 + i), account_id: ACCOUNT, booking_date: t.booking_date,
    amount_minor: t.amount_minor, currency: t.currency,
    raw_description: t.raw_description, manual_lock: false,
  }))
  const again = summarizePlan(buildPlan({ parsed: a.result, existing: stored, accountId: ACCOUNT }))
  ok('re-importing the identical file adds nothing', again.neu === 0 && again.ersetzt === 0)
  ok('…and says so instead of finding conflicts', again.vorhanden === a.result.transactions.length)
}

// ── 6. Real files that must be refused ──────────────────────────────────────
{
  const scan = await read(buildPdfBytes(scannedDocument()), 'scan.pdf')
  ok('a real PDF without a text layer is refused', scan.result.ok === false)
  ok('…in words a person can act on',
     describeParseFailure(scan.result).headline.includes('keinen auslesbaren Text'))
  ok('…and it is still hashed, so the refusal is reproducible', /^[0-9a-f]{64}$/.test(scan.hash))

  const foreign = await read(buildPdfBytes(foreignDocument()), 'fremd.pdf')
  ok('a real PDF that is not a DKB export is refused', foreign.result.ok === false)

  const notAPdf = {
    name: 'notiz.txt', arrayBuffer: async () => new TextEncoder().encode('kein PDF').buffer,
  }
  let refused = false
  try {
    const r = await read(new TextEncoder().encode('kein PDF'), 'notiz.txt')
    refused = r.result.ok === false
  } catch { refused = true }
  ok('something that is not a PDF at all never reaches the parser as data', refused)
  void notAPdf
}

// ── 7. A statement with a booking count the file itself contradicts ─────────
{
  const doc = buildDocument({ pages: REFERENCE_PAGES, declaredCount: 99 })
  const wrong = await read(buildPdfBytes(doc), 'falsch.pdf')
  ok('a real file whose declared count does not match is refused', wrong.result.ok === false)
  ok('…rather than importing a partial statement',
     (wrong.result.transactions ?? []).length === 0 || wrong.result.ok === false)
  void SECOND_EXPORT_PAGES
}

console.log(\`finance import pdf: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeImportPdfLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  // pdfjs stays external and is resolved from the repository, which is also why
  // the bundle is written inside it rather than into a temp directory.
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: {
    'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }),
  },
  write: false,
  logLevel: 'silent',
})

if (!globalThis.crypto) globalThis.crypto = webcrypto

const dir = `${process.cwd()}/node_modules/.cache`
mkdirSync(dir, { recursive: true })
const out = `${dir}/financeImportPdfLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
