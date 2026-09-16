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
  // it — and "protected" means EXACTLY what finance_learn_merchant_rule means by
  // it: not locked, and no override. Nothing else.
  //
  // In particular NOT "has no merchant_id yet". The function requires that of
  // the OTHER bookings it sweeps up, and of those only; for the booking the user
  // is actually looking at it writes merchant and category regardless. The
  // difference is not academic — it is the case this module exists to support: a
  // booking that was classified once, whose pattern was later deactivated, is
  // put back in front of the user by the engine while its columns still hold the
  // old ids. Counting it as unchanged would promise one number and write
  // another.
  const aktuelleAendertSich = transaction?.manual_lock !== true && !override
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
        'von zwei Händlern beansprucht. Solche Buchungen bleiben offen und werden einzeln ' +
        'entschieden — ein weiteres, genaueres Muster hebt einen bestehenden Anspruch nicht auf.',
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

// ── The two decisions that are not a rule ───────────────────────────────────
//
// Not every open booking is a merchant waiting to be taught. Two of the three
// states the engine can report are about THIS booking and no other, and
// offering a new pattern for them would be wrong in one case and pointless in
// the other:
//
//   conflict         — two merchants' patterns already claim this text. Adding
//                      a third, more specific pattern removes neither claim:
//                      matchMerchant has no specificity ranking, on purpose, so
//                      the booking would stay in conflict forever. What is
//                      actually needed is a decision about this one booking.
//   review_required  — the merchant IS recognised. The user asked to look at
//                      every booking of it (review_mode = 'always_review'), so
//                      learning another default rule would not settle anything;
//                      resolveCategory would put the next one up again, which is
//                      exactly what was asked for.
//
// Both are answered by the override table: one decision, one booking, and the
// global rules untouched.

/** Which decision this booking is actually asking for. */
export const DECISION = Object.freeze({
  LEARN: 'learn',
  RESOLVE_CONFLICT: 'resolve_conflict',
  REVIEW: 'review',
})

export function decisionKindOf(entry) {
  if (entry?.status === 'conflict') return DECISION.RESOLVE_CONFLICT
  if (entry?.status === 'review_required') return DECISION.REVIEW
  return DECISION.LEARN
}

/**
 * The merchants that already claim a booking, by name.
 *
 * Read off the match rather than off the booking: a conflict has no
 * `merchant_id`, and the whole point is to show the user the claims the engine
 * found instead of a single name it refused to pick.
 */
export const claimingMerchants = (entry, merchants = []) =>
  (entry?.merchantMatch?.merchantIds ?? []).map(
    (id) => merchants.find((m) => m.id === id)?.canonical_name ?? 'Unbekannter Händler'
  )

/**
 * What the screen says about a decision that is not a rule.
 *
 * The sentence about a conflict deliberately does NOT promise that a more
 * specific pattern would help. It would not.
 */
export function decisionExplanation(entry, merchants = []) {
  const kind = decisionKindOf(entry)
  if (kind === DECISION.RESOLVE_CONFLICT) {
    const names = claimingMerchants(entry, merchants)
    return {
      kind,
      reason: entry?.category?.reason ?? null,
      headline: 'Zwei Händler beanspruchen diese Buchung.',
      lines: [
        names.length > 0 ? `Gemerkt sind: ${names.join(' und ')}.` : '',
        'Du entscheidest hier nur diese eine Buchung. Die gespeicherten Muster bleiben, wie sie sind — solange beide bestehen, wird die nächste solche Buchung wieder gefragt.',
      ].filter(Boolean),
    }
  }
  if (kind === DECISION.REVIEW) {
    const name = entry?.merchantMatch?.merchant?.canonical_name ?? 'Dieser Händler'
    // Two different reasons end in the same status, and they mean different
    // things to the user. 'always_review' is a standing instruction — every
    // booking of this merchant, forever. 'conditional_default' is about THIS
    // booking: the merchant's amount rules did not cover it, so the fallback
    // would have decided it, and the user asked not to let that happen
    // silently. Saying „jedes Mal" for the second one would describe a merchant
    // setting nobody made.
    const conditional = entry?.category?.reason === 'merchant_conditional_default'
    return {
      kind,
      reason: entry?.category?.reason ?? null,
      headline: conditional
        ? `Für diese Buchung von ${name} greift keine Regel.`
        : `${name} wird jedes Mal geprüft.`,
      lines: conditional
        ? [
            'Der Händler ist erkannt, aber keine seiner Betragsregeln passt auf diesen Betrag.',
            'Statt still auf die Standardkategorie zurückzufallen, wird sie hier einmal bestätigt.',
          ]
        : [
            'Der Händler ist erkannt, die Kategorie wird bei diesem Händler absichtlich nie automatisch gesetzt.',
            'Du wählst sie für diese eine Buchung.',
          ],
    }
  }
  return { kind, reason: null, headline: '', lines: [] }
}

/**
 * The override one of those decisions writes.
 *
 * `merchant_id` travels along wherever it is known — for a conflict because the
 * user just picked one of the claimants, for a review because the engine
 * already knows it. A category alone would leave the booking's merchant
 * permanently ambiguous.
 */
export const buildOverride = ({ merchantId = null, categoryId }) => ({
  merchant_id: merchantId ?? null,
  category_id: categoryId,
})

/** What was decided, once it is written. */
export function describeOverrideResult({ kind, reason = null, merchantName, categoryName }) {
  const lines = [`Diese Buchung ist ${merchantName ? `${merchantName} · ` : ''}${categoryName}.`]
  // What stayed the same is the point of the sentence, and it has to be true
  // for the case at hand. „Wird weiterhin jedes Mal geprüft" is a statement
  // about a merchant setting, and only one of the reasons that lead here is
  // that setting; the neutral half is true of all of them.
  if (kind === DECISION.RESOLVE_CONFLICT) {
    lines.push('Nur diese Buchung wurde entschieden — an den gespeicherten Mustern hat sich nichts geändert.')
  } else if (reason === 'merchant_always_review') {
    lines.push('Nur diese Buchung wurde entschieden — der Händler wird weiterhin jedes Mal geprüft.')
  } else {
    lines.push('Nur diese Buchung wurde entschieden — die Händlerregeln bleiben unverändert.')
  }
  return { lines }
}
