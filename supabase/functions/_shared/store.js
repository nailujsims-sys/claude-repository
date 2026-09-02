// The database side of the sync, behind one small interface.
//
// Everything the engine needs from Postgres is one of these methods, which is
// what makes tools/googleSyncLogic.mjs possible: the tests hand the engine an
// in-memory object with the same shape and exercise the real sync code.
//
// Every method takes a user id and filters on it. RLS is bypassed here — the
// service role has to be able to act for whichever user a run belongs to — so
// this explicit filter is what keeps one account's sync inside that account.
// It is not decoration: without it, `service_role` plus a wrong id is exactly
// how one user would see another's calendar.

export function createStore(supabase) {
  const rows = (result) => {
    if (result.error) throw new Error(result.error.message)
    return result.data ?? []
  }
  const one = (result) => {
    if (result.error) throw new Error(result.error.message)
    return result.data ?? null
  }

  return {
    // ── connection ──────────────────────────────────────────────────────
    async getConnection(userId) {
      return one(
        await supabase.from('google_connections').select('*').eq('user_id', userId).maybeSingle()
      )
    },

    async upsertConnection(userId, patch) {
      return one(
        await supabase
          .from('google_connections')
          .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
          .select()
          .single()
      )
    },

    async updateConnection(userId, patch) {
      return one(
        await supabase
          .from('google_connections')
          .update(patch)
          .eq('user_id', userId)
          .select()
          .maybeSingle()
      )
    },

    async deleteConnection(userId) {
      const result = await supabase.from('google_connections').delete().eq('user_id', userId)
      if (result.error) throw new Error(result.error.message)
    },

    // ── credentials ─────────────────────────────────────────────────────
    async getCredentials(userId) {
      return one(
        await supabase.from('google_credentials').select('*').eq('user_id', userId).maybeSingle()
      )
    },

    async saveCredentials(userId, patch) {
      return one(
        await supabase
          .from('google_credentials')
          .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
          .select()
          .single()
      )
    },

    async deleteCredentials(userId) {
      const result = await supabase.from('google_credentials').delete().eq('user_id', userId)
      if (result.error) throw new Error(result.error.message)
    },

    // ── calendars ───────────────────────────────────────────────────────
    async listCalendars(userId) {
      return rows(
        await supabase
          .from('google_calendars')
          .select('*')
          .eq('user_id', userId)
          .order('is_primary', { ascending: false })
          .order('summary', { ascending: true })
      )
    },

    async upsertCalendars(calendars) {
      if (!calendars.length) return []
      return rows(
        await supabase
          .from('google_calendars')
          .upsert(calendars, { onConflict: 'user_id,google_calendar_id' })
          .select()
      )
    },

    async setCalendarSelected(userId, googleCalendarId, isSelected) {
      return one(
        await supabase
          .from('google_calendars')
          .update({
            is_selected: isSelected,
            // Switching a calendar back on re-reads it in full: whatever
            // happened while it was off never reached us, and an old cursor
            // would quietly skip exactly that.
            ...(isSelected ? { sync_token: null } : {}),
            last_error: null,
          })
          .eq('user_id', userId)
          .eq('google_calendar_id', googleCalendarId)
          .select()
          .maybeSingle()
      )
    },

    async setCalendarSyncToken(userId, googleCalendarId, token) {
      const result = await supabase
        .from('google_calendars')
        .update({ sync_token: token })
        .eq('user_id', userId)
        .eq('google_calendar_id', googleCalendarId)
      if (result.error) throw new Error(result.error.message)
    },

    async updateCalendarAfterSync(userId, googleCalendarId, patch) {
      const result = await supabase
        .from('google_calendars')
        .update(patch)
        .eq('user_id', userId)
        .eq('google_calendar_id', googleCalendarId)
      if (result.error) throw new Error(result.error.message)
    },

    async markCalendarsUnavailable(userId, ids) {
      if (!ids.length) return
      const result = await supabase
        .from('google_calendars')
        .update({ is_available: false, is_selected: false })
        .eq('user_id', userId)
        .in('google_calendar_id', ids)
      if (result.error) throw new Error(result.error.message)
    },

    async deleteCalendars(userId) {
      const result = await supabase.from('google_calendars').delete().eq('user_id', userId)
      if (result.error) throw new Error(result.error.message)
    },

    // ── events ──────────────────────────────────────────────────────────
    async findEventByGoogleId(userId, googleCalendarId, googleEventId) {
      return one(
        await supabase
          .from('events')
          .select('*')
          .eq('user_id', userId)
          .eq('google_calendar_id', googleCalendarId)
          .eq('google_event_id', googleEventId)
          .maybeSingle()
      )
    },

    async insertEvent(row) {
      return one(await supabase.from('events').insert(row).select().single())
    },

    async updateEvent(id, patch) {
      return one(await supabase.from('events').update(patch).eq('id', id).select().maybeSingle())
    },

    async deleteEventById(id) {
      const result = await supabase.from('events').delete().eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },

    async listPendingEvents(userId) {
      return rows(
        await supabase
          .from('events')
          .select('*')
          .eq('user_id', userId)
          .eq('sync_state', 'pending')
          .eq('sync_enabled', true)
          .not('google_calendar_id', 'is', null)
          .order('updated_at', { ascending: true })
          .limit(500)
      )
    },

    // Disconnecting keeps every event and only cuts the thread to Google:
    // "Keine überraschende Datenlöschung." The rows become app-only, exactly
    // like an event created with the sync switch off.
    async detachEvents(userId) {
      const result = await supabase
        .from('events')
        .update({
          google_calendar_id: null,
          google_event_id: null,
          google_recurring_event_id: null,
          google_contact_id: null,
          google_etag: null,
          google_updated_at: null,
          sync_enabled: false,
          sync_state: 'local',
          sync_error: null,
        })
        .eq('user_id', userId)
        .not('google_event_id', 'is', null)
      if (result.error) throw new Error(result.error.message)
    },

    // ── tombstones ──────────────────────────────────────────────────────
    async listTombstones(userId) {
      return rows(
        await supabase
          .from('google_event_tombstones')
          .select('*')
          .eq('user_id', userId)
          .lt('attempts', 5)
          .order('created_at', { ascending: true })
          .limit(200)
      )
    },

    async deleteTombstone(id) {
      const result = await supabase.from('google_event_tombstones').delete().eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },

    async touchTombstone(id, message) {
      const current = one(
        await supabase.from('google_event_tombstones').select('attempts').eq('id', id).maybeSingle()
      )
      const result = await supabase
        .from('google_event_tombstones')
        .update({ attempts: (current?.attempts ?? 0) + 1, last_error: String(message).slice(0, 400) })
        .eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },

    async clearTombstones(userId) {
      const result = await supabase.from('google_event_tombstones').delete().eq('user_id', userId)
      if (result.error) throw new Error(result.error.message)
    },

    // ── push channels ───────────────────────────────────────────────────
    async listChannels(userId) {
      return rows(await supabase.from('google_channels').select('*').eq('user_id', userId))
    },

    async insertChannel(channel) {
      return one(await supabase.from('google_channels').insert(channel).select().single())
    },

    async findChannel(id) {
      return one(await supabase.from('google_channels').select('*').eq('id', id).maybeSingle())
    },

    async deleteChannel(id) {
      const result = await supabase.from('google_channels').delete().eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },

    // ── profile ─────────────────────────────────────────────────────────
    async getTimeZone(userId) {
      const profile = one(
        await supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle()
      )
      return profile?.timezone || 'Europe/Berlin'
    },
  }
}
