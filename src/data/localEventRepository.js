import { buildEventRow, pickWritableEvent } from './eventDefaults'
import { seedEvents } from '../lib/eventSeed'

// localStorage-backed calendar events, mirroring the tasks repository. The
// stored shape matches the Supabase `events` table, so the two are drop-in
// interchangeable. Used whenever Supabase is not configured.

// `v2`: one-time seed bump. Event create/edit/delete did not exist before, so
// any previously stored events are pure demo seed — re-seeding loses no real
// data and refreshes the demo (incl. the corrected "Mama" birthday name)
// relative to the current day. Do NOT bump this again now that events persist.
const keyFor = (userId) => `mw.events.v2.${userId}`

function read(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore corrupt storage
  }
  const seeded = seedEvents().map((row) => buildEventRow(userId, row))
  write(userId, seeded)
  return seeded
}

function write(userId, events) {
  localStorage.setItem(keyFor(userId), JSON.stringify(events))
}

export const localEventRepository = {
  async listEvents(userId) {
    return read(userId).sort((a, b) =>
      (a.start_at || '').localeCompare(b.start_at || '')
    )
  },

  async createEvent(userId, data) {
    const events = read(userId)
    const row = buildEventRow(userId, data)
    events.push(row)
    write(userId, events)
    return row
  },

  async updateEvent(userId, id, patch) {
    const events = read(userId)
    const idx = events.findIndex((e) => e.id === id)
    if (idx === -1) throw new Error('Event not found')
    const updated = {
      ...events[idx],
      ...pickWritableEvent(patch),
      updated_at: new Date().toISOString(),
    }
    events[idx] = updated
    write(userId, events)
    return updated
  },

  async deleteEvent(userId, id) {
    const events = read(userId).filter((e) => e.id !== id)
    write(userId, events)
  },
}
