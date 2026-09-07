import { requireSupabase } from '../lib/supabase'
import { pickWritableExpense } from './expenseDefaults'

// Expenses live in Supabase and nowhere else. Every statement is scoped twice,
// exactly as taskRepository and listRepository are: RLS in Postgres decides
// what the signed-in user may touch, and the explicit `user_id` filter keeps
// the intent visible in the query. The guard below is the third — a missing
// user id must never reach the network as a wide query.
//
// Deleting is a real delete, like a list entry and unlike a task: an expense is
// small, and the undo toast on the screen re-creates it rather than keeping a
// tombstone and a Papierkorb around for a module that is meant to stay minimal.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

export const expenseRepository = {
  // Newest first, which is the only order any screen asks for — and the order
  // the `expenses_user_date_idx` index is built for.
  async listExpenses(userId) {
    const { data, error } = await requireSupabase()
      .from('expenses')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  async createExpense(userId, data) {
    const payload = {
      ...pickWritableExpense(data),
      user_id: requireUser(userId),
      title: data.title,
    }
    const { data: row, error } = await requireSupabase()
      .from('expenses')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateExpense(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('expenses')
      .update({ ...pickWritableExpense(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteExpense(userId, id) {
    const { error } = await requireSupabase()
      .from('expenses')
      .delete()
      .eq('id', id)
      .eq('user_id', requireUser(userId))
    if (error) throw error
    return id
  },
}
