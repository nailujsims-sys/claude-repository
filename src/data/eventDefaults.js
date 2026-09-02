// Shared field vocabulary for a calendar event: snake_case columns matching
// the `events` table, so what the UI builds is what the database stores.
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
