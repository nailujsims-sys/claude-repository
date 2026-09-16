import { categoryLabel as seededCategoryLabel } from '../../config/finance'
import { formatAmountMinor, formatBookingDate, plural } from './importFlow'
import {
  patternText,
  tokenize,
  transactionTokens,
  unreliableTokens,
} from './normalize'

// What the classification sheet says, and nothing it decides.
//
// Everything on this screen is already answered somewhere else: which merchant
// a booking belongs to is merchantMatching's answer, which category follows is
// categoryRules', what a pattern would do to the existing bookings is
// backtest's, and whether the gesture is even allowed is buildLearnRequest's.
// This file turns those answers into German sentences and into the one thing
// the engine has no opinion about — how a raw description is cut into words a
// finger can point at.
//
// Pure, no React. The sheet renders what it gets from here.

/**
 * A raw description as pointable words.
 *
 * The visible text and the stored tokens are two different things — "ReWe" is
 * shown and 'REWE' is matched — so every segment carries both: `text` is what
 * the user reads and what pre-fills the merchant name, `token` is what would be
 * saved. They are produced by the SAME tokenizer that produced the booking's
 * stored tokens, so segment n is token n; `aligned` says whether that held.
 *
 * A description arrives with its line breaks intact (a DKB booking is three to
 * five printed lines), and they are kept: a wall of words is harder to point at
 * than the shape the statement actually had.
 *
 * @param {{raw_description?: string, normalized_tokens?: string[]}} transaction
 * @returns {{
 *   lines: Array<Array<{index: number, text: string, token: string, learnable: boolean}>>,
 *   segments: Array<object>, aligned: boolean, unreliable: string[],
 * }}
 */
export function descriptionSegments(transaction) {
  const raw = typeof transaction?.raw_description === 'string' ? transaction.raw_description : ''
  const unreliable = unreliableTokens(raw)
  const lines = []
  const segments = []
  let index = 0

  for (const rawLine of raw.split('\n')) {
    const line = []
    // The same boundary the tokenizer uses, but keeping the visible spelling:
    // a run of letters or digits is a word, everything else is a separator.
    for (const match of rawLine.matchAll(/[\p{L}\p{N}]+/gu)) {
      const text = match[0]
      const produced = tokenize(text)
      // NFKC can fold one visible run into something the tokenizer splits
      // further. Such a run cannot be pointed at as one word without lying
      // about what would be saved, so it is shown and not offered.
      const token = produced.length === 1 ? produced[0] : ''
      const segment = {
        index,
        text,
        token,
        learnable: token !== '' && !unreliable.includes(token),
      }
      line.push(segment)
      segments.push(segment)
      index += 1
    }
    lines.push(line)
  }

  // Does segment n really correspond to stored token n? When it does not, the
  // booking was stored with tokens this text no longer produces, and a marked
  // word would be verified against something else. buildLearnRequest refuses
  // such a selection with a sentence; this flag lets the sheet say so earlier.
  const stored = transactionTokens(transaction)
  const produced = segments.map((s) => s.token)
  const aligned =
    produced.length === stored.length && produced.every((token, i) => token === stored[i])

  return { lines, segments, aligned, unreliable }
}

/**
 * The contiguous run between two taps.
 *
 * A selection is a range, never a set: `exact_phrase` means tokens next to each
 * other in order, so anything else would be a pattern the matcher could not
 * match. Tapping the second word of a range before the first is the same range.
 *
 * @returns {{from: number, to: number}} inclusive
 */
export const selectionRange = (anchor, focus) => ({
  from: Math.min(anchor, focus),
  to: Math.max(anchor, focus),
})

/** Is every word in this range one that may become a pattern? */
export const rangeIsLearnable = (segments, range) =>
  !!range &&
  segments
    .filter((s) => s.index >= range.from && s.index <= range.to)
    .every((s) => s.learnable)

const inRange = (segments, range) =>
  range ? segments.filter((s) => s.index >= range.from && s.index <= range.to) : []

/** The tokens a range would save. */
export const rangeTokens = (segments, range) => inRange(segments, range).map((s) => s.token)

/** The visible words of a range — what pre-fills the merchant name. */
export const rangeText = (segments, range) =>
  inRange(segments, range)
    .map((s) => s.text)
    .join(' ')

/**
 * One token is a token, two or more next to each other are a phrase. The only
 * two pattern types that exist, and the user never picks between them — the
 * shape of what they marked does.
 */
export const patternTypeFor = (tokens) =>
  Array.isArray(tokens) && tokens.length === 1 ? 'exact_token' : 'exact_phrase'

/** The booking's own header line: what it cost, and when. */
export const bookingHeadline = (transaction) => ({
  amount: formatAmountMinor(transaction?.amount_minor, transaction?.currency),
  date: formatBookingDate(transaction?.booking_date),
})

/** A category's visible name — the row's own label wins over the shipped one. */
export const categoryLabelOf = (categories, slug) =>
  categories?.find((c) => c.slug === slug)?.label ?? seededCategoryLabel(slug)

/**
 * What saving this pattern would do, in numbers a screen can print without
 * doing arithmetic of its own.
 *
 * The distinction the sheet must never blur: how many bookings a pattern HITS,
 * and how many it may actually CHANGE. A booking somebody locked, overrode or
 * already assigned is hit and stays exactly as it is — the database refuses to
 * touch it, so promising otherwise would be a lie the user finds out about
 * afterwards.
 *
 * @param {{backtest?: object, transaction?: object, override?: object|null}} input
 */
export function backtestNumbers({ backtest, transaction, override = null } = {}) {
  const applicable = backtest?.applicableTransactionIds ?? []
  const currentId = transaction?.id ?? null
  const weitere = applicable.filter((id) => id !== currentId).length
  // The booking in front of the user changes unless they themselves protected
  // it — the same three conditions finance_learn_merchant_rule checks.
  const aktuelleAendertSich =
    transaction?.manual_lock !== true && !override && !transaction?.merchant_id
  const treffer = backtest?.matchCount ?? 0
  const gesamt = weitere + (aktuelleAendertSich ? 1 : 0)
  return {
    treffer,
    weitere,
    gesamt,
    aktuelleAendertSich,
    unveraendert: Math.max(0, treffer - gesamt),
    gesperrt: backtest?.lockedCount ?? 0,
    bereitsZugeordnet: backtest?.assignedCount ?? 0,
  }
}

/**
 * The confirmation sentences, as the brief writes them:
 *
 *   „REWE" erkennt 4 weitere offene Umsätze.
 *   5 Umsätze werden REWE · Lebensmittel.
 *
 * @param {{numbers: object, patternLabel: string, merchantName: string, categoryName: string}} input
 * @returns {string[]}
 */
export function confirmationLines({ numbers, patternLabel, merchantName, categoryName }) {
  const lines = []
  lines.push(
    numbers.weitere === 0
      ? `„${patternLabel}" erkennt keine weiteren offenen Umsätze.`
      : `„${patternLabel}" erkennt ${plural(numbers.weitere, 'weiteren offenen Umsatz', 'weitere offene Umsätze')}.`
  )
  if (numbers.gesamt > 0) {
    lines.push(
      `${plural(numbers.gesamt, 'Umsatz wird', 'Umsätze werden')} ${merchantName} · ${categoryName}.`
    )
  }
  if (!numbers.aktuelleAendertSich) {
    lines.push('Diese Buchung bleibt, wie du sie selbst gesetzt hast — die Regel wird trotzdem gespeichert.')
  }
  if (numbers.unveraendert > 0) {
    lines.push(
      `${plural(numbers.unveraendert, 'weiterer Umsatz bleibt', 'weitere Umsätze bleiben')} unverändert — gesperrt oder bereits zugeordnet.`
    )
  }
  return lines
}

/**
 * Why this pattern might be a bad idea — as a warning, never as a refusal.
 *
 * There is no stopword list here and there must never be one: a word is not
 * removed from matching because it looks generic, and „MARKT" is not forbidden.
 * What the user gets instead is what the backtest measured on their own
 * bookings, and then they decide.
 *
 * @param {{backtest: object, numbers: object, total: number, merchantId?: string|null}} input
 * @returns {Array<{tone: string, text: string}>}
 */
export function patternWarnings({ backtest, numbers, total = 0, merchantId = null }) {
  const warnings = []

  const foreign = (backtest?.assignedMerchantIds ?? []).filter((id) => id !== merchantId)
  if (foreign.length > 0) {
    warnings.push({
      tone: 'attention',
      text:
        `Dieses Muster trifft auch ${plural(numbers.bereitsZugeordnet, 'Umsatz', 'Umsätze')}, ` +
        'die bereits zu einem anderen Händler gehören. Sie bleiben unverändert.',
    })
  }

  if ((backtest?.merchantConflicts?.length ?? 0) > 0) {
    warnings.push({
      tone: 'attention',
      text:
        `Nach dem Speichern ${plural(backtest.merchantConflicts.length, 'Umsatz wäre', 'Umsätze wären')} ` +
        'von zwei Händlern beansprucht und bliebe offen, bis du ein genaueres Muster wählst.',
    })
  }

  // Breadth, measured rather than guessed: a pattern that hits a quarter of
  // everything is worth a second look, whatever the word is.
  if (total > 0 && numbers.treffer >= 10 && numbers.treffer / total >= 0.25) {
    warnings.push({
      tone: 'attention',
      text: `Dieses Muster trifft ${numbers.treffer} von ${total} Umsätzen — das ist sehr allgemein.`,
    })
  }

  return warnings
}

/**
 * The one case that is not a warning but a stop: the identical pattern already
 * belongs to somebody else. Saving it would make every booking it matches
 * ambiguous forever, and the database refuses it too — so the sheet says so
 * before the user presses anything.
 *
 * @returns {string|null}
 */
export function blockingConflict({ backtest, merchants = [] }) {
  const clash = (backtest?.patternConflicts ?? []).find((c) => c.reason === 'other_merchant')
  if (!clash) return null
  const owner = merchants.find((m) => m.id === clash.merchantId)
  const label = backtest?.pattern?.text ?? ''
  return owner
    ? `„${label}" gehört bereits zu ${owner.canonical_name}. Bitte einen anderen Teil der Buchung markieren.`
    : `„${label}" gehört bereits zu einem anderen Händler. Bitte einen anderen Teil der Buchung markieren.`
}

/**
 * A refusal from the database, in German.
 *
 * The RPC raises with a German message already, and that message is the better
 * one — it names the merchant or the pattern. What this adds is the fallback
 * for everything else, and the guarantee that a PostgREST error object never
 * reaches a screen with the offending row inside it.
 */
export function describeLearnFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const finance = message.match(/finance:\s*(.+)/)
  if (finance) {
    const sentence = finance[1].trim()
    return sentence.charAt(0).toUpperCase() + sentence.slice(1)
  }
  return 'Die Zuordnung konnte nicht gespeichert werden. Es wurde nichts geändert — bitte versuche es erneut.'
}

/** The validation errors of buildLearnRequest as plain lines. */
export const learnErrorLines = (errors = []) =>
  errors.map((e) => e?.message).filter((m) => typeof m === 'string' && m !== '')

/**
 * What actually happened, read from the database's answer rather than from the
 * preview — the two agree, and where they would not, the database is right.
 */
export function describeLearnResult(result, { merchantName, categoryName }) {
  const applied = Number.isFinite(result?.applied_count) ? result.applied_count : 0
  const touchedCurrent = result?.transaction_updated === true
  const total = applied + (touchedCurrent ? 1 : 0)
  const lines = []
  lines.push(
    total === 0
      ? 'Die Regel ist gespeichert.'
      : `${plural(total, 'Umsatz ist', 'Umsätze sind')} jetzt ${merchantName} · ${categoryName}.`
  )
  if (result?.merchant_created) lines.push(`${merchantName} wurde neu angelegt.`)
  if (!touchedCurrent) {
    lines.push('Diese Buchung behält deine eigene Zuordnung.')
  }
  return { lines, applied, total }
}

/** A pattern as one readable line, for the confirmation and the warnings. */
export const patternLabelOf = (tokens) => patternText(tokens)
