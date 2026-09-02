// A PostgREST-shaped backend for the smoke test.
//
// The app now has exactly one source of data, so the test harness has to speak
// that source's language: this answers the same requests supabase-js sends and
// holds the rows in memory. It replaced localStorage seeding, and that is the
// point — if a screen renders a task, the task came over the wire.
//
// It is deliberately strict about two things, because both are security
// behaviour the app must keep: a request without credentials is rejected, and
// every row it hands back belongs to the user in the token.

import { randomUUID } from 'node:crypto'

export const TEST_USER_ID = '11111111-2222-4333-8444-555555555555'
export const TEST_EMAIL = 'julian@mindwhiteboard.test'
export const SUPABASE_URL = 'https://smoke.supabase.co'
export const SUPABASE_ANON_KEY = 'anon-key-for-tests'
// supabase-js derives this from the project host; the session must be found
// under exactly this key or the app starts signed out.
export const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`

const nowIso = () => new Date().toISOString()

export function taskRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    title: data.title ?? '',
    category: data.category ?? 'Privat',
    subcategory: data.subcategory ?? null,
    details: data.details ?? null,
    due_date: data.due_date ?? null,
    due_time: data.due_time ?? null,
    due_type: data.due_type ?? 'day',
    is_favorite: data.is_favorite ?? false,
    is_completed: data.is_completed ?? false,
    is_deleted: data.is_deleted ?? false,
    completed_at: data.completed_at ?? null,
    deleted_at: data.deleted_at ?? null,
    sort_order: data.sort_order ?? 0,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

export function eventRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    title: data.title ?? '',
    description: data.description ?? null,
    location: data.location ?? null,
    start_at: data.start_at ?? null,
    end_at: data.end_at ?? null,
    all_day: data.all_day ?? false,
    recurrence: data.recurrence ?? null,
    reminder: data.reminder ?? null,
    is_birthday: data.is_birthday ?? false,
    timezone: data.timezone ?? 'Europe/Berlin',
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

// A session far enough from expiry that the client never tries to refresh it —
// the network stub answers data, not auth.
export function makeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24
  return {
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24,
    expires_at: expiresAt,
    refresh_token: 'test-refresh-token',
    user: {
      id: TEST_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: TEST_EMAIL,
      created_at: nowIso(),
      app_metadata: { provider: 'email' },
      user_metadata: {},
    },
  }
}

const OPS = {
  eq: (a, b) => String(a) === b,
  neq: (a, b) => String(a) !== b,
  is: (a, b) => (b === 'null' ? a === null || a === undefined : String(a) === b),
}

function matches(row, params) {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    const fn = OPS[op]
    if (!fn) throw new Error(`supabaseStub: unsupported filter "${key}=${raw}"`)
    if (!fn(row[key], value)) return false
  }
  return true
}

function sorted(rows, order) {
  if (!order) return rows
  const [column, direction = 'asc'] = order.split('.')
  return [...rows].sort((a, b) => {
    const x = a[column] ?? ''
    const y = b[column] ?? ''
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return direction === 'desc' ? -cmp : cmp
  })
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// `tables` is shared with the caller, so a test can assert what actually
// landed in the database rather than what the screen claims.
export function makeBackend({
  tasks = [],
  events = [],
  profiles = null,
  password = 'richtiges-passwort',
  failTable = null,
} = {}) {
  const tables = {
    tasks: tasks.map(taskRow),
    events: events.map(eventRow),
    profiles: profiles ?? [
      { id: TEST_USER_ID, display_name: 'Julian', timezone: 'Europe/Berlin', created_at: nowIso(), updated_at: nowIso() },
    ],
  }
  const calls = []
  const auth = { session: makeSession(), signedOut: false, recoverEmails: [], newPasswords: [] }

  async function fetchStub(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
    calls.push({ method, path: url.pathname, search: url.search })

    // ── GoTrue ────────────────────────────────────────────────────────────
    // Enough of it to drive the real flows: sign in, sign out, ask for a reset
    // mail, set a new password. The app talks to supabase-js, supabase-js talks
    // to these, so the tests exercise the actual client code.
    if (url.pathname.startsWith('/auth/v1/')) {
      const body = init.body ? JSON.parse(init.body) : {}

      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') {
          if (body.password !== password) {
            return json({ error: 'invalid_grant', error_code: 'invalid_credentials', code: 400, msg: 'Invalid login credentials', message: 'Invalid login credentials' }, 400)
          }
          auth.signedOut = false
          return json({ ...auth.session, user: { ...auth.session.user, email: body.email } })
        }
        return json(auth.session)
      }

      if (url.pathname === '/auth/v1/logout') {
        auth.signedOut = true
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/auth/v1/recover') {
        auth.recoverEmails.push(body.email)
        return json({})
      }

      if (url.pathname === '/auth/v1/user') {
        if (method === 'PUT') {
          if (typeof body.password === 'string') auth.newPasswords.push(body.password)
          return json(auth.session.user)
        }
        return json(auth.session.user)
      }

      return json({ error: 'auth endpoint not stubbed', path: url.pathname }, 501)
    }

    const table = url.pathname.replace('/rest/v1/', '')
    if (!(table in tables)) return json({ message: `unknown table ${table}` }, 404)

    // Every PostgREST call carries both; without them PostgREST answers as the
    // anon role, which the migrations grant nothing.
    if (!headers.get('apikey') || !headers.get('authorization')) {
      return json({ message: 'No API key found in request', code: '401' }, 401)
    }

    // A backend that is having a bad day, on request — the app has to say so
    // rather than render an empty screen as if there were nothing to show.
    if (failTable === table) {
      return json({ message: 'Datenbank nicht erreichbar (Test)', code: 'PGRST000' }, 500)
    }

    const params = [...url.searchParams.entries()]
    const wantsObject = (headers.get('accept') || '').includes('vnd.pgrst.object')
    const rows = tables[table]

    const respond = (result) => {
      if (!wantsObject) return json(result)
      if (result.length === 1) return json(result[0])
      return json(
        {
          code: 'PGRST116',
          message: `JSON object requested, multiple (or no) rows returned`,
          details: `Results contain ${result.length} rows`,
        },
        406
      )
    }

    if (method === 'GET') {
      const found = sorted(rows.filter((r) => matches(r, params)), url.searchParams.get('order'))
      return respond(found)
    }

    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const incoming = Array.isArray(body) ? body : [body]
      const build = table === 'events' ? eventRow : taskRow
      const created = incoming.map((data) => {
        // The database rejects a row without an owner, and so does this.
        if (!data.user_id) throw new Error('supabaseStub: insert without user_id')
        return build(data)
      })
      rows.push(...created)
      return respond(created)
    }

    if (method === 'PATCH') {
      const patch = JSON.parse(init.body)
      const hit = rows.filter((r) => matches(r, params))
      for (const row of hit) Object.assign(row, patch, { updated_at: nowIso() })
      return respond(hit)
    }

    if (method === 'DELETE') {
      const hit = rows.filter((r) => matches(r, params))
      tables[table] = rows.filter((r) => !hit.includes(r))
      return respond(hit)
    }

    return json({ message: `method ${method} not stubbed` }, 405)
  }

  return { fetch: fetchStub, tables, calls, auth, session: auth.session }
}
