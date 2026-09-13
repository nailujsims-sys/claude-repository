// The vocabulary of the Finanzen module: the categories, the pattern types, the
// review modes, the transaction types. Data only — no React, no Supabase, no
// behaviour — like src/config/listTemplates.js.
//
// Every list here has a counterpart in supabase/migrations/0008_finance.sql
// (a check constraint or the seeded category set). tools/financeLogic.mjs reads
// both and fails when they drift apart, because a value the database refuses is
// a screen that breaks on save.

// ── Categories ──────────────────────────────────────────────────────────────
// The decided MVP set. `slug` is the stable technical key rules and code refer
// to; `label` is what a human reads and may be renamed without breaking a rule.
//
// The old Excel tracker also carried an "Events" label. It is deliberately NOT
// part of this set: it was never one of the agreed categories, and importing it
// here would turn a leftover column header into a product decision. Whatever
// was booked under it lands in "Sonstige" until a human says otherwise.
export const FINANCE_CATEGORIES = [
  { slug: 'lebensmittel', label: 'Lebensmittel', sort_order: 10 },
  { slug: 'restaurant', label: 'Restaurant', sort_order: 20 },
  { slug: 'klamotten', label: 'Klamotten', sort_order: 30 },
  { slug: 'drogerie', label: 'Drogerie', sort_order: 40 },
  { slug: 'sonstige', label: 'Sonstige', sort_order: 50 },
]

export const FINANCE_CATEGORY_SLUGS = FINANCE_CATEGORIES.map((c) => c.slug)

export const isCategorySlug = (slug) => FINANCE_CATEGORY_SLUGS.includes(slug)

// The visible name of a seeded category. A category the user renamed or added
// lives in the database, so a caller that has the row should read its `label`;
// this is the fallback for the five the app ships with.
export const categoryLabel = (slug) =>
  FINANCE_CATEGORIES.find((c) => c.slug === slug)?.label ?? ''

// ── Patterns ────────────────────────────────────────────────────────────────
// exact_token  — one token, matched as a whole token
// exact_phrase — two or more tokens, in order and next to each other
export const PATTERN_TYPES = ['exact_token', 'exact_phrase']
export const isPatternType = (value) => PATTERN_TYPES.includes(value)

// ── Merchants ───────────────────────────────────────────────────────────────
// How much the automatic category resolution may decide on its own:
//   auto           — an unambiguous rule result is applied
//   conditional    — only an amount rule that actually matched is applied;
//                    falling back to the merchant's default rule asks the user
//   always_review  — the merchant is recognised, the category never decided
export const REVIEW_MODES = ['auto', 'conditional', 'always_review']
export const DEFAULT_REVIEW_MODE = 'auto'
export const isReviewMode = (value) => REVIEW_MODES.includes(value)

// ── Transactions ────────────────────────────────────────────────────────────
// A Retoure is its own booking of type 'refund', never a correction of the
// original one — the original keeps the amount that was actually paid.
export const TRANSACTION_TYPES = ['purchase', 'refund', 'transfer', 'income', 'fee', 'other']
export const DEFAULT_TRANSACTION_TYPE = 'purchase'
export const isTransactionType = (value) => TRANSACTION_TYPES.includes(value)

// Today everything is booked in euros. It is a value, not an assumption: every
// amount is stored next to its currency, and every amount bound on a rule names
// the currency it counts in.
export const DEFAULT_FINANCE_CURRENCY = 'EUR'
export const isCurrencyCode = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value)
