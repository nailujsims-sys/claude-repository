// The vocabulary of the Finanzen module: the categories, the pattern types, the
// review modes, the transaction types. Data only — no React, no Supabase, no
// behaviour — like src/config/listTemplates.js.
//
// Every list here has a counterpart in supabase/migrations/0008_finance.sql
// (a check constraint or the seeded category set). tools/financeLogic.mjs reads
// both and fails when they drift apart, because a value the database refuses is
// a screen that breaks on save.

// ── Categories ──────────────────────────────────────────────────────────────
// Seit v1.26 zweistufig: Oberkategorien strukturieren, Unterkategorien werden
// zugeordnet. `slug` ist der stabile technische Schlüssel, auf den Regeln, der
// KI-Prompt und der Code zeigen; `label` ist das, was ein Mensch liest, und darf
// umbenannt werden, ohne eine Regel zu brechen.
//
// GENAU ZWEI EBENEN, und die Datenbank setzt es durch (0014). `parent_id is
// null` heißt Oberkategorie, `parent_id` gesetzt heißt Unterkategorie. Eine
// dritte Ebene lehnt der Trigger `finance_categories_hierarchy_guard` ab.
//
// NUR BLÄTTER SIND ZUORDENBAR. Eine Oberkategorie ist eine Überschrift, keine
// Kategorie einer Buchung — siehe `finance_category_is_leaf` und den Trigger
// `finance_category_assignable_guard` in 0014, die das an fünf Tabellen
// durchsetzen, statt an zehn Stellen im Client.
//
// FÜNF SLUGS SIND ÄLTER ALS DIESE LISTE — `lebensmittel`, `restaurant`,
// `klamotten`, `drogerie`, `sonstige`. Sie behalten ihre IDs und ihre Zeilen;
// 0014 hängt sie nur unter die passende Oberkategorie und benennt drei davon um.
// Deshalb steht hier auch kein „Events": es war nie eine der vereinbarten
// Kategorien (siehe 0008).
//
// Das alte Excel-Tracker-Label „Events" ist weiterhin nicht Teil dieser Liste;
// was darunter gebucht war, liegt in „Allgemeines Sonstiges", bis ein Mensch
// etwas anderes sagt.
export const FINANCE_CATEGORY_TREE = [
  {
    slug: 'essen_trinken',
    label: 'Essen & Trinken',
    sort_order: 100,
    icon: 'utensils',
    children: [
      { slug: 'lebensmittel', label: 'Lebensmittel', sort_order: 110 },
      { slug: 'restaurant', label: 'Restaurants & Cafés', sort_order: 120 },
    ],
  },
  {
    slug: 'shopping',
    label: 'Shopping',
    sort_order: 200,
    icon: 'shopping-bag',
    children: [
      { slug: 'klamotten', label: 'Kleidung', sort_order: 210 },
      { slug: 'technik', label: 'Technik', sort_order: 220 },
      { slug: 'shopping_sonstige', label: 'Allgemeines Shopping', sort_order: 230 },
    ],
  },
  {
    slug: 'mobilitaet',
    label: 'Mobilität',
    sort_order: 300,
    icon: 'car',
    children: [
      { slug: 'auto_tanken', label: 'Auto & Tanken', sort_order: 310 },
      { slug: 'bahn_oepnv', label: 'Bahn & ÖPNV', sort_order: 320 },
      { slug: 'taxi_sharing', label: 'Taxi & Sharing', sort_order: 330 },
      { slug: 'parken', label: 'Parken', sort_order: 340 },
      { slug: 'fluege', label: 'Flüge', sort_order: 350 },
    ],
  },
  {
    slug: 'drogerie_pflege',
    label: 'Drogerie & Pflege',
    sort_order: 400,
    icon: 'sparkles',
    children: [
      { slug: 'drogerie', label: 'Drogerie', sort_order: 410 },
      { slug: 'friseur_pflege', label: 'Friseur & Pflege', sort_order: 420 },
    ],
  },
  {
    slug: 'wohnen_haushalt',
    label: 'Wohnen & Haushalt',
    sort_order: 500,
    icon: 'house',
    children: [
      { slug: 'miete_nebenkosten', label: 'Miete & Nebenkosten', sort_order: 510 },
      { slug: 'haushalt', label: 'Haushalt', sort_order: 520 },
      { slug: 'moebel_einrichtung', label: 'Möbel & Einrichtung', sort_order: 530 },
    ],
  },
  {
    slug: 'freizeit',
    label: 'Freizeit',
    sort_order: 600,
    icon: 'ticket',
    children: [
      { slug: 'events_kultur', label: 'Events & Kultur', sort_order: 610 },
      { slug: 'games_medien', label: 'Games & Medien', sort_order: 620 },
      { slug: 'ausgehen', label: 'Ausgehen', sort_order: 630 },
      { slug: 'freizeit_sonstige', label: 'Allgemeine Freizeit', sort_order: 640 },
    ],
  },
  {
    slug: 'gesundheit_sport',
    label: 'Gesundheit & Sport',
    sort_order: 700,
    icon: 'heart-pulse',
    children: [
      { slug: 'gesundheit', label: 'Gesundheit', sort_order: 710 },
      { slug: 'fitnessstudio', label: 'Fitnessstudio', sort_order: 720 },
      { slug: 'sport_ausruestung', label: 'Sportausrüstung', sort_order: 730 },
    ],
  },
  {
    slug: 'bildung',
    label: 'Bildung',
    sort_order: 800,
    icon: 'graduation-cap',
    children: [
      { slug: 'studium_schule', label: 'Studium & Schule', sort_order: 810 },
      { slug: 'buecher_lernmaterial', label: 'Bücher & Lernmaterial', sort_order: 820 },
      { slug: 'kurse_weiterbildung', label: 'Kurse & Weiterbildung', sort_order: 830 },
    ],
  },
  {
    slug: 'sonstiges_parent',
    label: 'Sonstiges',
    sort_order: 900,
    icon: 'circle-dashed',
    children: [{ slug: 'sonstige', label: 'Allgemeines Sonstiges', sort_order: 910 }],
  },
]

// Die fünf Slugs, die es vor v1.26 schon gab. Sie sind hier aufgeschrieben,
// weil „diese IDs bleiben erhalten" eine Zusage ist, die eine Prüfung braucht
// (tools/financeLogic.mjs liest die Liste gegen 0008 und 0014).
export const FINANCE_LEGACY_CATEGORY_SLUGS = [
  'lebensmittel',
  'restaurant',
  'klamotten',
  'drogerie',
  'sonstige',
]

// Die drei Labels, die v1.26 ändert — und zwar NUR, solange die Zeile noch das
// ursprüngliche Label trägt. Wer selbst umbenannt hat, behält seinen Namen.
export const FINANCE_RENAMED_CATEGORY_LABELS = Object.freeze({
  restaurant: { from: 'Restaurant', to: 'Restaurants & Cafés' },
  klamotten: { from: 'Klamotten', to: 'Kleidung' },
  sonstige: { from: 'Sonstige', to: 'Allgemeines Sonstiges' },
})

// Die Oberkategorien, flach.
export const FINANCE_PARENT_CATEGORIES = FINANCE_CATEGORY_TREE.map(
  ({ slug, label, sort_order, icon }) => ({ slug, label, sort_order, icon })
)

// Die zuordenbaren Kategorien, flach — mit dem Slug ihrer Oberkategorie.
export const FINANCE_CHILD_CATEGORIES = FINANCE_CATEGORY_TREE.flatMap((parent) =>
  parent.children.map((child) => ({ ...child, parent_slug: parent.slug }))
)

// Alle Kategorien in Seed-Reihenfolge: jede Oberkategorie vor ihren Kindern,
// weil die Datenbank die Eltern-Zeile braucht, bevor ein Kind auf sie zeigt.
export const FINANCE_CATEGORIES = FINANCE_CATEGORY_TREE.flatMap((parent) => [
  { slug: parent.slug, label: parent.label, sort_order: parent.sort_order, parent_slug: null },
  ...parent.children.map((child) => ({
    slug: child.slug,
    label: child.label,
    sort_order: child.sort_order,
    parent_slug: parent.slug,
  })),
])

export const FINANCE_CATEGORY_SLUGS = FINANCE_CATEGORIES.map((c) => c.slug)

// Was in der Spalte „Kategorie" einer Buchung stehen darf: die Blätter, sonst
// nichts. Der KI-Prompt, jeder Picker und die Validierung lesen diese Liste.
export const FINANCE_ASSIGNABLE_CATEGORY_SLUGS = FINANCE_CHILD_CATEGORIES.map((c) => c.slug)

export const isCategorySlug = (slug) => FINANCE_CATEGORY_SLUGS.includes(slug)

export const isAssignableCategorySlug = (slug) =>
  FINANCE_ASSIGNABLE_CATEGORY_SLUGS.includes(slug)

// Das Lucide-Icon einer Oberkategorie, als Name. Ein Name und keine Komponente,
// weil diese Datei Daten enthält und kein React — die Zuordnung Name → Glyph
// macht src/components/CategoryIcon.jsx.
export const FINANCE_CATEGORY_ICONS = Object.freeze(
  Object.fromEntries(FINANCE_CATEGORY_TREE.map((p) => [p.slug, p.icon]))
)

// The visible name of a seeded category. A category the user renamed or added
// lives in the database, so a caller that has the row should read its `label`;
// this is the fallback for the ones the app ships with.
export const categoryLabel = (slug) =>
  FINANCE_CATEGORIES.find((c) => c.slug === slug)?.label ?? ''

// Der Slug der Oberkategorie eines Blattes — für die Fälle, in denen nur die
// ausgelieferte Taxonomie vorliegt und keine Datenbankzeile.
export const parentCategorySlug = (slug) =>
  FINANCE_CHILD_CATEGORIES.find((c) => c.slug === slug)?.parent_slug ?? null

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

// Wie eine Buchungsart heißt, wenn ein Mensch sie liest. Die technischen Werte
// oben sind, was die Datenbank speichert; diese Zeile ist, was auf dem Bildschirm
// steht — und beide Listen sind hier nebeneinander, damit keine Oberfläche sich
// ihre eigene Übersetzung ausdenkt.
export const TRANSACTION_TYPE_LABELS = Object.freeze({
  purchase: 'Kauf',
  refund: 'Retoure',
  transfer: 'Umbuchung',
  income: 'Einnahme',
  fee: 'Gebühr',
  other: 'Sonstiges',
})

export const transactionTypeLabel = (value) => TRANSACTION_TYPE_LABELS[value] ?? ''

// Today everything is booked in euros. It is a value, not an assumption: every
// amount is stored next to its currency, and every amount bound on a rule names
// the currency it counts in.
export const DEFAULT_FINANCE_CURRENCY = 'EUR'
export const isCurrencyCode = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value)
