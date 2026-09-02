import { requireSupabase } from '../lib/supabase'
import { pickWritable } from './taskDefaults'

// Tasks live in Supabase and nowhere else. Every statement is scoped twice: RLS
// in Postgres decides what the signed-in user may touch, and the explicit
// `user_id` filter keeps the intent visible in the query. The guard below is
// the third: a missing user id must never reach the network as a wide query.
//
// Deleting is a soft delete (`is_deleted`), so it stays undoable — that is the
// Papierkorb, not a row that is gone.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

export const taskRepository = {
  async listTasks(userId) {
    const { data, error } = await requireSupabase()
      .from('tasks')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createTask(userId, data) {
    const payload = { ...pickWritable(data), user_id: requireUser(userId), title: data.title }
    const { data: row, error } = await requireSupabase()
      .from('tasks')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateTask(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('tasks')
      .update({ ...pickWritable(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async reorderTasks(userId, updates) {
    // Apply each row's new sort_order / due fields. Run in parallel; RLS scopes
    // every statement to the current user.
    const uid = requireUser(userId)
    const results = await Promise.all(
      updates.map(({ id, ...patch }) =>
        requireSupabase()
          .from('tasks')
          .update({ ...pickWritable(patch), updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', uid)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed) throw failed.error
    return updates
  },
}
