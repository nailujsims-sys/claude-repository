import { requireSupabase } from '../lib/supabase'
import { pickWritableList, pickWritableListItem } from './listDefaults'

// Lists and their entries live in Supabase and nowhere else. Every statement is
// scoped twice, exactly as taskRepository is: RLS in Postgres decides what the
// signed-in user may touch, and the explicit `user_id` filter keeps the intent
// visible in the query. The guard below is the third — a missing user id must
// never reach the network as a wide query.
//
// Deleting is a real delete here, not the tasks' `is_deleted`. A list has an
// archive instead, which is the reversible half; "Löschen" is the irreversible
// one and says so (ConfirmDialog). An entry is small enough that the undo toast
// re-creates it rather than keeping a tombstone around.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

export const listRepository = {
  async listLists(userId) {
    const { data, error } = await requireSupabase()
      .from('lists')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  // Every entry of every list of this user, in one request. The module holds a
  // few hundred rows at most and each screen filters by `list_id`, so one query
  // and one Realtime channel beat a fetch per opened list — and a list opened
  // from the overview is already populated when it renders.
  async listItems(userId) {
    const { data, error } = await requireSupabase()
      .from('list_items')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createList(userId, data) {
    const payload = {
      ...pickWritableList(data),
      user_id: requireUser(userId),
      name: data.name,
    }
    const { data: row, error } = await requireSupabase()
      .from('lists')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateList(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('lists')
      .update({ ...pickWritableList(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  // The entries go with it: `list_items.list_id` is `on delete cascade`, so
  // Postgres removes them in the same transaction and there is no window in
  // which a user's rows belong to a list that is gone.
  async deleteList(userId, id) {
    const { error } = await requireSupabase()
      .from('lists')
      .delete()
      .eq('id', id)
      .eq('user_id', requireUser(userId))
    if (error) throw error
    return id
  },

  async createItem(userId, data) {
    const payload = {
      ...pickWritableListItem(data),
      user_id: requireUser(userId),
      list_id: data.list_id,
      title: data.title,
    }
    const { data: row, error } = await requireSupabase()
      .from('list_items')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateItem(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('list_items')
      .update({ ...pickWritableListItem(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteItem(userId, id) {
    const { error } = await requireSupabase()
      .from('list_items')
      .delete()
      .eq('id', id)
      .eq('user_id', requireUser(userId))
    if (error) throw error
    return id
  },

  // Apply each row's new sort_order. Run in parallel; RLS scopes every
  // statement to the current user. Same shape as taskRepository.reorderTasks.
  async reorderItems(userId, updates) {
    const uid = requireUser(userId)
    const results = await Promise.all(
      updates.map(({ id, ...patch }) =>
        requireSupabase()
          .from('list_items')
          .update({ ...pickWritableListItem(patch), updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', uid)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed) throw failed.error
    return updates
  },
}
