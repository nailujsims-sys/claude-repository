// Fills a partial task with the same defaults the database uses, producing a
// complete row. Shared by the local repository and used to keep the in-app
// task shape identical to the Supabase `tasks` table (snake_case columns).
export function buildTaskRow(userId, data = {}) {
  const now = new Date().toISOString()
  return {
    id: data.id ?? crypto.randomUUID(),
    user_id: userId,
    title: data.title ?? '',
    category: data.category ?? 'Privat',
    subcategory: data.subcategory ?? null,
    details: data.details ?? null,
    due_date: data.due_date ?? null,
    due_time: data.due_time ?? null,
    due_type: data.due_type ?? 'day',
    is_favorite: data.is_favorite ?? false,
    is_completed: data.is_completed ?? false,
    is_deleted: data.is_deleted ?? false,
    completed_at: data.completed_at ?? null,
    deleted_at: data.deleted_at ?? null,
    sort_order: data.sort_order ?? 0,
    created_at: data.created_at ?? now,
    updated_at: data.updated_at ?? now,
  }
}

// Whitelist of columns a client may write, so updates never try to set
// server-managed fields incorrectly.
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
