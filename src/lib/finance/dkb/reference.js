// The reference DKB prints on a booking — recognised by its POSITION, never by
// the length of a digit run.
//
// Measured across both real exports, exactly three shapes occur:
//
//   DB.Vertrieb.GmbH/846301403175          first line, digits after the slash
//   DB Vertrieb GmbH 564851284265 DE       first line, digits before a " DE"
//   1052983361139/. Use AI, Ihr Einkauf…   a later line, digits before a slash
//
// A naive `\d{8,}` sweep looks equivalent and is not. On the real files it also
// collects `15697680` and `15832360` — fragments of the exchange rate
// "1,15697680" — and `20260914132522`, which is a timestamp, not a reference.
// Each of those would become a false identity for a booking, which is the one
// mistake this module exists to avoid.
//
// WHAT THIS REFERENCE IS, AND WHAT IT IS NOT. It is the merchant's own booking
// reference, and the second export proves what it means: `564851284265` sits on
// the −50,05 € purchase of 10.09. AND on the +50,05 € refund of 14.09. It is
// therefore evidence that two bookings BELONG TOGETHER — and never a unique
// transaction id. Within one export it is not even unique (7 of 8 in export B).
// Every use of it in reconcile.js is combined with date and amount for exactly
// that reason.

/** "DB.Vertrieb.GmbH/846301403175" — the settled card booking. */
const AFTER_SLASH = /^(?:.*[^\d\s])\/(\d{10,})$/

/** "DB Vertrieb GmbH 564851284265 DE" — the announcement form. */
const BEFORE_DE = /^(?:.*\S)\s(\d{10,})\sDE$/

/** "1052983361139/. Use AI, …" — PayPal, on a line of its own. */
const PAYPAL = /^(\d{10,})\//

export const REFERENCE_FORMS = ['merchant_slash', 'merchant_de', 'paypal']

/**
 * The reference of one booking, or null.
 *
 * @param {string} rawDescription
 * @returns {{reference: string, form: string}|null}
 */
export function extractReference(rawDescription) {
  if (typeof rawDescription !== 'string' || rawDescription === '') return null
  const lines = rawDescription.split('\n')

  const first = lines[0] ?? ''
  const slash = AFTER_SLASH.exec(first)
  if (slash) return { reference: slash[1], form: 'merchant_slash' }
  const de = BEFORE_DE.exec(first)
  if (de) return { reference: de[1], form: 'merchant_de' }

  for (const line of lines.slice(1)) {
    const paypal = PAYPAL.exec(line)
    if (paypal) return { reference: paypal[1], form: 'paypal' }
  }
  return null
}
