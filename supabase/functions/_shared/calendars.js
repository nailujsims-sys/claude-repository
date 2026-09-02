// What kind of Google calendar this is, and what the app may do with it.
//
// The rule that matters: **writability comes from Google's `accessRole`, never
// from the calendar's name.** A calendar called "Feiertage in Deutschland" is
// read-only because Google says `reader`, and a calendar somebody named
// "Feiertage" that they actually own stays writable. Anything else would be
// guessing at a permission the server is going to enforce anyway.

// Google's own well-known calendar ids. These are stable identifiers, not
// display names, so recognising them is not name-guessing: the birthday
// calendar is *generated from Google Contacts* and the holiday calendars are
// subscriptions, and both need different handling from a normal calendar.
const BIRTHDAY_ID = '#contacts@group.v.calendar.google.com'
const HOLIDAY_ID = '#holiday@group.v.calendar.google.com'

export function calendarKind(entry) {
  const id = String(entry?.id ?? '')
  if (id.endsWith(BIRTHDAY_ID) || id === 'addressbook#contacts@group.v.calendar.google.com') {
    return 'birthday'
  }
  if (id.endsWith(HOLIDAY_ID)) return 'holiday'
  return 'normal'
}

// owner / writer may be written to; reader / freeBusyReader may not.
export function isWritableRole(accessRole) {
  return accessRole === 'owner' || accessRole === 'writer'
}

// Whether the app may create or change events *in Google* for this calendar.
//
// A birthday calendar is the interesting case: Google always reports it as
// `reader`, because its events are not calendar events — they are derived from
// contacts. It is still editable, through the People API, so it gets its own
// answer rather than being lumped in with the holidays.
export function calendarWritability(calendar) {
  if (!calendar) return 'none'
  if (calendar.kind === 'birthday') return 'contacts'
  return isWritableRole(calendar.access_role) ? 'events' : 'none'
}

export const isReadOnly = (calendar) => calendarWritability(calendar) === 'none'

// May a *new* event be created in this calendar from the app? Holidays cannot
// (Google would reject it), and a birthday would have to become a contact,
// which is not what "Neuer Termin" means — so the picker offers neither.
export function canCreateEventsIn(calendar) {
  return calendarWritability(calendar) === 'events'
}

// Google hands out both a `backgroundColor` (the calendar's own colour) and,
// for events, a `colorId` into a palette. We keep the calendar colour, because
// that is what makes a calendar recognisable in the app. Anything that is not
// a plain hex triple is dropped rather than passed into a style attribute.
const HEX = /^#[0-9a-fA-F]{6}$/
export function safeHexColor(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return HEX.test(trimmed) ? trimmed.toLowerCase() : null
}

// A CalendarList entry as we store it.
export function calendarListEntryToRow(entry, userId) {
  const kind = calendarKind(entry)
  const defaults = Array.isArray(entry?.defaultReminders) ? entry.defaultReminders : []
  const minutes = defaults
    .map((r) => (Number.isFinite(r?.minutes) ? r.minutes : null))
    .filter((m) => m !== null)
  return {
    user_id: userId,
    google_calendar_id: entry.id,
    summary: entry.summaryOverride || entry.summary || entry.id,
    description: entry.description ?? null,
    time_zone: entry.timeZone ?? null,
    background_color: safeHexColor(entry.backgroundColor),
    foreground_color: safeHexColor(entry.foregroundColor),
    access_role: entry.accessRole ?? null,
    is_primary: !!entry.primary,
    kind,
    default_reminder_minutes: minutes.length ? Math.min(...minutes) : null,
    is_available: true,
  }
}

// Which calendars a fresh connection should sync without being asked. The
// primary calendar is the one every Google account has and the one the user
// means by "mein Kalender"; everything else stays off until they say so.
export function defaultSelection(entries) {
  return entries.filter((entry) => entry.is_primary).map((entry) => entry.google_calendar_id)
}
