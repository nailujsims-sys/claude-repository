// The columns a client may write, one whitelist per table. Everything else on a
// row is the database's business: `id`, `user_id`, `created_at` are set once on
// insert, and the `updated_at` trigger keeps that column honest.
//
// Same shape as src/data/taskDefaults.js, and for the same reason: a caller
// that hands the repository a whole row — an edited copy, a restored snapshot —
// must not be able to smuggle a server-managed column in with it.
export const WRITABLE_LIST_FIELDS = [
  'name',
  'template',
  'icon',
  'is_pinned',
  'is_archived',
  'archived_at',
  'sort_order',
  'updated_at',
]

// `list_id` is writable on insert (an entry has to say which list it belongs
// to) and harmless afterwards: RLS re-checks on every update that the target
// list is the caller's own, so moving an entry into somebody else's list is
// rejected by Postgres, not merely by this list.
export const WRITABLE_LIST_ITEM_FIELDS = [
  'list_id',
  'title',
  'is_done',
  'done_at',
  'sort_order',
  'quantity',
  'unit',
  'amount',
  'category',
  'updated_at',
]

function pick(fields, patch) {
  const out = {}
  for (const key of fields) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}

export const pickWritableList = (patch) => pick(WRITABLE_LIST_FIELDS, patch)
export const pickWritableListItem = (patch) => pick(WRITABLE_LIST_ITEM_FIELDS, patch)
