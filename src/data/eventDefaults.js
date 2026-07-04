// Shared shape for a calendar event, kept identical between the local and
// Supabase repositories (snake_case columns matching the `events` table).
//
// The model is intentionally forward-looking: recurrence, reminder, birthday
// and timezone are stored now even though some are not yet surfaced in the UI,
// so the schema is stable as the calendar grows.

// Best-effort IANA timezone of the device; events carry it for the future even
// though the app currently renders in local wall-clock time.
export function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  } catch {
    return 'Europe/Berlin'
  }
}

export function buildEventRow(userId, data = {}) {
  const now = new Date().toISOString()
  return {
    id: data.id ?? crypto.randomUUID(),
    user_id: userId,
    title: data.title ?? '',
    description: data.description ?? null,
    location: data.location ?? null,
    // Local 'YYYY-MM-DDTHH:MM' wall-clock strings (see lib/calendar.js).
    start_at: data.start_at ?? null,
    end_at: data.end_at ?? null,
    all_day: data.all_day ?? false,
    recurrence: data.recurrence ?? null, // RRULE-style string | null
    reminder: data.reminder ?? null, // minutes before start (int) | null
    is_birthday: data.is_birthday ?? false,
    timezone: data.timezone ?? defaultTimeZone(),
    created_at: data.created_at ?? now,
    updated_at: data.updated_at ?? now,
  }
}

// Columns a client may write.
export const EVENT_WRITABLE_FIELDS = [
  'title',
  'description',
  'location',
  'start_at',
  'end_at',
  'all_day',
  'recurrence',
  'reminder',
  'is_birthday',
  'timezone',
  'updated_at',
]

export function pickWritableEvent(patch) {
  const out = {}
  for (const key of EVENT_WRITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}
