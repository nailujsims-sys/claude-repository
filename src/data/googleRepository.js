import { requireSupabase } from '../lib/supabase'

// The Google integration's data access. Two halves, and the split is the whole
// security design:
//
//   • reads go straight to Postgres, where RLS scopes them to the signed-in
//     user. The two tables the client may read (`google_connections`,
//     `google_calendars`) hold no tokens — the tokens live in
//     `google_credentials`, which grants the browser's role nothing at all.
//   • writes go to an Edge Function, which holds the Google credentials
//     server-side and acts on the user identified by the verified JWT it was
//     called with. The browser never sees a Google token, and never sends a
//     user id — only its own session.

const FUNCTION = 'google-api'

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

// One place for every function call, so the auth header, the error shape and
// the "not configured yet" case are handled identically everywhere.
async function callFunction(action, payload = {}) {
  const { data, error } = await requireSupabase().functions.invoke(FUNCTION, {
    body: { action, ...payload },
  })
  if (error) {
    // The function answers a real error with a JSON body; supabase-js hides it
    // behind a generic FunctionsHttpError, so it is dug out here rather than
    // in five call sites.
    let message = error.message || 'Google-Dienst nicht erreichbar.'
    let details = null
    try {
      details = await error.context?.json?.()
      if (details?.error) message = details.error
    } catch {
      // Keep the generic message.
    }
    const wrapped = new Error(message)
    wrapped.details = details
    wrapped.status = error.context?.status ?? 0
    throw wrapped
  }
  return data
}

export const googleRepository = {
  // The connection row, or null. Never contains a token: the table has none.
  async getConnection(userId) {
    const { data, error } = await requireSupabase()
      .from('google_connections')
      .select('*')
      .eq('user_id', requireUser(userId))
      .maybeSingle()
    if (error) throw error
    return data ?? null
  },

  async listCalendars(userId) {
    const { data, error } = await requireSupabase()
      .from('google_calendars')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('is_primary', { ascending: false })
      .order('summary', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  // Returns the Google consent URL. The browser is sent there; it comes back
  // to the Edge Function, not to the app, so no code or token ever passes
  // through a page we render.
  async startConnect(redirect) {
    const data = await callFunction('connect', { redirect })
    return data?.url ?? null
  },

  disconnect: () => callFunction('disconnect'),
  sync: () => callFunction('sync'),
  refreshCalendars: () => callFunction('refresh-calendars'),
  setCalendarSelected: (calendarId, selected) =>
    callFunction('select-calendar', { calendar_id: calendarId, selected }),
  setDefaultCalendar: (calendarId) =>
    callFunction('set-default-calendar', { calendar_id: calendarId }),
}
