// The columns a client may write. Everything else on a task row is the
// database's business: `id`, `user_id`, `created_at` are set once on insert,
// and the `updated_at` trigger keeps that column honest.
export const WRITABLE_FIELDS = [
  'title',
  'category',
  'subcategory',
  'details',
  'due_date',
  'due_time',
  'due_type',
  'is_favorite',
  'is_completed',
  'is_deleted',
  'completed_at',
  'deleted_at',
  'sort_order',
  'updated_at',
]

export function pickWritable(patch) {
  const out = {}
  for (const key of WRITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}
