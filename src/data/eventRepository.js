import { requireSupabase } from '../lib/supabase'
import { pickWritableEvent, defaultTimeZone } from './eventDefaults'

// Calendar events, same rules as tasks: Supabase only, RLS plus an explicit
// user filter plus a guard against an unauthenticated call. Events are deleted
// for real — the calendar has no trash.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

export const eventRepository = {
  async listEvents(userId) {
    const { data, error } = await requireSupabase()
      .from('events')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('start_at', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createEvent(userId, data) {
    const payload = {
      // The device's zone travels with the row, so a later sync knows what
      // wall-clock time the user actually meant.
      timezone: defaultTimeZone(),
      ...pickWritableEvent(data),
      user_id: requireUser(userId),
      title: data.title,
    }
    const { data: row, error } = await requireSupabase()
      .from('events')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateEvent(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('events')
      .update({ ...pickWritableEvent(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteEvent(userId, id) {
    const { error } = await requireSupabase()
      .from('events')
      .delete()
      .eq('id', id)
      .eq('user_id', requireUser(userId))
    if (error) throw error
  },
}
