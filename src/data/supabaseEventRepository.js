import { supabase } from '../lib/supabase'
import { pickWritableEvent } from './eventDefaults'

// Supabase-backed calendar events. RLS scopes every query to the signed-in
// user; the explicit user_id filters are belt-and-suspenders.

export const supabaseEventRepository = {
  async listEvents(userId) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .order('start_at', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createEvent(userId, data) {
    const payload = { ...pickWritableEvent(data), user_id: userId, title: data.title }
    const { data: row, error } = await supabase
      .from('events')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateEvent(userId, id, patch) {
    const { data: row, error } = await supabase
      .from('events')
      .update({ ...pickWritableEvent(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteEvent(userId, id) {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) throw error
  },
}
