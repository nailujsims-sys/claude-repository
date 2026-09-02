// Wall-clock time, the one place the sync is allowed to do arithmetic on it.
//
// The app stores a local wall-clock string ('YYYY-MM-DDTHH:MM') plus the zone
// it was entered in; Google stores an instant with an offset, or a bare date
// for an all-day event. Converting between the two is where "14:00 became
// 13:00" comes from, so both directions are here, in pure functions, and both
// are covered by tools/googleLogic.mjs.
//
// Two rules make it safe:
//
//   1. Going *to* Google we never compute an offset ourselves. We send the
//      wall-clock time and the IANA zone and let Google resolve it — which is
//      the only way a recurring 09:00 stays 09:00 across a DST change, because
//      the offset differs per occurrence and a rule has no single offset.
//   2. Coming *from* Google we turn the instant into wall-clock through
//      `Intl` in the user's zone. That is a real timezone database lookup, not
//      a fixed subtraction, so it is right on both sides of a DST boundary.

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DDTHH:MM' for `instant` as it reads on a clock in `timeZone`.
// hourCycle 'h23' rather than hour12:false: the latter renders midnight as
// "24" in some ICU builds, which would silently move an event a day.
export function wallClockInZone(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  const parts = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)) {
    parts[part.type] = part.value
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// The offset `timeZone` had at `instant`, in minutes east of UTC. Only used to
// render an RFC3339 timestamp for Google's time-window parameters.
export function zoneOffsetMinutes(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant)
  const wall = wallClockInZone(date, timeZone)
  if (!wall) return 0
  const asUtc = Date.parse(`${wall}:00Z`)
  return Math.round((asUtc - date.getTime()) / 60000)
}

// The instant at which `wall` ('YYYY-MM-DDTHH:MM') strikes in `timeZone`.
// Two passes: guess with the offset that applies near the target, then correct
// once — enough for every real zone, including the hour a DST change skips.
export function instantFromWallClock(wall, timeZone) {
  if (!wall) return null
  const naive = Date.parse(`${wall}:00Z`)
  if (Number.isNaN(naive)) return null
  let guess = naive - zoneOffsetMinutes(naive, timeZone) * 60000
  guess = naive - zoneOffsetMinutes(guess, timeZone) * 60000
  return new Date(guess)
}

// RFC3339 with a real offset — what Google's timeMin/timeMax want.
export function rfc3339InZone(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant)
  const wall = wallClockInZone(date, timeZone)
  const offset = zoneOffsetMinutes(date, timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `${wall}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// ── Plain date arithmetic on 'YYYY-MM-DD' ──────────────────────────────────
// Deliberately UTC-based: a bare date has no time and no zone, so noon-in-UTC
// stepping can never land on the wrong day the way local parsing can.
export function isoDateAddDays(iso, days) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const at = Date.UTC(y, (m || 1) - 1, d || 1, 12)
  const moved = new Date(at + days * 86400000)
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

export const dateOf = (wall) => (wall ? String(wall).split('T')[0] : null)

// Today in `timeZone`, so "two years back" is counted from the user's day and
// not from whatever day it happens to be in UTC.
export function todayInZone(now, timeZone) {
  return dateOf(wallClockInZone(now, timeZone))
}
