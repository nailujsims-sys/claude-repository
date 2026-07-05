import { startOfDay } from './date'
import { eventStart } from './calendar'

// Calendar search. Pure + framework-free so the overlay stays declarative and
// the matching/ordering is unit-tested. Searches the three free-text fields the
// spec calls out — title, location (Ort) and description (Notizen) — and orders
// hits the way a person scans a calendar: upcoming events first (soonest at the
// top), then past events (most recent first).
export function searchEvents(events, query, ref = new Date()) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []

  const matches = events.filter((ev) => {
    const haystack = [ev.title, ev.location, ev.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })

  const today = startOfDay(ref).getTime()
  const key = (ev) => {
    const s = eventStart(ev)
    return s ? s.getTime() : 0
  }

  const future = matches.filter((ev) => key(ev) >= today).sort((a, b) => key(a) - key(b))
  const past = matches.filter((ev) => key(ev) < today).sort((a, b) => key(b) - key(a))
  return [...future, ...past]
}
