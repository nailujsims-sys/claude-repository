// The client's view of the Google integration: which calendar an event belongs
// to, what colour it wears, and what the sync is currently doing.
//
// The rules about *rights* are not re-implemented here. `calendarWritability`
// and its friends come from the same module the Edge Functions import
// (supabase/functions/_shared/calendars.js), because a picker that offers a
// calendar the server will refuse is worse than no picker at all — and two
// copies of "is this read-only" would drift apart on the first change.

import {
  calendarWritability,
  canCreateEventsIn,
  isReadOnly,
  safeHexColor,
} from '../../supabase/functions/_shared/calendars.js'

export { calendarWritability, canCreateEventsIn, isReadOnly, safeHexColor }

// Und aus demselben Grund kommt der Takt des automatischen Syncs von dort, wo
// der Server ihn anwendet — nicht als zweite Zahl in der App.
export {
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_MIN_GAP_MS,
  shouldClientAutoSync,
} from '../../supabase/functions/_shared/autoSyncPolicy.js'

// The app's own accent, for an event that belongs to no Google calendar. It is
// the colour the calendar has always drawn events in, so nothing about an
// app-only event changes just because the integration exists.
export const APP_EVENT_COLOR = '#4A80FF'

export const calendarById = (calendars, id) =>
  (id && calendars.find((c) => c.google_calendar_id === id)) || null

// The colour an event is drawn in: its calendar's, or the app accent.
export function eventColor(event, calendars) {
  const calendar = calendarById(calendars, event?.google_calendar_id)
  return safeHexColor(calendar?.background_color) || APP_EVENT_COLOR
}

// Only the calendars a new event may actually be created in. Holidays are read
// only in Google, and a birthday would have to become a contact — neither is
// something "Neuer Termin" can produce, so neither is offered.
export function selectableCalendars(calendars) {
  return calendars.filter((c) => c.is_selected && c.is_available && canCreateEventsIn(c))
}

// Which calendar a new event starts in: the configured default when it is
// still usable, otherwise the primary one, otherwise the first that works.
export function defaultCalendarFor(calendars, connection) {
  const usable = selectableCalendars(calendars)
  if (!usable.length) return null
  const configured = usable.find(
    (c) => c.google_calendar_id === connection?.default_calendar_id
  )
  if (configured) return configured
  return usable.find((c) => c.is_primary) || usable[0]
}

// ── The connection row and Realtime ─────────────────────────────────────────
// `google_connections` is keyed by `user_id`, not by `id`. The shared reducer
// in lib/realtimeSync.js keys every row by `id`, which is right for every
// other table in the app and wrong for exactly this one: a DELETE carries only
// the primary key, so `payload.old.id` is undefined and the disconnect never
// arrives — the other device would keep showing "Verbunden" until it reloaded.
//
// Same three rules as the shared reducer, applied to the column this table
// actually has: a foreign row is ignored, an unchanged row returns the object
// we already hold (so no re-render), and a delete only lands if it is ours.
export function applyConnectionChange(current, payload, userId) {
  const type = payload?.eventType

  if (type === 'DELETE') {
    const ownerId = payload.old?.user_id
    // A delete under RLS carries the primary key and nothing else, and it goes
    // to every subscriber of the table. Without this check another account's
    // disconnect would clear ours.
    if (!ownerId || !current) return current
    return ownerId === current.user_id ? null : current
  }

  if (type !== 'INSERT' && type !== 'UPDATE') return current

  const row = payload.new
  if (!row?.user_id) return current
  if (userId && row.user_id !== userId) return current
  if (current && Object.keys(row).every((key) => current[key] === row[key])) return current
  return row
}

// ── Words for states ────────────────────────────────────────────────────────

export function connectionStatusLabel(connection) {
  if (!connection) return 'Nicht verbunden'
  if (connection.status === 'needs_reauth') return 'Verbindung abgelaufen'
  if (connection.status === 'error') return 'Letzte Synchronisierung fehlerhaft'
  return 'Verbunden'
}

export function connectionTone(connection) {
  if (!connection) return 'muted'
  if (connection.status === 'needs_reauth') return 'danger'
  if (connection.status === 'error') return 'warn'
  return 'ok'
}

const MINUTE = 60000

// "gerade eben" / "vor 5 Minuten" / "vor 2 Stunden" / a date. Relative for as
// long as relative is the useful answer, absolute once it is not.
export function lastSyncLabel(iso, now = Date.now()) {
  if (!iso) return 'Noch nicht synchronisiert'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'Noch nicht synchronisiert'
  const minutes = Math.round((now - at) / MINUTE)
  if (minutes < 1) return 'Gerade eben synchronisiert'
  if (minutes < 60) return `Vor ${minutes} Min. synchronisiert`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Vor ${hours} Std. synchronisiert`
  const date = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return `Zuletzt am ${p(date.getDate())}.${p(date.getMonth() + 1)}. um ${p(date.getHours())}:${p(date.getMinutes())}`
}

// What the calendar list says under each row.
export function calendarRoleLabel(calendar) {
  const writability = calendarWritability(calendar)
  if (!calendar?.is_available) return 'In Google nicht mehr vorhanden'
  if (calendar.kind === 'birthday') return 'Geburtstage · über Google Kontakte'
  if (writability === 'events') return 'Lesen und schreiben'
  return 'Nur lesen'
}

// The one line an event's detail view shows about its sync state.
export function eventSyncLabel(event) {
  if (!event?.google_calendar_id) return 'Nur in dieser App'
  if (event.sync_state === 'error') return event.sync_error || 'Synchronisierung fehlgeschlagen'
  if (event.sync_state === 'pending') return 'Wird mit Google synchronisiert …'
  return 'Mit Google synchronisiert'
}
