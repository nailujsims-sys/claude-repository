import { listTemplate } from '../config/listTemplates'

// Pure functions that derive every view the Listen module renders. No React and
// no Supabase in here, so the rules can be read in one place and tested without
// a browser (see tools/listLogic.mjs).

// ── Lists ───────────────────────────────────────────────────────────────────

// The overview shows what is not archived; the archive shows the rest. Two
// halves of one predicate, so a row can never be in both or in neither.
export function isActiveList(list) {
  return !list.is_archived
}

const byOrder = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))

// The overview's two groups. Pinned first — that is the whole point of a pin —
// and both halves in the user's own order.
export function splitLists(lists = []) {
  const active = lists.filter(isActiveList).sort(byOrder)
  return {
    pinned: active.filter((l) => l.is_pinned),
    others: active.filter((l) => !l.is_pinned),
  }
}

// The archive, most recently finished first: a list is looked for by when it
// was put away, not by where it used to sit in the overview.
export function archivedLists(lists = []) {
  return lists
    .filter((l) => l.is_archived)
    .sort(
      (a, b) =>
        String(b.archived_at ?? b.updated_at ?? '').localeCompare(
          String(a.archived_at ?? a.updated_at ?? '')
        ) || byOrder(a, b)
    )
}

// ── Entries ─────────────────────────────────────────────────────────────────

export function itemsOfList(items = [], listId) {
  return items.filter((i) => i.list_id === listId)
}

// THE sorting rule of this module (§5 of the brief): open entries always above,
// done entries always below.
//
// Open entries keep the order the user dragged them into. Done entries are
// newest-first, so the row that was just ticked off arrives at the *top* of
// "Erledigt" — the move is then one short step down into a visible place
// instead of a disappearance into the bottom of a long list.
export function partitionItems(items = []) {
  const open = items.filter((i) => !i.is_done).sort(byOrder)
  const done = items
    .filter((i) => i.is_done)
    .sort(
      (a, b) =>
        String(b.done_at ?? b.updated_at ?? '').localeCompare(
          String(a.done_at ?? a.updated_at ?? '')
        ) || byOrder(a, b)
    )
  return { open, done }
}

// Open Einkauf entries, grouped by their category. The unlabelled group comes
// first and is the one every entry starts in: a category is something the user
// sets, never something the app guesses. When nobody has set one, this is a
// single unlabelled group — i.e. exactly the flat list, with no headers drawn.
export function groupByCategory(items = []) {
  // The unlabelled group leads and is therefore created up front; the named
  // ones follow in the order they were first met, which is the user's own entry
  // order. Built this way rather than sorted afterwards: there is exactly one
  // group whose position is fixed, and a comparator that only knows how to move
  // that one is a comparator waiting to be misread.
  const ungrouped = { key: '', label: '', items: [] }
  const groups = [ungrouped]
  const index = new Map([['', ungrouped]])
  for (const item of items) {
    const key = item.category || ''
    if (!index.has(key)) {
      const group = { key, label: key, items: [] }
      index.set(key, group)
      groups.push(group)
    }
    index.get(key).items.push(item)
  }
  // An empty leading group would draw an empty card; the screen skips empty
  // groups anyway, but not returning one keeps "how many groups are there?"
  // an honest question.
  return groups.filter((g) => g.items.length > 0)
}

export function hasCategories(items = []) {
  return items.some((i) => !!i.category)
}

// The next free slot at the end of the open entries. New entries land at the
// bottom of the open group, which is where a user who is still typing looks.
export function nextSortOrder(items = []) {
  return items.reduce((max, i) => Math.max(max, i.sort_order ?? 0), -1) + 1
}

// ── Formatting ──────────────────────────────────────────────────────────────

const euro = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

export function formatAmount(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return ''
  return euro.format(value)
}

// "6 Stück", "500 g", "2" — and nothing at all when no quantity was given.
// The unit alone is never shown: "g" without a number says less than silence.
export function formatQuantity(quantity, unit) {
  if (quantity === null || quantity === undefined || quantity === '') return ''
  const value = Number(quantity)
  if (!Number.isFinite(value)) return ''
  // The column is numeric(12,3) so a whole number comes back as "6", and 0.5 as
  // "0,5" — German decimals, like every other number in the app.
  const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(value)
  return unit ? `${number} ${unit}` : number
}

// What a row shows on its right-hand side, decided by the template rather than
// by which columns happen to be filled.
export function itemTrailingLabel(item, template) {
  const fields = listTemplate(template).fields
  if (fields.includes('amount')) return formatAmount(item.amount)
  if (fields.includes('quantity')) return formatQuantity(item.quantity, item.unit)
  return ''
}

// The sum of what is still open on a Geld list. Null when there is nothing to
// add up, so the screen can leave the line out entirely rather than print
// "0,00 €" under an empty list.
export function openAmountTotal(items = []) {
  const open = items.filter((i) => !i.is_done && Number.isFinite(Number(i.amount)))
  if (!open.length) return null
  return open.reduce((sum, i) => sum + Number(i.amount), 0)
}

// "5 Einträge" / "1 Eintrag" — the archive's one line of content per row.
export function itemCountLabel(count) {
  return `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`
}
