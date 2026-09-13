import {
  DEFAULT_FINANCE_CURRENCY,
  FINANCE_CATEGORY_SLUGS,
  isPatternType,
  isReviewMode,
  isCurrencyCode,
} from '../../config/finance'
import { backtestPattern } from './backtest'
import { patternMatches } from './merchantMatching'
import { isNormalizedToken, normalizeTokens, patternText, tokenize } from './normalize'

// The user action this whole module exists for:
//
//   Raw:      REWE TROISDORF SAGT DANKE 8407
//   Marks:    REWE
//   Chooses:  Lebensmittel
//
// …and from then on REWE bookings are Lebensmittel. This file turns that one
// gesture into one checked request. It decides nothing on its own: the tokens
// are the ones the user marked, the category is the one the user chose, and the
// bookings that are re-labelled along with it are the ones the backtest found —
// which the user can see before saving.
//
// It is pure. The write itself is a single database function
// (finance_learn_merchant_rule), because merchant + pattern + rule + booking
// either all come into existence or none of them do.

const error = (code, message) => ({ code, message })

/**
 * Validate one learning gesture and build the request for the RPC.
 *
 * @param {{
 *   transaction?: object,
 *   selection?: string|string[],
 *   patternType?: string,
 *   categorySlug?: string,
 *   categories?: Array<object>,
 *   merchantId?: string|null,
 *   merchantName?: string,
 *   reviewMode?: string|null,
 *   bounds?: {
 *     minAmountMinor?: number|null, minInclusive?: boolean,
 *     maxAmountMinor?: number|null, maxInclusive?: boolean, currency?: string|null,
 *   }|null,
 *   transactions?: Array<object>,
 *   patterns?: Array<object>,
 *   overrides?: Array<object>,
 * }} input
 * @returns {{valid: boolean, errors: Array<{code: string, message: string}>,
 *           tokens: string[], patternType: string|null, request: object|null, backtest: object|null}}
 */
export function buildLearnRequest({
  transaction,
  selection,
  patternType,
  categorySlug,
  categories = null,
  merchantId = null,
  merchantName = '',
  reviewMode = null,
  bounds = null,
  transactions = [],
  patterns = [],
  overrides = [],
} = {}) {
  const errors = []
  const tokens = normalizeTokens(selection)
  const type = patternType ?? (tokens.length === 1 ? 'exact_token' : 'exact_phrase')

  if (!transaction?.id) errors.push(error('transaction_missing', 'Keine Buchung ausgewählt.'))

  if (tokens.length === 0) {
    errors.push(error('selection_empty', 'Es wurde kein Text markiert.'))
  } else if (!tokens.every(isNormalizedToken)) {
    errors.push(error('selection_invalid', 'Die Markierung ergibt kein gültiges Muster.'))
  }

  if (!isPatternType(type)) {
    errors.push(error('pattern_type_unknown', 'Unbekannter Mustertyp.'))
  } else if (type === 'exact_token' && tokens.length !== 1) {
    errors.push(error('pattern_type_mismatch', 'Ein einzelnes Token ist genau ein Wort.'))
  } else if (type === 'exact_phrase' && tokens.length < 2) {
    errors.push(error('pattern_type_mismatch', 'Eine Phrase braucht mindestens zwei Wörter.'))
  }

  // The guard against a pattern nobody marked: whatever is saved has to occur
  // in the booking the user was looking at. A pattern may never be derived from
  // the history — only confirmed against the text in front of the user.
  if (transaction && tokens.length > 0 && isPatternType(type)) {
    const candidate = { pattern_type: type, tokens, active: true }
    if (!patternMatches(candidate, tokenize(transaction.raw_description))) {
      errors.push(
        error('pattern_not_in_description', `„${patternText(tokens)}" kommt in dieser Buchung nicht vor.`)
      )
    }
  }

  const knownSlugs = Array.isArray(categories) && categories.length > 0
    ? categories.map((c) => c.slug)
    : FINANCE_CATEGORY_SLUGS
  if (!categorySlug || !knownSlugs.includes(categorySlug)) {
    errors.push(error('category_unknown', 'Bitte eine Kategorie auswählen.'))
  }

  const name = typeof merchantName === 'string' ? merchantName.trim() : ''
  if (!merchantId && name === '') {
    errors.push(error('merchant_missing', 'Bitte einen Händler wählen oder benennen.'))
  }

  if (reviewMode !== null && reviewMode !== undefined && !isReviewMode(reviewMode)) {
    errors.push(error('review_mode_unknown', 'Unbekannter Prüfmodus.'))
  }

  const min = bounds?.minAmountMinor ?? null
  const max = bounds?.maxAmountMinor ?? null
  const hasBounds = min !== null || max !== null
  if (min !== null && !Number.isSafeInteger(min)) {
    errors.push(error('bound_not_integer', 'Beträge werden in Cent als ganze Zahl angegeben.'))
  }
  if (max !== null && !Number.isSafeInteger(max)) {
    errors.push(error('bound_not_integer', 'Beträge werden in Cent als ganze Zahl angegeben.'))
  }
  if (min !== null && max !== null && min > max) {
    errors.push(error('bounds_inverted', 'Die Untergrenze liegt über der Obergrenze.'))
  }
  if ((min !== null && min < 0) || (max !== null && max < 0)) {
    errors.push(error('bound_negative', 'Eine Betragsgrenze kann nicht negativ sein.'))
  }

  // An amount bound is a number in a currency; without an explicit one it is
  // the currency of the booking the user was looking at.
  const currency = hasBounds
    ? bounds?.currency ?? transaction?.currency ?? DEFAULT_FINANCE_CURRENCY
    : bounds?.currency ?? null
  if (currency !== null && !isCurrencyCode(currency)) {
    errors.push(error('currency_invalid', 'Unbekannte Währung.'))
  }

  if (errors.length > 0) {
    return { valid: false, errors, tokens, patternType: isPatternType(type) ? type : null, request: null, backtest: null }
  }

  const backtest = backtestPattern({
    pattern: { pattern_type: type, tokens },
    merchantId,
    transactions,
    patterns,
    overrides,
  })

  return {
    valid: true,
    errors: [],
    tokens,
    patternType: type,
    backtest,
    request: {
      p_transaction_id: transaction.id,
      p_category_slug: categorySlug,
      p_pattern_type: type,
      p_tokens: tokens,
      p_merchant_id: merchantId ?? null,
      p_merchant_name: merchantId ? null : name,
      p_review_mode: reviewMode ?? null,
      p_min_amount_minor: min,
      p_min_inclusive: bounds?.minInclusive ?? true,
      p_max_amount_minor: max,
      p_max_inclusive: bounds?.maxInclusive ?? true,
      p_rule_currency: currency,
      // Only the bookings nobody has decided anything about. The database
      // checks the same thing again before it touches a single row.
      p_apply_transaction_ids: backtest.applicableTransactionIds.filter(
        (id) => id !== transaction.id
      ),
    },
  }
}
