// A Google Calendar the sync engine cannot tell from the real one, and an
// in-memory stand-in for the four tables it writes to.
//
// The point of both is that the *shipping* engine runs against them: no test
// double replaces supabase/functions/_shared/sync.js, and the API client is
// the real one — the fake is a `fetch`, one layer below it. So token refresh,
// the 401 retry, the 429 backoff, the 412 etag conflict and the 410 expired
// sync token are all exercised as written, not as described.

import { createGoogleClient, SCOPES } from '../supabase/functions/_shared/google.js'

let seq = 0
const nextId = (prefix) => `${prefix}${++seq}`

// ── The fake Google ─────────────────────────────────────────────────────────
export function makeGoogle({
  now = () => Date.parse('2026-09-02T12:00:00Z'),
  refreshToken = 'refresh-1',
  accessToken = 'access-1',
  // Dieselben Scopes, die eine echte Verbindung heute erteilt bekommt — ohne
  // Kontakte. Ein Test, der Geburtstage in Google schreiben will, muss sie
  // ausdrücklich anfordern, genau wie der Nutzer es später tun wird.
  scopes = SCOPES.join(' '),
} = {}) {
  const state = {
    calendars: new Map(),      // id -> calendarList entry
    events: new Map(),         // calendarId -> Map(eventId -> event)
    contacts: new Map(),       // resourceName -> person
    channels: new Map(),
    // A queue of canned failures: shift one per matching request.
    failures: [],
    calls: [],
    refreshes: 0,
    refreshToken,
    accessToken,
    scopes,
    // When true the refresh token is rejected — a revoked grant.
    revoked: false,
    // Sync tokens are handed out per calendar and remember what the caller
    // has already seen, so an incremental read really is incremental.
    syncTokens: new Map(),
    expiredSyncTokens: new Set(),
    clock: now,
  }

  const cal = (id) => {
    if (!state.events.has(id)) state.events.set(id, new Map())
    return state.events.get(id)
  }

  // "What changed since" and "when it says it changed" are two different
  // things in Google too: the sync token is a cursor over the change log, while
  // `updated` is a timestamp the conflict rule reads. Keeping them apart is
  // what lets a test say "Google changed this at 10:01" without also claiming
  // the change happened before the cursor was issued.
  let seq = 0
  // Real Google bumps `updated` on every change. A frozen test clock would
  // hand out the same timestamp twice, and the engine would correctly read the
  // second one as an echo of the first — so the stamp carries the sequence,
  // which keeps it strictly increasing without taking the clock away from the
  // tests that pin it.
  const stamp = () => new Date(state.clock() + seq * 1000).toISOString()

  state.addCalendar = (entry) => {
    state.calendars.set(entry.id, {
      accessRole: 'owner',
      backgroundColor: '#4a80ff',
      foregroundColor: '#ffffff',
      timeZone: 'Europe/Berlin',
      defaultReminders: [],
      ...entry,
    })
    cal(entry.id)
    return entry.id
  }

  state.addEvent = (calendarId, event) => {
    const id = event.id ?? nextId('gev')
    seq += 1
    const row = { id, etag: `"${nextId('etag')}"`, updated: stamp(), status: 'confirmed', ...event, seq }
    cal(calendarId).set(id, row)
    return row
  }

  state.changeEvent = (calendarId, id, patch) => {
    const current = cal(calendarId).get(id)
    seq += 1
    const next = { ...current, ...patch, etag: `"${nextId('etag')}"`, updated: stamp(), seq }
    cal(calendarId).set(id, next)
    return next
  }

  state.removeEvent = (calendarId, id) => {
    const current = cal(calendarId).get(id)
    seq += 1
    if (current) cal(calendarId).set(id, { ...current, status: 'cancelled', updated: stamp(), seq })
  }

  // Queue a failure for the next request whose URL contains `match`.
  state.failNext = (match, response) => state.failures.push({ match, response })

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  async function fetchImpl(url, init = {}) {
    const target = String(url)
    const method = (init.method || 'GET').toUpperCase()
    state.calls.push({ method, url: target })

    const queued = state.failures.findIndex((f) => target.includes(f.match))
    if (queued !== -1) {
      const { response } = state.failures[queued]
      state.failures.splice(queued, 1)
      return json(response.body ?? {}, response.status)
    }

    // ── token endpoint ────────────────────────────────────────────────
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      const body = new URLSearchParams(init.body)
      if (body.get('grant_type') === 'refresh_token') {
        state.refreshes += 1
        if (state.revoked || body.get('refresh_token') !== state.refreshToken) {
          return json({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400)
        }
        state.accessToken = nextId('access-')
        return json({ access_token: state.accessToken, expires_in: 3600, scope: state.scopes })
      }
      // authorization_code
      return json({
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        expires_in: 3600,
        scope: state.scopes,
        token_type: 'Bearer',
        id_token: `x.${btoa(JSON.stringify({ email: 'julian@example.test', sub: 'sub-1' }))}.y`,
      })
    }

    const auth = new Headers(init.headers).get('Authorization') ?? ''
    if (auth !== `Bearer ${state.accessToken}`) {
      return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
    }

    const parsed = new URL(target)
    const path = parsed.pathname

    if (path.endsWith('/users/me/calendarList')) {
      return json({ items: [...state.calendars.values()] })
    }

    // /calendars/{id}/events…
    const eventsMatch = path.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)
    if (eventsMatch) {
      const calendarId = decodeURIComponent(eventsMatch[1])
      const eventId = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : null
      const store = cal(calendarId)

      if (method === 'GET' && !eventId) {
        const token = parsed.searchParams.get('syncToken')
        if (token && state.expiredSyncTokens.has(token)) {
          return json({ error: { code: 410, message: 'Sync token is no longer valid.' } }, 410)
        }
        const since = token ? (state.syncTokens.get(token) ?? 0) : 0
        const all = [...store.values()]
        // Incremental: only what moved past the cursor. A full read also drops
        // the cancelled events nobody ever saw.
        const items = (token ? all.filter((e) => e.seq > since) : all.filter((e) => e.status !== 'cancelled'))
          .map(({ seq: _seq, ...rest }) => rest)
        const nextToken = nextId('sync-')
        state.syncTokens.set(nextToken, seq)
        return json({ items, nextSyncToken: nextToken })
      }

      if (method === 'GET' && eventId) {
        const found = store.get(eventId)
        if (!found) return json({ error: { code: 404, message: 'Not Found' } }, 404)
        const { seq: _seq, ...rest } = found
        return json(rest)
      }

      if (method === 'POST' && !eventId) {
        const body = JSON.parse(init.body)
        const { seq: _seq, ...created } = state.addEvent(calendarId, body)
        return json(created)
      }

      if (method === 'PATCH' && eventId) {
        const found = store.get(eventId)
        if (!found || found.status === 'cancelled') {
          return json({ error: { code: 404, message: 'Not Found' } }, 404)
        }
        const ifMatch = new Headers(init.headers).get('If-Match')
        if (ifMatch && ifMatch !== found.etag) {
          return json({ error: { code: 412, message: 'Precondition Failed' } }, 412)
        }
        const { seq: _seq, ...changed } = state.changeEvent(calendarId, eventId, JSON.parse(init.body))
        return json(changed)
      }

      if (method === 'DELETE' && eventId) {
        const found = store.get(eventId)
        if (!found || found.status === 'cancelled') {
          return json({ error: { code: 410, message: 'Resource has been deleted' } }, 410)
        }
        state.removeEvent(calendarId, eventId)
        return new Response(null, { status: 204 })
      }
    }

    if (path.endsWith('/events/watch')) {
      const body = JSON.parse(init.body)
      state.channels.set(body.id, body)
      return json({ resourceId: nextId('res-'), expiration: String(state.clock() + 7 * 86400000) })
    }

    if (path.endsWith('/channels/stop')) {
      const body = JSON.parse(init.body)
      state.channels.delete(body.id)
      return new Response(null, { status: 204 })
    }

    // ── People API ────────────────────────────────────────────────────
    const personMatch = path.match(/\/v1\/(people\/[^:/]+)(:updateContact)?$/)
    if (personMatch) {
      const resourceName = personMatch[1]
      const person = state.contacts.get(resourceName)
      if (!person) return json({ error: { code: 404, message: 'Not Found' } }, 404)
      if (method === 'PATCH') {
        const body = JSON.parse(init.body)
        if (body.etag !== person.etag) {
          return json({ error: { code: 400, message: 'etag mismatch' } }, 400)
        }
        const next = { ...person, birthdays: body.birthdays, etag: nextId('petag-') }
        state.contacts.set(resourceName, next)
        return json(next)
      }
      return json(person)
    }

    if (target.startsWith('https://openidconnect.googleapis.com')) {
      return json({ email: 'julian@example.test', sub: 'sub-1' })
    }

    return json({ error: { code: 404, message: `not stubbed: ${method} ${path}` } }, 404)
  }

  state.client = (over = {}) =>
    createGoogleClient({
      fetch: fetchImpl,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      credentials: {
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        expires_at: new Date(state.clock() + 3600_000).toISOString(),
        scopes: state.scopes,
      },
      now: state.clock,
      // No real waiting in tests; the retry *count* is what matters.
      sleep: async () => {},
      ...over,
    })

  state.fetch = fetchImpl
  return state
}

// ── The in-memory database ──────────────────────────────────────────────────
// Same method names and same contract as supabase/functions/_shared/store.js,
// including the part that matters most: every read filters by user id, so a
// test can put two users in one database and prove they stay apart.
export function makeStore(seed = {}) {
  const db = {
    connections: new Map(),
    credentials: new Map(),
    calendars: [],
    events: [],
    tombstones: [],
    channels: [],
    profiles: new Map(),
    ...seed,
  }
  let clock = Date.parse('2026-09-02T12:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()

  const store = {
    db,
    setClock: (iso) => {
      clock = Date.parse(iso)
    },

    async getConnection(userId) {
      return db.connections.get(userId) ?? null
    },
    async upsertConnection(userId, patch) {
      const next = { user_id: userId, ...(db.connections.get(userId) ?? {}), ...patch }
      db.connections.set(userId, next)
      return next
    },
    async updateConnection(userId, patch) {
      const current = db.connections.get(userId)
      if (!current) return null
      const next = { ...current, ...patch }
      db.connections.set(userId, next)
      return next
    },
    async deleteConnection(userId) {
      db.connections.delete(userId)
    },

    async getCredentials(userId) {
      return db.credentials.get(userId) ?? null
    },
    async saveCredentials(userId, patch) {
      const next = { user_id: userId, ...(db.credentials.get(userId) ?? {}), ...patch }
      db.credentials.set(userId, next)
      return next
    },
    async deleteCredentials(userId) {
      db.credentials.delete(userId)
    },

    async listCalendars(userId) {
      return db.calendars.filter((c) => c.user_id === userId).map((c) => ({ ...c }))
    },
    async upsertCalendars(rows) {
      for (const row of rows) {
        const index = db.calendars.findIndex(
          (c) => c.user_id === row.user_id && c.google_calendar_id === row.google_calendar_id
        )
        if (index === -1) db.calendars.push({ ...row })
        else db.calendars[index] = { ...db.calendars[index], ...row }
      }
      return rows
    },
    async setCalendarSelected(userId, id, isSelected) {
      const found = db.calendars.find((c) => c.user_id === userId && c.google_calendar_id === id)
      if (found) Object.assign(found, { is_selected: isSelected, ...(isSelected ? { sync_token: null } : {}), last_error: null })
      return found ?? null
    },
    async setCalendarSyncToken(userId, id, token) {
      const found = db.calendars.find((c) => c.user_id === userId && c.google_calendar_id === id)
      if (found) found.sync_token = token
    },
    async updateCalendarAfterSync(userId, id, patch) {
      const found = db.calendars.find((c) => c.user_id === userId && c.google_calendar_id === id)
      if (found) Object.assign(found, patch)
    },
    async markCalendarsUnavailable(userId, ids) {
      for (const c of db.calendars) {
        if (c.user_id === userId && ids.includes(c.google_calendar_id)) {
          c.is_available = false
          c.is_selected = false
        }
      }
    },
    async deleteCalendars(userId) {
      db.calendars = db.calendars.filter((c) => c.user_id !== userId)
    },

    async findEventByGoogleId(userId, calendarId, eventId) {
      return (
        db.events.find(
          (e) =>
            e.user_id === userId &&
            e.google_calendar_id === calendarId &&
            e.google_event_id === eventId
        ) ?? null
      )
    },
    async insertEvent(row) {
      // The unique index from migration 0005, enforced here too — a test that
      // creates a duplicate has to fail like the database would.
      if (row.google_event_id) {
        const clash = await store.findEventByGoogleId(
          row.user_id,
          row.google_calendar_id,
          row.google_event_id
        )
        if (clash) throw new Error('duplicate key value violates unique constraint "events_google_identity_idx"')
      }
      const next = { id: nextId('row-'), created_at: tick(), updated_at: tick(), ...row }
      db.events.push(next)
      return next
    },
    async updateEvent(id, patch) {
      const found = db.events.find((e) => e.id === id)
      if (!found) return null
      // The sync service writes as `service_role`, so `events_mark_pending`
      // leaves it alone — which is what keeps Google → app from creating work
      // for app → Google. The fake reproduces exactly that.
      Object.assign(found, patch, { updated_at: tick() })
      return found
    },
    async deleteEventById(id) {
      const index = db.events.findIndex((e) => e.id === id)
      // A delete by the sync service leaves no tombstone, same as the trigger.
      if (index !== -1) db.events.splice(index, 1)
    },
    async listPendingEvents(userId) {
      return db.events.filter(
        (e) =>
          e.user_id === userId &&
          e.sync_state === 'pending' &&
          e.sync_enabled &&
          e.google_calendar_id
      )
    },
    async detachEvents(userId) {
      for (const e of db.events) {
        if (e.user_id === userId && e.google_event_id) {
          Object.assign(e, {
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
        }
      }
    },

    async listTombstones(userId) {
      return db.tombstones.filter((t) => t.user_id === userId && (t.attempts ?? 0) < 5)
    },
    async deleteTombstone(id) {
      db.tombstones = db.tombstones.filter((t) => t.id !== id)
    },
    async touchTombstone(id, message) {
      const found = db.tombstones.find((t) => t.id === id)
      if (found) {
        found.attempts = (found.attempts ?? 0) + 1
        found.last_error = message
      }
    },
    async clearTombstones(userId) {
      db.tombstones = db.tombstones.filter((t) => t.user_id !== userId)
    },

    async listChannels(userId) {
      return db.channels.filter((c) => c.user_id === userId)
    },
    async insertChannel(channel) {
      db.channels.push(channel)
      return channel
    },
    async findChannel(id) {
      return db.channels.find((c) => c.id === id) ?? null
    },
    async deleteChannel(id) {
      db.channels = db.channels.filter((c) => c.id !== id)
    },

    async getTimeZone(userId) {
      return db.profiles.get(userId)?.timezone ?? 'Europe/Berlin'
    },
  }

  // What a device write looks like: the trigger `events_mark_pending` turns a
  // client change into `pending`, and a client delete leaves a tombstone.
  store.deviceUpdate = (id, patch) => {
    const found = db.events.find((e) => e.id === id)
    if (!found) throw new Error('no such event')
    Object.assign(found, patch, { updated_at: tick() })
    if (found.sync_enabled && found.google_calendar_id) found.sync_state = 'pending'
    return found
  }
  store.deviceInsert = (row) => {
    const next = {
      id: nextId('row-'),
      created_at: tick(),
      updated_at: tick(),
      sync_enabled: true,
      ...row,
    }
    next.sync_state = next.sync_enabled && next.google_calendar_id ? 'pending' : 'local'
    db.events.push(next)
    return next
  }
  store.deviceDelete = (id) => {
    const index = db.events.findIndex((e) => e.id === id)
    if (index === -1) return
    const [row] = db.events.splice(index, 1)
    if (row.google_event_id && row.google_calendar_id && row.sync_enabled) {
      db.tombstones.push({
        id: nextId('tomb-'),
        user_id: row.user_id,
        google_calendar_id: row.google_calendar_id,
        google_event_id: row.google_event_id,
        attempts: 0,
      })
    }
  }

  return store
}

export const deps = (google, store, clock = () => Date.parse('2026-09-02T12:00:00Z')) => ({
  google,
  store,
  now: clock,
  randomId: () => crypto.randomUUID(),
})
