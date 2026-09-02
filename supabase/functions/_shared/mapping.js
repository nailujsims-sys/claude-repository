// Google event ⇄ `events` row. The whole reason there is no second event model.
//
// A Google event becomes a row in `public.events` with the same columns every
// app event uses — title, start_at, end_at, all_day, recurrence, reminder,
// location, description — plus the external identity that says where it came
// from. Nothing is invented: a field Google does not send stays null.

import { wallClockInZone, isoDateAddDays, dateOf } from './time.js'

// Everything the app is allowed to consider "the event itself". Both
// directions of the sync compare exactly this list, so a change to it can
// never mean one half of the sync and not the other.
export const SYNCED_FIELDS = [
  'title',
  'description',
  'location',
  'start_at',
  'end_at',
  'all_day',
  'recurrence',
  'reminder',
  'is_birthday',
]

// Google puts the RRULE in an array next to EXDATE/RDATE lines. The app stores
// one rule body ('FREQ=WEEKLY'), which is what its picker and its labels read.
export function recurrenceFromGoogle(recurrence) {
  if (!Array.isArray(recurrence)) return null
  const rule = recurrence.find((line) => typeof line === 'string' && line.startsWith('RRULE:'))
  if (!rule) return null
  const body = rule.slice('RRULE:'.length).trim()
  return body || null
}

// An empty array is meaningful on the way back: it is how Google is told that
// a series became a single event.
export function recurrenceToGoogle(rule) {
  if (!rule) return []
  const body = String(rule).trim()
  if (!body) return []
  return [body.startsWith('RRULE:') ? body : `RRULE:${body}`]
}

// The app's reminder is one number of minutes, or null for "Keine".
// Google's is a list, possibly deferred to the calendar's default — so the
// calendar's default is what `useDefault` resolves to.
export function reminderFromGoogle(reminders, calendarDefaultMinutes = null) {
  if (!reminders) return null
  if (reminders.useDefault) {
    return Number.isFinite(calendarDefaultMinutes) ? calendarDefaultMinutes : null
  }
  const overrides = Array.isArray(reminders.overrides) ? reminders.overrides : []
  const minutes = overrides
    .map((o) => (Number.isFinite(o?.minutes) ? o.minutes : null))
    .filter((m) => m !== null)
  return minutes.length ? Math.min(...minutes) : null
}

// "Keine" has to travel as an explicit empty list. `useDefault: true` would
// hand the event back to the calendar's default reminder, which is the
// opposite of what the user just switched off.
export function reminderToGoogle(minutes) {
  if (minutes == null) return { useDefault: false, overrides: [] }
  return { useDefault: false, overrides: [{ method: 'popup', minutes }] }
}

// ── Google → row ────────────────────────────────────────────────────────────
// `userTimeZone` is the app's single timeline: an instant is written as the
// wall-clock time it reads at on the user's own clock. A meeting created in
// New York therefore shows in the app at the hour the user will actually
// attend it, which is the only reading of "the same event" that is useful.
//
// All-day events are the trap. Google's `end.date` is *exclusive* — a
// one-day event ends "tomorrow" — while the app stores an inclusive end. The
// conversion is one day in each direction and it is tested in both.
export function googleEventToRow(event, options = {}) {
  const {
    userId,
    calendar = {},
    userTimeZone = 'Europe/Berlin',
    calendarDefaultMinutes = calendar.default_reminder_minutes ?? null,
  } = options

  const allDay = !!event?.start?.date
  let start_at = null
  let end_at = null

  if (allDay) {
    const startDate = event.start.date
    // A missing end means a single day; Google's exclusive end becomes ours.
    const endExclusive = event.end?.date || isoDateAddDays(startDate, 1)
    let endInclusive = isoDateAddDays(endExclusive, -1)
    if (!endInclusive || endInclusive < startDate) endInclusive = startDate
    start_at = `${startDate}T00:00`
    end_at = `${endInclusive}T00:00`
  } else if (event?.start?.dateTime) {
    start_at = wallClockInZone(new Date(event.start.dateTime), userTimeZone)
    const rawEnd = event.end?.dateTime
    end_at = rawEnd ? wallClockInZone(new Date(rawEnd), userTimeZone) : start_at
    if (end_at && start_at && end_at < start_at) end_at = start_at
  }

  const isBirthday = event?.eventType === 'birthday' || calendar.kind === 'birthday'

  return {
    user_id: userId,
    title: (event?.summary ?? '').trim() || 'Ohne Titel',
    description: event?.description ?? null,
    location: event?.location ?? null,
    start_at,
    end_at,
    all_day: allDay,
    recurrence: recurrenceFromGoogle(event?.recurrence),
    reminder: reminderFromGoogle(event?.reminders, calendarDefaultMinutes),
    is_birthday: isBirthday,
    timezone: userTimeZone,
    google_calendar_id: calendar.google_calendar_id ?? null,
    google_event_id: event?.id ?? null,
    google_recurring_event_id: event?.recurringEventId ?? null,
    google_contact_id: event?.birthdayProperties?.contact ?? null,
    google_etag: event?.etag ?? null,
    google_updated_at: event?.updated ?? null,
    sync_enabled: true,
    sync_state: 'synced',
    sync_error: null,
  }
}

// ── row → Google ────────────────────────────────────────────────────────────
// The wall-clock time goes over as text with the zone next to it. Google
// resolves the offset per occurrence, which is what keeps a weekly 09:00 at
// 09:00 through the March and October changes.
export function rowToGoogleEvent(row) {
  const timeZone = row.timezone || 'Europe/Berlin'
  const body = {
    summary: row.title,
    description: row.description ?? null,
    location: row.location ?? null,
    recurrence: recurrenceToGoogle(row.recurrence),
    reminders: reminderToGoogle(row.reminder ?? null),
  }

  if (row.all_day) {
    const startDate = dateOf(row.start_at)
    const endDate = dateOf(row.end_at) || startDate
    body.start = { date: startDate }
    // Back to Google's exclusive end: our inclusive last day plus one.
    body.end = { date: isoDateAddDays(endDate, 1) }
  } else {
    body.start = { dateTime: `${row.start_at}:00`, timeZone }
    body.end = { dateTime: `${row.end_at || row.start_at}:00`, timeZone }
  }

  return body
}

// Does the version we hold differ from Google's in anything the user can see?
// Used to skip a write that would only bump `updated` on both sides — the
// cheapest way to keep a sync loop from feeding itself.
export function differsInSyncedFields(rowA, rowB) {
  return SYNCED_FIELDS.some((field) => {
    const a = rowA?.[field] ?? null
    const b = rowB?.[field] ?? null
    return a !== b
  })
}

// The identity of a Google event, and the only thing a duplicate check may
// look at. Title and time are not identity: two lectures can share both.
export function externalKey(row) {
  if (!row?.google_event_id || !row?.google_calendar_id) return null
  return `google:${row.google_calendar_id}:${row.google_event_id}`
}
