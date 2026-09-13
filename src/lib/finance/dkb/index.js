// The DKB Umsatzexport importer, stage 1: read the file, or refuse it.
//
// What this folder does NOT contain, on purpose:
//   • no cross-import dedupe rule — see fingerprint.js for why it waits for a
//     second, overlapping export
//   • no treatment of the timestamped card variant as anything but a marker
//   • no screen, no route, no persistence — the pipeline ends at a parsed,
//     validated list of bookings

export { parseDkbUmsatzexport, SOURCE_VARIANTS } from './parse'
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
