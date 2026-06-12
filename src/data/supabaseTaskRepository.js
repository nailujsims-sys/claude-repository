import { supabase } from '../lib/supabase'
import { pickWritable } from './taskDefaults'

// Supabase-backed implementation. RLS ensures each query only ever touches the
// signed-in user's rows; the explicit user_id filters are belt-and-suspenders.

export const supabaseTaskRepository = {
  async listTasks(userId) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createTask(userId, data) {
    const payload = { ...pickWritable(data), user_id: userId, title: data.title }
    const { data: row, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateTask(userId, id, patch) {
    const { data: row, error } = await supabase
      .from('tasks')
      .update({ ...pickWritable(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async reorderTasks(userId, updates) {
    // Apply each row's new sort_order / due fields. Run in parallel; RLS scopes
    // every statement to the current user.
    const results = await Promise.all(
      updates.map(({ id, ...patch }) =>
        supabase
          .from('tasks')
          .update({ ...pickWritable(patch), updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', userId)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed) throw failed.error
    return updates
  },
}
