// The DKB Umsatzexport importer, stage 1: read the file, or refuse it.
//
// What this folder does NOT contain, on purpose:
//   • no screen, no route, no persistence — the pipeline ends at a parsed and
//     validated list of bookings plus a reconciliation plan a human confirms
//   • no automatic 1:1 link where the documents do not prove one
//   • no write that would overwrite an original text or a manual decision

export { parseDkbUmsatzexport, SOURCE_VARIANTS } from './parse'
export { extractReference, REFERENCE_FORMS } from './reference'
export { reconcileImport, bookingFacts, OUTCOMES } from './reconcile'
export { buildApplyPayload } from './plan'
export { extractPdfTextDocument } from './extract'
export { parseAmountMinor, parseGermanDate } from './amount'
export { REPLACEMENT_CHARACTER, hasUnmappedGlyph, sanitizeGlyphs } from './glyphs'
export { groupIntoLines, lineText } from './lines'
export {
  FINGERPRINT_CANDIDATES,
  fingerprintComponents,
  fingerprintReport,
  indistinguishable,
} from './fingerprint'
