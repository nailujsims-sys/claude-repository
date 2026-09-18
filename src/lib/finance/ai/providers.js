import { transactionTokens } from '../normalize'

// Zahlungsdienstleister — die Namen, die auf einem Kontoauszug stehen, wo man
// den Händler erwartet.
//
// „PAYPAL .Zalando SE" ist kein Einkauf bei PayPal. „KLARNA" ist kein Händler.
// Für einen Menschen ist das offensichtlich; für ein Sprachmodell, das eine
// Zeile Text sieht, ist es der wahrscheinlichste Fehler überhaupt — und zwar
// einer, der sich systematisch wiederholt und jede spätere Auswertung verzerrt,
// weil plötzlich der halbe Monat bei „PayPal" gekauft wurde.
//
// Deshalb steht die Liste im Prompt: nicht als Verbot, sondern als Hinweis, wo
// der echte Händler zu suchen ist — nämlich hinter dem Dienstleister, im
// selben Text.
//
// WARUM HIER UND NICHT IN src/config/finance.js: dort steht die Sprache des
// Moduls, und jeder Eintrag dort hat ein Gegenstück in der Datenbank, das
// tools/financeLogic.mjs abgleicht. Diese Liste hat keines — sie ist Wissen
// über die Welt, kein Wert, den eine Spalte annehmen kann.

/**
 * Die bekannten Dienstleister, als Tokens, wie der Normalisierer sie erzeugt.
 * Groß geschrieben, damit der Vergleich gegen `normalized_tokens` direkt geht.
 */
export const PAYMENT_SERVICE_PROVIDERS = Object.freeze([
  'PAYPAL',
  'KLARNA',
  'SUMUP',
  'IZETTLE',
  'ZETTLE',
  'STRIPE',
  'ADYEN',
  'MOLLIE',
  'SHOPIFY',
  'UNZER',
  'RATEPAY',
  'PAYONE',
  'CONCARDIS',
  'NEXI',
  'WERO',
  'AMAZONPAY',
  'GOOGLEPAY',
  'APPLEPAY',
  'SOFORT',
  'GIROPAY',
])

/**
 * Die Dienstleister, die in den eigenen Buchungen tatsächlich vorkommen.
 *
 * „soweit bereits bekannt" aus der Vorgabe heißt genau das: nicht die ganze
 * Liste in den Prompt kippen, sondern zuerst das nennen, was in diesem Konto
 * schon aufgetaucht ist. Der Rest steht trotzdem darunter — ein Dienstleister,
 * der heute zum ersten Mal auftaucht, soll nicht deshalb als Händler gelten,
 * weil er letzten Monat noch nicht da war.
 *
 * @param {Array<object>} transactions
 * @returns {string[]} gefunden, alphabetisch
 */
export function knownProviders(transactions = []) {
  const known = new Set(PAYMENT_SERVICE_PROVIDERS)
  const seen = new Set()
  for (const transaction of transactions) {
    for (const token of transactionTokens(transaction)) {
      if (known.has(token)) seen.add(token)
    }
  }
  return [...seen].sort()
}
