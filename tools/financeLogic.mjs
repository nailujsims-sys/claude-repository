// Pure-logic tests for the Finanzen module — the whole rule engine, without a
// database and without a browser.
//
// The engine is the part of this module that must never be "roughly right": it
// decides what a booking was, and a wrong merchant becomes a wrong number in a
// spending report nobody double-checks. So the assertions here are mostly about
// what it REFUSES to do — no fuzzy match, no guessed merchant, no winner picked
// out of two conflicting rules, no silent overwrite of something a human
// decided. The eighteen cases the brief asks for are numbered in the sections
// below; the rest are the invariants those eighteen rest on.
//
// The three cases that cannot be proved here — atomicity of the learning write,
// the RLS isolation and the constraints — live in supabase/tests/rls.sql,
// because they are database behaviour and asserting them in JavaScript would
// only test a mock. Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { readFileSync } from 'node:fs'
import {
  DEFAULT_FINANCE_CURRENCY,
  FINANCE_CATEGORIES,
  FINANCE_CATEGORY_SLUGS,
  PATTERN_TYPES,
  REVIEW_MODES,
  TRANSACTION_TYPES,
  categoryLabel,
  isCategorySlug,
  isCurrencyCode,
  isPatternType,
  isReviewMode,
  isTransactionType,
} from './src/config/finance.js'
import {
  MAX_TOKEN_LENGTH,
  containsToken,
  isNormalizedToken,
  normalizeDescription,
  normalizeTokens,
  patternText,
  phraseIndex,
  tokenize,
} from './src/lib/finance/normalize.js'
import { FINANCE_STATUS, matchMerchant, patternMatches } from './src/lib/finance/merchantMatching.js'
import {
  CATEGORY_SOURCE,
  isDefaultRule,
  resolveCategory,
  resolveInclusion,
  ruleMatchesAmount,
} from './src/lib/finance/categoryRules.js'
import { backtestPattern } from './src/lib/finance/backtest.js'
import { buildLearnRequest } from './src/lib/finance/learning.js'
import {
  WRITABLE_FINANCE_TRANSACTION_FIELDS,
  WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS,
  WRITABLE_FINANCE_PATTERN_FIELDS,
  WRITABLE_FINANCE_PATTERN_PATCH_FIELDS,
  WRITABLE_FINANCE_RULE_FIELDS,
  WRITABLE_FINANCE_OVERRIDE_FIELDS,
  pickFinancePatternPatch,
  pickFinanceTransactionPatch,
  pickWritableFinanceTransaction,
} from './src/data/financeDefaults.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// ── Fixtures ────────────────────────────────────────────────────────────────
const REWE = 'm-rewe'
const EDEKA = 'm-edeka'
const MAXMORITZ = 'm-maxmoritz'
const DM = 'm-dm'
const LEBENSMITTEL = 'c-lebensmittel'
const RESTAURANT = 'c-restaurant'
const DROGERIE = 'c-drogerie'

const merchant = (id, over = {}) => ({ id, user_id: 'u', canonical_name: id, review_mode: 'auto', ...over })
const pattern = (id, merchantId, tokens, over = {}) => ({
  id, user_id: 'u', merchant_id: merchantId,
  pattern_type: tokens.length === 1 ? 'exact_token' : 'exact_phrase',
  tokens, active: true, ...over,
})
const rule = (id, merchantId, categoryId, over = {}) => ({
  id, user_id: 'u', merchant_id: merchantId, category_id: categoryId,
  min_amount_minor: null, min_inclusive: true,
  max_amount_minor: null, max_inclusive: true,
  currency: null, active: true, ...over,
})
const tx = (id, raw, over = {}) => ({
  id, user_id: 'u', account_id: 'a', import_id: null,
  booking_date: '2026-09-05', value_date: null,
  amount_minor: -2483, currency: 'EUR', raw_description: raw,
  external_reference: null, merchant_id: null, category_id: null,
  transaction_type: 'purchase', refunds_transaction_id: null,
  include_in_analytics: true, manual_lock: false,
  dedupe_hash: null, source_metadata: null,
  created_at: '2026-09-05T08:00:00.000Z', updated_at: '2026-09-05T08:00:00.000Z', ...over,
})

const MERCHANTS = [merchant(REWE), merchant(EDEKA), merchant(MAXMORITZ), merchant(DM)]

// ── A. Normalisation and tokenisation ───────────────────────────────────────
// Everything the engine can ever compare comes out of here, so this is where
// the "no cleverness" promise is actually kept.
{
  ok('the example from the brief tokenises as expected',
     tokenize(' ReWe Troisdorf – sagt Danke ').join(',') === 'REWE,TROISDORF,SAGT,DANKE')

  ok('the raw text is never shortened — the city stays a token',
     tokenize('REWE TROISDORF SAGT DANKE 8407').includes('TROISDORF'))
  ok('…the numbers stay tokens',
     tokenize('REWE TROISDORF SAGT DANKE 8407').includes('8407'))
  ok('…and a company suffix stays a token',
     tokenize('MUSTER HANDELS GMBH').join(',') === 'MUSTER,HANDELS,GMBH')

  ok('case is unified', tokenize('rewe').join('') === 'REWE')
  ok('whitespace of every kind is one boundary',
     tokenize('REWE\\t\\tTROISDORF\\n SAGT').join(',') === 'REWE,TROISDORF,SAGT')
  ok('punctuation is a boundary, not a character in a token',
     tokenize('REWE-MARKT, TROISDORF.').join(',') === 'REWE,MARKT,TROISDORF')
  ok('a booking reference keeps its digits as their own token',
     tokenize('KARTENZAHLUNG 12.09.2026 UM 14:22 UHR').join(',') === 'KARTENZAHLUNG,12,09,2026,UM,14,22,UHR')

  // Unicode: the two ways of writing an umlaut have to become one thing, and
  // the letter itself is never thrown away.
  ok('a decomposed umlaut and a composed one are the same token',
     tokenize('MU\\u0308LLER')[0] === tokenize('MÜLLER')[0])
  ok('and the umlaut survives it', tokenize('Müller')[0] === 'MÜLLER')

  ok('the whole description is available unified and complete',
     normalizeDescription('  ReWe   Troisdorf  ') === 'REWE TROISDORF')
  ok('a description that is not a string is empty, never a crash',
     normalizeDescription(null) === '' && tokenize(undefined).length === 0)

  ok('a marked selection runs through the very same tokenizer',
     normalizeTokens(' Max und Moritz ').join(',') === 'MAX,UND,MORITZ' &&
     normalizeTokens(['ReWe', 'troisdorf']).join(',') === 'REWE,TROISDORF')

  ok('a normalised token is recognised as one', isNormalizedToken('REWE'))
  ok('and anything the tokenizer would have split is not',
     !isNormalizedToken('rewe') && !isNormalizedToken('REWE MARKT') &&
     !isNormalizedToken('REWE-MARKT') && !isNormalizedToken('') && !isNormalizedToken(null))
  ok('a token longer than the database allows is refused',
     !isNormalizedToken('A'.repeat(MAX_TOKEN_LENGTH + 1)) && isNormalizedToken('A'.repeat(MAX_TOKEN_LENGTH)))

  ok('a phrase is found only as a contiguous run in order',
     phraseIndex(['MAX','UND','MORITZ','TROISDORF'], ['MAX','UND','MORITZ']) === 0 &&
     phraseIndex(['A','MAX','UND','MORITZ'], ['MAX','UND','MORITZ']) === 1 &&
     phraseIndex(['MAX','MORITZ'], ['MAX','UND','MORITZ']) === -1 &&
     phraseIndex(['MORITZ','UND','MAX'], ['MAX','UND','MORITZ']) === -1)
  ok('a whole token is a whole token', containsToken(['REWERT'], 'REWE') === false)
  ok('a pattern reads back as one line', patternText(['MAX','UND','MORITZ']) === 'MAX UND MORITZ')
}

// ── B. The MVP vocabulary, and the one word that is not in it ───────────────
{
  ok('exactly the five agreed categories',
     FINANCE_CATEGORY_SLUGS.join(',') === 'lebensmittel,restaurant,klamotten,drogerie,sonstige')
  ok('„Events" is not a category', !isCategorySlug('events') && !FINANCE_CATEGORY_SLUGS.includes('events'))
  ok('every category has a German label', FINANCE_CATEGORIES.every((c) => c.label.length > 0))
  ok('a label can be looked up by slug',
     categoryLabel('lebensmittel') === 'Lebensmittel' && categoryLabel('events') === '')
  ok('the two MVP pattern types', PATTERN_TYPES.join(',') === 'exact_token,exact_phrase')
  ok('the three review modes', REVIEW_MODES.join(',') === 'auto,conditional,always_review')
  ok('unknown values are unknown',
     !isPatternType('regex') && !isReviewMode('vielleicht') && !isTransactionType('ausgabe'))
  ok('a refund is a transaction type of its own', isTransactionType('refund'))
  ok('the currency is a value, not a hard-wired assumption',
     DEFAULT_FINANCE_CURRENCY === 'EUR' && isCurrencyCode('AUD') && !isCurrencyCode('Euro'))

  // The database refuses whatever this config does not know, so the two have to
  // say the same thing — a mismatch is a screen that breaks on save.
  const sql = readFileSync('supabase/migrations/0008_finance.sql', 'utf8')
  const seedStart = sql.indexOf('returns table (slug text')
  const seed = sql.slice(seedStart, sql.indexOf('$$;', seedStart))
  const seeded = [...seed.matchAll(/\\('([a-z_]+)',\\s*'([^']+)',\\s*(\\d+)\\)/g)]
    .map((m) => m[1] + ':' + m[2] + ':' + m[3])
  ok('the migration seeds exactly the categories this config declares',
     seeded.join(',') === FINANCE_CATEGORIES.map((c) => c.slug + ':' + c.label + ':' + c.sort_order).join(','))
  ok('and the migration never mentions an „events" category', !/'events'/.test(sql))

  const listOf = (re) => (sql.match(re)?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''))
  ok('the review modes in the database are the review modes here',
     listOf(/review_mode in \\(([^)]+)\\)/).join(',') === REVIEW_MODES.join(','))
  ok('the pattern types in the database are the pattern types here',
     listOf(/pattern_type in \\(([^)]+)\\)/).join(',') === PATTERN_TYPES.join(','))
  ok('the transaction types in the database are the transaction types here',
     listOf(/transaction_type in \\(([^)]+)\\)/).join(',') === TRANSACTION_TYPES.join(','))
  ok('the database checks the token length this module promises',
     sql.includes('char_length(token) > ' + MAX_TOKEN_LENGTH))
  ok('money is an integer column, never a float',
     /amount_minor\\s+bigint not null/.test(sql) && !/amount[a-z_]*\\s+(real|double|float)/.test(sql))
}

// ── C. Merchant matching ────────────────────────────────────────────────────
{
  // 1. An unknown description with nothing to match against.
  const nothing = matchMerchant({ rawDescription: 'IRGENDEIN LADEN 1234', patterns: [], merchants: MERCHANTS })
  ok('1. without patterns nothing is resolved',
     nothing.status === FINANCE_STATUS.UNRESOLVED && nothing.merchantId === null)
  ok('1b. …and the engine says why', nothing.reason === 'no_pattern_matched')

  const rewePattern = pattern('p-rewe', REWE, ['REWE'])

  // 2. The example from the brief.
  const hit = matchMerchant({
    rawDescription: 'REWE TROISDORF SAGT DANKE 8407',
    patterns: [rewePattern], merchants: MERCHANTS,
  })
  ok('2. an exact token resolves its merchant',
     hit.status === FINANCE_STATUS.RESOLVED && hit.merchantId === REWE)
  ok('2b. and reports which pattern did it',
     hit.matches.length === 1 && hit.matches[0].patternId === 'p-rewe')

  // 3. Word boundaries — the whole reason this is not a substring search.
  const boundary = matchMerchant({
    rawDescription: 'REWERT UND SOEHNE', patterns: [rewePattern], merchants: MERCHANTS,
  })
  ok('3. REWE does not match REWERT', boundary.status === FINANCE_STATUS.UNRESOLVED)
  ok('3b. nor does it match a token it is only the end of',
     matchMerchant({ rawDescription: 'BAECKEREI KREWE', patterns: [rewePattern], merchants: MERCHANTS })
       .status === FINANCE_STATUS.UNRESOLVED)
  ok('3c. …and not a glued-together word either',
     matchMerchant({ rawDescription: 'REWEMARKT', patterns: [rewePattern], merchants: MERCHANTS })
       .status === FINANCE_STATUS.UNRESOLVED)

  // 4. Case and whitespace.
  for (const [name, raw] of [
    ['lower case', 'rewe troisdorf sagt danke'],
    ['mixed case', 'ReWe Troisdorf'],
    ['extra whitespace', '   REWE     TROISDORF   '],
    ['punctuation around it', 'KARTENZAHLUNG/REWE, TROISDORF.'],
  ]) {
    ok('4. ' + name + ' still matches after normalisation',
       matchMerchant({ rawDescription: raw, patterns: [rewePattern], merchants: MERCHANTS })
         .merchantId === REWE)
  }

  // 5./6. Phrases.
  const phrase = pattern('p-mm', MAXMORITZ, ['MAX', 'UND', 'MORITZ'])
  ok('5. the phrase matches where it stands, in order',
     matchMerchant({ rawDescription: 'MAX UND MORITZ TROISDORF', patterns: [phrase], merchants: MERCHANTS })
       .merchantId === MAXMORITZ)
  ok('6. a different order does not match',
     matchMerchant({ rawDescription: 'MORITZ UND MAX', patterns: [phrase], merchants: MERCHANTS })
       .status === FINANCE_STATUS.UNRESOLVED)
  ok('6b. neither does the phrase with a word missing',
     matchMerchant({ rawDescription: 'MAX MORITZ IMBISS', patterns: [phrase], merchants: MERCHANTS })
       .status === FINANCE_STATUS.UNRESOLVED)
  ok('6c. nor one with a word in between',
     matchMerchant({ rawDescription: 'MAX UND DER MORITZ', patterns: [phrase], merchants: MERCHANTS })
       .status === FINANCE_STATUS.UNRESOLVED)

  // 7. Two patterns, one merchant — an alias, not a conflict.
  const alias = matchMerchant({
    rawDescription: 'REWE MARKT GMBH TROISDORF',
    patterns: [rewePattern, pattern('p-rewe2', REWE, ['REWE', 'MARKT'])],
    merchants: MERCHANTS,
  })
  ok('7. two patterns of the same merchant still resolve unambiguously',
     alias.status === FINANCE_STATUS.RESOLVED && alias.merchantId === REWE && alias.matches.length === 2)

  // 8. Two merchants — never a winner.
  const clash = matchMerchant({
    rawDescription: 'REWE TO GO IM EDEKA CENTER',
    patterns: [rewePattern, pattern('p-edeka', EDEKA, ['EDEKA'])],
    merchants: MERCHANTS,
  })
  ok('8. patterns of different merchants end in a conflict',
     clash.status === FINANCE_STATUS.CONFLICT && clash.merchantId === null)
  ok('8b. and both candidates are named', clash.merchantIds.join(',') === [EDEKA, REWE].sort().join(','))

  // The longer, more specific phrase must not quietly win. Nobody has defined
  // that behaviour, so the conservative answer is the only allowed one.
  const specific = matchMerchant({
    rawDescription: 'MAX UND MORITZ REWE PARTNER',
    patterns: [rewePattern, phrase],
    merchants: MERCHANTS,
  })
  ok('8c. a longer phrase does not outrank a token of another merchant',
     specific.status === FINANCE_STATUS.CONFLICT)

  // Inactive patterns are history, not rules.
  ok('a deactivated pattern matches nothing',
     matchMerchant({
       rawDescription: 'REWE TROISDORF',
       patterns: [pattern('p-old', REWE, ['REWE'], { active: false })],
       merchants: MERCHANTS,
     }).status === FINANCE_STATUS.UNRESOLVED)

  // A pattern pointing at a merchant we do not hold is doubt, and doubt is
  // unresolved — never "resolved to an id we know nothing about".
  ok('a pattern of an unknown merchant resolves nothing',
     matchMerchant({
       rawDescription: 'REWE TROISDORF',
       patterns: [pattern('p-x', 'm-weg', ['REWE'])],
       merchants: MERCHANTS,
     }).reason === 'merchant_unknown')

  ok('the result does not depend on the order the rows arrive in',
     JSON.stringify(matchMerchant({ rawDescription: 'REWE MARKT', patterns: [rewePattern, pattern('p-rewe2', REWE, ['REWE','MARKT'])], merchants: MERCHANTS })) ===
     JSON.stringify(matchMerchant({ rawDescription: 'REWE MARKT', patterns: [pattern('p-rewe2', REWE, ['REWE','MARKT']), rewePattern], merchants: MERCHANTS })))

  ok('a pattern row with the wrong arity is not reinterpreted',
     !patternMatches({ pattern_type: 'exact_token', tokens: ['REWE','MARKT'], active: true }, ['REWE','MARKT']) &&
     !patternMatches({ pattern_type: 'exact_phrase', tokens: ['REWE'], active: true }, ['REWE']))
  ok('an unknown pattern type matches nothing',
     !patternMatches({ pattern_type: 'regex', tokens: ['REWE'], active: true }, ['REWE']))
}

// ── D. Category resolution ──────────────────────────────────────────────────
{
  const reweMatch = matchMerchant({
    rawDescription: 'REWE TROISDORF SAGT DANKE 8407',
    patterns: [pattern('p-rewe', REWE, ['REWE'])],
    merchants: MERCHANTS,
  })
  const reweDefault = rule('r-rewe', REWE, LEBENSMITTEL)

  const plain = resolveCategory({
    transaction: tx('t1', 'REWE TROISDORF SAGT DANKE 8407'),
    merchantMatch: reweMatch, rules: [reweDefault],
  })
  ok('a merchant default rule resolves the category',
     plain.status === FINANCE_STATUS.RESOLVED && plain.categoryId === LEBENSMITTEL)
  ok('…and says it was the default rule', plain.source === CATEGORY_SOURCE.DEFAULT_RULE)
  ok('a rule without bounds is the default rule',
     isDefaultRule(reweDefault) && !isDefaultRule(rule('x', REWE, LEBENSMITTEL, { max_amount_minor: 1200, currency: 'EUR' })))

  ok('no merchant means no category',
     resolveCategory({
       transaction: tx('t2', 'UNBEKANNT'),
       merchantMatch: matchMerchant({ rawDescription: 'UNBEKANNT', patterns: [], merchants: MERCHANTS }),
       rules: [reweDefault],
     }).status === FINANCE_STATUS.UNRESOLVED)

  ok('a merchant conflict is a category conflict',
     resolveCategory({
       transaction: tx('t3', 'REWE IM EDEKA'),
       merchantMatch: { status: FINANCE_STATUS.CONFLICT, merchantId: null },
       rules: [reweDefault],
     }).status === FINANCE_STATUS.CONFLICT)

  ok('a merchant without any rule stays unresolved and says so',
     resolveCategory({ transaction: tx('t4', 'REWE'), merchantMatch: reweMatch, rules: [] }).reason === 'no_rule_for_merchant')

  // 9. always_review: recognised, never finalised.
  const watched = matchMerchant({
    rawDescription: 'REWE TROISDORF',
    patterns: [pattern('p-rewe', REWE, ['REWE'])],
    merchants: [merchant(REWE, { review_mode: 'always_review' })],
  })
  ok('9. an always_review merchant is still recognised',
     watched.status === FINANCE_STATUS.RESOLVED && watched.merchantId === REWE)
  const watchedCategory = resolveCategory({
    transaction: tx('t5', 'REWE TROISDORF'), merchantMatch: watched, rules: [reweDefault],
  })
  ok('9b. but its category is never decided automatically',
     watchedCategory.status === FINANCE_STATUS.REVIEW_REQUIRED && watchedCategory.categoryId === null)
  ok('9c. the rule result travels along as a suggestion, not as a decision',
     watchedCategory.suggestedCategoryId === LEBENSMITTEL && watchedCategory.merchantId === REWE)

  // 10./11. The EDEKA boundary, in both directions and in both signs.
  const edekaMatch = matchMerchant({
    rawDescription: 'EDEKA MARKT TROISDORF',
    patterns: [pattern('p-edeka', EDEKA, ['EDEKA'])],
    merchants: MERCHANTS,
  })
  const edekaRules = [
    rule('r-klein', EDEKA, RESTAURANT, { max_amount_minor: 1200, max_inclusive: true, currency: 'EUR' }),
    rule('r-gross', EDEKA, LEBENSMITTEL, { min_amount_minor: 1200, min_inclusive: false, currency: 'EUR' }),
  ]
  const atEdeka = (amount) =>
    resolveCategory({
      transaction: tx('t-e', 'EDEKA MARKT TROISDORF', { amount_minor: amount }),
      merchantMatch: edekaMatch, rules: edekaRules,
    })

  ok('10. EDEKA für 12,00 € ist Restaurant', atEdeka(1200).categoryId === RESTAURANT)
  ok('11. EDEKA für 12,01 € ist Lebensmittel', atEdeka(1201).categoryId === LEBENSMITTEL)
  ok('10b. and one cent below the boundary is still Restaurant', atEdeka(1199).categoryId === RESTAURANT)
  ok('11b. the resolved rule is named, so a screen can show why',
     atEdeka(1201).ruleId === 'r-gross' && atEdeka(1201).source === CATEGORY_SOURCE.RULE)

  // A bank books a purchase as a negative amount. A rule about "under 12 €" is
  // about the size of the purchase, so the sign must not turn it upside down.
  ok('10c. the same booking as the bank reports it (negative) decides the same way',
     atEdeka(-1200).categoryId === RESTAURANT && atEdeka(-1201).categoryId === LEBENSMITTEL)

  ok('an amount rule in another currency does not apply',
     resolveCategory({
       transaction: tx('t-c', 'EDEKA', { amount_minor: 1000, currency: 'AUD' }),
       merchantMatch: edekaMatch, rules: edekaRules,
     }).status === FINANCE_STATUS.UNRESOLVED)

  ok('both ends can be exclusive',
     ruleMatchesAmount(rule('r', EDEKA, RESTAURANT, { min_amount_minor: 1000, min_inclusive: false, currency: 'EUR' }), { amount_minor: 1000, currency: 'EUR' }) === false &&
     ruleMatchesAmount(rule('r', EDEKA, RESTAURANT, { min_amount_minor: 1000, min_inclusive: false, currency: 'EUR' }), { amount_minor: 1001, currency: 'EUR' }) === true)
  ok('a bounded rule cannot match a booking without a usable amount',
     ruleMatchesAmount(rule('r', EDEKA, RESTAURANT, { max_amount_minor: 1200, currency: 'EUR' }), { amount_minor: null, currency: 'EUR' }) === false)
  ok('an amount rule beats the merchant default when it matches',
     resolveCategory({
       transaction: tx('t-d', 'EDEKA', { amount_minor: -500 }),
       merchantMatch: edekaMatch,
       rules: [...edekaRules, rule('r-default', EDEKA, LEBENSMITTEL)],
     }).categoryId === RESTAURANT)

  // 12. Two matching rules that disagree.
  const overlapping = resolveCategory({
    transaction: tx('t6', 'EDEKA', { amount_minor: -1000 }),
    merchantMatch: edekaMatch,
    rules: [
      rule('r-a', EDEKA, RESTAURANT, { max_amount_minor: 1200, currency: 'EUR' }),
      rule('r-b', EDEKA, LEBENSMITTEL, { min_amount_minor: 500, currency: 'EUR' }),
    ],
  })
  ok('12. two overlapping rules with different categories are a conflict',
     overlapping.status === FINANCE_STATUS.CONFLICT && overlapping.categoryId === null)
  ok('12b. and both rules are named instead of one being picked',
     overlapping.candidateRuleIds.join(',') === 'r-a,r-b')
  ok('12c. two overlapping rules that agree are not a conflict',
     resolveCategory({
       transaction: tx('t7', 'EDEKA', { amount_minor: -1000 }),
       merchantMatch: edekaMatch,
       rules: [
         rule('r-a', EDEKA, RESTAURANT, { max_amount_minor: 1200, currency: 'EUR' }),
         rule('r-b', EDEKA, RESTAURANT, { min_amount_minor: 500, currency: 'EUR' }),
       ],
     }).categoryId === RESTAURANT)

  // A 'conditional' merchant: an amount rule may decide, the default may not.
  const conditional = matchMerchant({
    rawDescription: 'EDEKA MARKT',
    patterns: [pattern('p-edeka', EDEKA, ['EDEKA'])],
    merchants: [merchant(EDEKA, { review_mode: 'conditional' })],
  })
  ok('a conditional merchant accepts an amount rule that matched',
     resolveCategory({
       transaction: tx('t8', 'EDEKA MARKT', { amount_minor: -1500 }),
       merchantMatch: conditional, rules: edekaRules,
     }).categoryId === LEBENSMITTEL)
  ok('…and asks when only the default rule is left',
     resolveCategory({
       transaction: tx('t9', 'EDEKA MARKT', { amount_minor: -1500 }),
       merchantMatch: conditional, rules: [rule('r-default', EDEKA, LEBENSMITTEL)],
     }).status === FINANCE_STATUS.REVIEW_REQUIRED)

  // 13. A manual override beats every rule.
  const overridden = resolveCategory({
    transaction: tx('t10', 'REWE TROISDORF'),
    merchantMatch: reweMatch,
    rules: [reweDefault],
    override: { transaction_id: 't10', category_id: DROGERIE, merchant_id: DM },
  })
  ok('13. a manual override wins against the automatic category',
     overridden.categoryId === DROGERIE && overridden.source === CATEGORY_SOURCE.OVERRIDE)
  ok('13b. …and is marked as a decision nothing may overwrite', overridden.locked === true)
  ok('13c. …including which merchant the user decided on', overridden.merchantId === DM)

  // 14. A locked booking survives a re-evaluation unchanged.
  const locked = resolveCategory({
    transaction: tx('t11', 'REWE TROISDORF', { manual_lock: true, category_id: RESTAURANT, merchant_id: REWE }),
    merchantMatch: reweMatch,
    rules: [reweDefault],
  })
  ok('14. a locked booking keeps the category it was given',
     locked.categoryId === RESTAURANT && locked.source === CATEGORY_SOURCE.MANUAL_LOCK && locked.locked === true)
  ok('14b. a locked booking without a category is not helpfully filled in either',
     resolveCategory({
       transaction: tx('t12', 'REWE TROISDORF', { manual_lock: true }),
       merchantMatch: reweMatch, rules: [reweDefault],
     }).categoryId === null)

  // Analytics inclusion: a transfer or money coming back is not spending.
  ok('a booking counts by default', resolveInclusion({ transaction: tx('t13', 'X') }) === true)
  ok('an excluded booking does not',
     resolveInclusion({ transaction: tx('t14', 'X', { include_in_analytics: false }) }) === false)
  ok('and the user\\'s own decision beats what the import wrote',
     resolveInclusion({
       transaction: tx('t15', 'X', { include_in_analytics: true }),
       override: { include_in_analytics: false },
     }) === false)
}

// ── E. The backtest: what a pattern would do before it exists ───────────────
{
  const transactions = [
    tx('t-1', 'REWE TROISDORF SAGT DANKE 8407'),
    tx('t-2', 'REWE MARKT KOELN'),
    tx('t-3', 'REWERT UND SOEHNE'),
    tx('t-4', 'EDEKA REWE PARTNER MARKT'),
    tx('t-5', 'REWE CITY BONN', { manual_lock: true }),
    tx('t-6', 'REWE SUED', { merchant_id: DM }),
    tx('t-7', 'DM DROGERIEMARKT'),
  ]
  const existing = [pattern('p-edeka', EDEKA, ['EDEKA'])]
  const report = backtestPattern({
    pattern: { pattern_type: 'exact_token', tokens: ['REWE'] },
    merchantId: REWE, transactions, patterns: existing,
  })

  // 15. The hit set.
  ok('15. the backtest counts exactly the bookings the pattern matches',
     report.matchCount === 5 && report.transactionIds.join(',') === 't-1,t-2,t-4,t-5,t-6')
  ok('15b. REWERT is not among them', !report.transactionIds.includes('t-3'))
  ok('15c. bookings already assigned to another merchant are reported',
     report.assignedMerchantIds.join(',') === DM && report.assignedCounts[DM] === 1)
  ok('15d. …and so is the merchant conflict that would create',
     report.merchantConflicts.some((c) => c.transactionId === 't-6' && c.merchantIds.join(',') === [DM, REWE].sort().join(',')))
  ok('15e. a booking another merchant\\'s pattern already claims is a conflict too',
     report.merchantConflicts.some((c) => c.transactionId === 't-4'))
  ok('15f. locked bookings are counted, not hidden', report.lockedCount === 1)
  ok('15g. only the untouched bookings would actually be assigned',
     report.applicableTransactionIds.join(',') === 't-1,t-2,t-4')
  ok('15h. the unassigned count is what the UI would put in the sentence',
     report.unassignedCount === 4 && report.assignedCount === 1)

  const duplicate = backtestPattern({
    pattern: { pattern_type: 'exact_token', tokens: ['EDEKA'] },
    merchantId: EDEKA, transactions, patterns: existing,
  })
  ok('15i. an identical pattern of the same merchant is reported as a duplicate',
     duplicate.patternConflicts.length === 1 && duplicate.patternConflicts[0].reason === 'duplicate')
  const stolen = backtestPattern({
    pattern: { pattern_type: 'exact_token', tokens: ['EDEKA'] },
    merchantId: REWE, transactions, patterns: existing,
  })
  ok('15j. the same pattern under a different merchant is a pattern conflict',
     stolen.patternConflicts[0].reason === 'other_merchant')

  const phraseReport = backtestPattern({
    pattern: { pattern_type: 'exact_phrase', tokens: ['REWE', 'MARKT'] },
    merchantId: REWE, transactions, patterns: [],
  })
  ok('15k. a phrase hits only where it stands contiguously',
     phraseReport.transactionIds.join(',') === 't-2')
  ok('a backtest against nothing is empty, not an error',
     backtestPattern().matchCount === 0)
  ok('a booking with an override counts as decided',
     backtestPattern({
       pattern: { pattern_type: 'exact_token', tokens: ['REWE'] },
       merchantId: REWE, transactions,
       overrides: [{ transaction_id: 't-1', category_id: DROGERIE }],
     }).applicableTransactionIds.join(',') === 't-2,t-4')
}

// ── F. Learning a merchant: one gesture, one checked request ───────────────
{
  const transactions = [
    tx('t-1', 'REWE TROISDORF SAGT DANKE 8407'),
    tx('t-2', 'REWE MARKT KOELN'),
    tx('t-3', 'REWE CITY BONN', { manual_lock: true }),
  ]
  const base = {
    transaction: transactions[0],
    selection: 'REWE',
    categorySlug: 'lebensmittel',
    merchantName: 'REWE',
    transactions,
    patterns: [],
  }

  // 16. Merchant + pattern + rule + booking, as one request.
  const learn = buildLearnRequest(base)
  ok('16. a complete gesture is valid', learn.valid && learn.errors.length === 0)
  ok('16b. it names the merchant to create, the pattern and the category',
     learn.request.p_merchant_name === 'REWE' &&
     learn.request.p_pattern_type === 'exact_token' &&
     learn.request.p_tokens.join(',') === 'REWE' &&
     learn.request.p_category_slug === 'lebensmittel')
  ok('16c. and the booking the user was looking at',
     learn.request.p_transaction_id === 't-1')
  ok('16d. the merchant rule it creates has no amount condition by default',
     learn.request.p_min_amount_minor === null && learn.request.p_max_amount_minor === null &&
     learn.request.p_rule_currency === null)
  ok('16e. the other untouched bookings come along, the locked one does not',
     learn.request.p_apply_transaction_ids.join(',') === 't-2')
  ok('16f. the backtest the user would have seen is part of the answer',
     learn.backtest.matchCount === 3)

  // What the user marked is taken literally: the software never generalises
  // "REWE TROISDORF" into "REWE" on its own, and never invents a pattern.
  const marked = buildLearnRequest({ ...base, selection: 'REWE TROISDORF' })
  ok('a two-word selection becomes a phrase, not a guessed single token',
     marked.request.p_pattern_type === 'exact_phrase' &&
     marked.request.p_tokens.join(',') === 'REWE,TROISDORF')
  ok('a selection is normalised on the way in',
     buildLearnRequest({ ...base, selection: ' rewe ' }).request.p_tokens.join(',') === 'REWE')

  // The guard against a pattern nobody marked.
  const invented = buildLearnRequest({ ...base, selection: 'ALDI' })
  ok('a pattern that does not occur in this booking is refused',
     !invented.valid && invented.errors.some((e) => e.code === 'pattern_not_in_description'))
  ok('…and nothing is built from it', invented.request === null)

  for (const [name, input, code] of [
    ['without a selection', { selection: '   ' }, 'selection_empty'],
    ['without a category', { categorySlug: null }, 'category_unknown'],
    ['with a category nobody has', { categorySlug: 'events' }, 'category_unknown'],
    ['without a merchant', { merchantName: '  ', merchantId: null }, 'merchant_missing'],
    ['with an unknown review mode', { reviewMode: 'vielleicht' }, 'review_mode_unknown'],
    ['with an inverted amount range', { bounds: { minAmountMinor: 2000, maxAmountMinor: 1000 } }, 'bounds_inverted'],
    ['with a negative bound', { bounds: { maxAmountMinor: -100 } }, 'bound_negative'],
    ['with a fractional bound', { bounds: { maxAmountMinor: 12.5 } }, 'bound_not_integer'],
    ['with a phrase declared as a single token', { selection: 'REWE TROISDORF', patternType: 'exact_token' }, 'pattern_type_mismatch'],
    ['without a booking', { transaction: null }, 'transaction_missing'],
  ]) {
    const result = buildLearnRequest({ ...base, ...input })
    ok('a gesture ' + name + ' is refused', !result.valid && result.errors.some((e) => e.code === code))
  }

  ok('every refusal carries a sentence a screen can show',
     buildLearnRequest({ ...base, categorySlug: null }).errors.every((e) => e.message.length > 0))

  // The EDEKA case, as the user would set it up.
  const edeka = buildLearnRequest({
    transaction: tx('t-e', 'EDEKA MARKT TROISDORF', { amount_minor: -800 }),
    selection: 'EDEKA',
    categorySlug: 'restaurant',
    merchantName: 'EDEKA',
    bounds: { maxAmountMinor: 1200, maxInclusive: true },
    transactions: [],
    patterns: [],
  })
  ok('an amount condition is passed through as given',
     edeka.request.p_max_amount_minor === 1200 && edeka.request.p_max_inclusive === true)
  ok('…and a bound without a currency takes the one of the booking',
     edeka.request.p_rule_currency === 'EUR')

  ok('an existing merchant is reused instead of being re-created by name',
     buildLearnRequest({ ...base, merchantId: 'm-rewe', merchantName: 'egal' }).request.p_merchant_name === null)

  // Only categories the account actually has may be chosen.
  ok('a category list from the database is what gets validated against',
     !buildLearnRequest({ ...base, categorySlug: 'drogerie', categories: [{ slug: 'lebensmittel' }] }).valid)
}

// ── G. What a client may write ──────────────────────────────────────────────
// Same property tools/dataLogic.mjs asserts for tasks and tools/listLogic.mjs
// for lists: a caller cannot name a server-managed column, whatever it hands
// the repository. Here it carries one more promise — the raw half of a booking
// cannot be rewritten after the import.
{
  for (const [name, fields] of [
    ['transactions', WRITABLE_FINANCE_TRANSACTION_FIELDS],
    ['patterns', WRITABLE_FINANCE_PATTERN_FIELDS],
    ['rules', WRITABLE_FINANCE_RULE_FIELDS],
    ['overrides', WRITABLE_FINANCE_OVERRIDE_FIELDS],
  ]) {
    ok(name + ' have a whitelist, not a guess', fields.length > 0)
    ok(name + ' never let a client write id, user_id or created_at',
       !fields.includes('id') && !fields.includes('user_id') && !fields.includes('created_at'))
  }

  const raw = ['booking_date', 'value_date', 'amount_minor', 'currency', 'raw_description', 'external_reference']
  ok('the import may write the raw half of a booking',
     raw.every((f) => WRITABLE_FINANCE_TRANSACTION_FIELDS.includes(f)))
  ok('and no later update can touch a single column of it',
     raw.every((f) => !WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS.includes(f)))
  ok('what an update may change is exactly the interpretation',
     WRITABLE_FINANCE_TRANSACTION_PATCH_FIELDS.filter((f) => f !== 'updated_at').join(',') ===
       'merchant_id,category_id,transaction_type,refunds_transaction_id,include_in_analytics,manual_lock')

  const smuggled = pickWritableFinanceTransaction({
    raw_description: 'REWE', amount_minor: -2483, booking_date: '2026-09-05',
    id: 'geschmuggelt', user_id: 'jemand-anders', created_at: '1999-01-01T00:00:00.000Z',
  })
  ok('a whole row handed in comes back without its server-managed columns',
     Object.keys(smuggled).sort().join(',') === 'amount_minor,booking_date,raw_description')
  ok('a patch cannot rewrite what a booking said it was',
     Object.keys(pickFinanceTransactionPatch({ raw_description: 'ETWAS ANDERES', amount_minor: -1, category_id: 'c' }))
       .join(',') === 'category_id')
  ok('a pattern is created or deactivated, never edited in place',
     WRITABLE_FINANCE_PATTERN_PATCH_FIELDS.filter((f) => f !== 'updated_at').join(',') === 'active')
  ok('…so no patch can change what a pattern ever matched',
     Object.keys(pickFinancePatternPatch({ tokens: ['ANDERS'], pattern_type: 'exact_phrase', active: false }))
       .join(',') === 'active')
}

console.log(\`finance logic: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
