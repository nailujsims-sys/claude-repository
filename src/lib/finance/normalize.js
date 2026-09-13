// Normalising and tokenising a booking text — the bottom of the Finanzen
// module. Pure, deterministic, no React and no Supabase (see
// tools/financeLogic.mjs), and the ONLY place a raw description is turned into
// something comparable.
//
// WHAT IS ALLOWED TO HAPPEN HERE, and nothing else:
//   • Unicode is unified (NFKC), so a composed "ü" and a "u" with a combining
//     diaeresis are the same character rather than two.
//   • Case is unified (upper case).
//   • Whitespace is unified.
//   • Punctuation is treated as a token boundary, consistently.
//
// WHAT MUST NEVER HAPPEN HERE:
//   • No city name is removed. TROISDORF stays a token.
//   • No company suffix is removed. GMBH stays a token.
//   • No number is removed. 8407 stays a token.
//   • No word is dropped because it "looks irrelevant".
//   • No fuzzy, phonetic or semantic matching, ever. Two tokens are equal or
//     they are not.
//
// The reason is the same in every case: the moment this file starts guessing,
// "REWE TROISDORF" silently becomes "REWE" for the software but not for the
// user, and a wrong merchant is worse than an unrecognised one. The raw
// description in the database is never touched by any of this.

// A token is one run of letters or digits. Everything else — spaces, hyphens,
// dots, dashes, slashes, asterisks, the umpteen separators a bank statement
// uses — is a boundary. That is where word boundaries come from: 'REWE' and
// 'REWERT' are different tokens, and no substring search can confuse them.
const BOUNDARY = /[^\p{L}\p{N}]+/u

// Mirrors the check in supabase/migrations/0008_finance.sql: a stored pattern
// token may not be longer than this.
export const MAX_TOKEN_LENGTH = 64

/**
 * The whole description, unified but complete: NFKC, upper case, single spaces.
 * Nothing is dropped — this is the raw text made comparable, not a summary.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeDescription(raw) {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim()
}

/**
 * A description as the list of its tokens, in the order they appear.
 *
 * " ReWe Troisdorf – sagt Danke 8407 " → ['REWE','TROISDORF','SAGT','DANKE','8407']
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function tokenize(raw) {
  if (typeof raw !== 'string') return []
  return raw
    .normalize('NFKC')
    .toUpperCase()
    .split(BOUNDARY)
    .filter((token) => token.length > 0)
}

/**
 * What the user marked, as tokens. Accepts a string ("Max und Moritz") or an
 * array of strings (['Max', 'und', 'Moritz']) and runs both through the very
 * same tokenizer the description goes through — so a selection can only ever
 * produce tokens a description could also produce.
 *
 * @param {unknown} selection
 * @returns {string[]}
 */
export function normalizeTokens(selection) {
  const values = Array.isArray(selection) ? selection : [selection]
  return values.flatMap((value) => tokenize(typeof value === 'string' ? value : ''))
}

/**
 * Is this exactly what the tokenizer would have produced for it? The database
 * asks the same question in SQL before it stores a pattern.
 *
 * @param {unknown} token
 * @returns {boolean}
 */
export function isNormalizedToken(token) {
  if (typeof token !== 'string' || token.length === 0) return false
  if (token.length > MAX_TOKEN_LENGTH) return false
  const produced = tokenize(token)
  return produced.length === 1 && produced[0] === token
}

/**
 * Does `token` appear as a whole token in `tokens`?
 *
 * @param {string[]} tokens
 * @param {string} token
 * @returns {boolean}
 */
export function containsToken(tokens, token) {
  if (!Array.isArray(tokens) || typeof token !== 'string' || token === '') return false
  return tokens.includes(token)
}

/**
 * The index at which `phrase` appears in `tokens` as a contiguous run, in that
 * order — or -1. This is what makes ['MAX','UND','MORITZ'] match
 * 'MAX UND MORITZ TROISDORF' and not 'MAX MORITZ' or 'MORITZ UND MAX'.
 *
 * @param {string[]} tokens
 * @param {string[]} phrase
 * @returns {number}
 */
export function phraseIndex(tokens, phrase) {
  if (!Array.isArray(tokens) || !Array.isArray(phrase) || phrase.length === 0) return -1
  if (phrase.length > tokens.length) return -1
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    let hit = true
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) {
        hit = false
        break
      }
    }
    if (hit) return start
  }
  return -1
}

/**
 * The tokens of one booking — the basis every match is decided on.
 *
 * A booking carries its tokens (`normalized_tokens`), written once by this
 * module when the booking was created and frozen with the text they come from.
 * When the column is there, it IS the answer, even when it is empty: the
 * database verifies a learning call against exactly these tokens, so deriving
 * something friendlier here would show the user a preview the server then
 * refuses. Tokenising `raw_description` is the fallback for a row that was read
 * without the column, and for fixtures.
 *
 * @param {{normalized_tokens?: string[], raw_description?: string}} transaction
 * @returns {string[]}
 */
export function transactionTokens(transaction) {
  if (Array.isArray(transaction?.normalized_tokens)) return transaction.normalized_tokens
  return tokenize(transaction?.raw_description)
}

/**
 * A pattern's tokens as one readable line ('MAX UND MORITZ'). For screens and
 * error messages; the tokens array stays the stored representation.
 *
 * @param {string[]} tokens
 * @returns {string}
 */
export const patternText = (tokens) => (Array.isArray(tokens) ? tokens.join(' ') : '')
