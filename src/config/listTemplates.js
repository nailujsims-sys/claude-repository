// ── The Listen module's templates ───────────────────────────────────────────
//
// Data only, and deliberately free of React and of lucide: the selectors and
// the quick-add parser read this file, and both are pure logic that has to stay
// testable without bundling an icon library (see tools/listLogic.mjs). The
// icons themselves live next door in listIcons.js.
//
// ── Templates ───────────────────────────────────────────────────────────────
//
// Three, and the `fields` array is what makes them different: it names the
// optional columns an entry of this template may carry (see
// supabase/migrations/0006_lists.sql). Every screen asks the template what to
// render instead of branching on its id, so a fourth template is an entry here
// plus its column — and no `if (template === …)` anywhere else.
//
// `id` is what the database stores and constrains (`lists_template_known`).
export const LIST_TEMPLATES = [
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Einfache Checkliste für alles Mögliche',
    icon: 'clipboard-list',
    fields: [],
    itemPlaceholder: 'Eintrag hinzufügen…',
    emptyLabel: 'Noch keine Einträge',
    emptyHint: 'Tippe oben, um den ersten Eintrag anzulegen.',
  },
  {
    id: 'shopping',
    label: 'Einkauf',
    hint: 'Für Einkaufslisten mit Mengenangaben',
    icon: 'shopping-cart',
    fields: ['quantity', 'unit', 'category'],
    itemPlaceholder: 'Artikel hinzufügen…',
    emptyLabel: 'Noch keine Artikel',
    emptyHint: 'Tippe „Äpfel 6 Stück“ — Menge und Einheit werden übernommen.',
  },
  {
    id: 'money',
    label: 'Geld',
    hint: 'Für offene Beträge von Personen',
    icon: 'user',
    fields: ['amount'],
    itemPlaceholder: 'Person hinzufügen…',
    emptyLabel: 'Noch keine Einträge',
    emptyHint: 'Tippe „Max 25“ — der Betrag wird übernommen.',
  },
]

export const DEFAULT_TEMPLATE = LIST_TEMPLATES[0]

// An unknown id (a row written by a newer version, a hand-edited database)
// falls back to Standard rather than rendering nothing.
export function listTemplate(id) {
  return LIST_TEMPLATES.find((t) => t.id === id) || DEFAULT_TEMPLATE
}

export function templateHasField(template, field) {
  return listTemplate(template).fields.includes(field)
}

// ── Einkauf categories ──────────────────────────────────────────────────────
//
// Optional and entirely manual: an entry is grouped only if the user picked a
// category for it, and everything without one stays in one unlabelled group at
// the top. No automatic categorisation — that is explicitly not part of this
// version, and a wrong guess costs more than no guess.
export const SHOPPING_CATEGORIES = [
  'Obst & Gemüse',
  'Milchprodukte',
  'Backwaren',
  'Fleisch & Fisch',
  'Getränke',
  'Tiefkühl',
  'Vorrat',
  'Haushalt',
  'Sonstiges',
]
