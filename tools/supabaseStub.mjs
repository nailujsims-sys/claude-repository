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

// The finance module's tables, in the order supabase/migrations/0008_finance.sql
// creates them.
export const FINANCE_TABLES = [
  'finance_accounts',
  'finance_categories',
  'finance_merchants',
  'finance_merchant_patterns',
  'finance_category_rules',
  'finance_imports',
  'finance_transactions',
  'finance_transaction_overrides',
  // Added by 0009. They are read on every finance load — the matcher needs the
  // observations to recognise a booking it has already seen described better —
  // so a stub without them no longer represents production.
  'finance_transaction_observations',
  'finance_transaction_observation_sightings',
  'finance_transaction_relations',
  'finance_transaction_relation_members',
  'finance_import_review_items',
  'finance_import_review_item_transactions',
  // Added by 0011. Read on every finance load for the same kind of reason the
  // observations are: the classification queue asks whether a booking is
  // already sufficiently sorted, and since v1.23 a complete AI suggestion is
  // one of the answers. A stub without this table makes the whole module look
  // like a failed request.
  'finance_transaction_ai_suggestions',
  // Added by 0012. The AI import's memory: read on every finance load, because
  // „KI-Kontext kopieren" builds the prompt from it. A stub without it makes
  // the whole module look like a failed request, exactly as 0011's table did.
  'finance_ai_learning_memories',
]

// Creating a Supabase client also builds its realtime client, and that one
// insists on a WebSocket implementation. Browsers have one, Node 22 has one,
// Node 20 — which CI pins — does not. A suite that imports a repository at the
// top level therefore passes on a developer machine and dies on the runner
// before its first assertion.
//
// It lives here rather than in each suite because that is the mistake it
// prevents: dataLogic learned it once, financeImportLogic repeated it, and a
// copy in every runner is a copy the next one forgets. Any suite that reaches
// for this stub is testing against Supabase and needs it.
//
// The app opens no realtime connection, so a stub that throws if anything ever
// does is both enough and honest.
export function installRealtimeStub() {
  globalThis.WebSocket ??= class RealtimeIsNotUnderTest {
    constructor() {
      throw new Error('Diese Suite darf keine Realtime-Verbindung öffnen.')
    }
  }
}

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
    // The Google side of an event. Null throughout for an app-only event,
    // which is what every existing fixture is.
    google_calendar_id: data.google_calendar_id ?? null,
    google_event_id: data.google_event_id ?? null,
    google_recurring_event_id: data.google_recurring_event_id ?? null,
    google_contact_id: data.google_contact_id ?? null,
    google_etag: data.google_etag ?? null,
    google_updated_at: data.google_updated_at ?? null,
    sync_enabled: data.sync_enabled ?? true,
    sync_state: data.sync_state ?? 'local',
    sync_error: data.sync_error ?? null,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

export function listRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    name: data.name ?? '',
    template: data.template ?? 'standard',
    icon: data.icon ?? 'clipboard-list',
    is_pinned: data.is_pinned ?? false,
    is_archived: data.is_archived ?? false,
    archived_at: data.archived_at ?? null,
    sort_order: data.sort_order ?? 0,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

export function listItemRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    list_id: data.list_id ?? null,
    title: data.title ?? '',
    is_done: data.is_done ?? false,
    done_at: data.done_at ?? null,
    sort_order: data.sort_order ?? 0,
    quantity: data.quantity ?? null,
    unit: data.unit ?? null,
    amount: data.amount ?? null,
    category: data.category ?? null,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

export function expenseRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    title: data.title ?? '',
    original_amount: data.original_amount ?? 0,
    original_currency: data.original_currency ?? 'AUD',
    transaction_date: data.transaction_date ?? nowIso().slice(0, 10),
    exchange_rate_aud_eur: data.exchange_rate_aud_eur ?? 0.6,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

// The finance tables. One factory for all eight: unlike tasks or events these
// rows have no defaults worth emulating — what a test puts in is what the
// engine has to work with, and inventing a column here would be inventing a
// fact the database never wrote.
export function financeRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
    ...data,
  }
}

// The two Google tables the client may read. The credentials table is
// deliberately absent: the browser has no grant on it, so a request for it
// would be a bug, and the stub answering 404 is how the smoke test notices.
export function googleConnectionRow(data = {}) {
  return {
    user_id: data.user_id ?? TEST_USER_ID,
    google_account_email: data.google_account_email ?? 'julian@example.test',
    google_account_sub: data.google_account_sub ?? 'sub-1',
    status: data.status ?? 'connected',
    scopes: data.scopes ?? '',
    last_error: data.last_error ?? null,
    last_sync_at: data.last_sync_at ?? nowIso(),
    last_sync_status: data.last_sync_status ?? 'ok',
    default_calendar_id: data.default_calendar_id ?? null,
    created_at: data.created_at ?? nowIso(),
    updated_at: data.updated_at ?? nowIso(),
  }
}

export function googleCalendarRow(data = {}) {
  return {
    id: data.id ?? randomUUID(),
    user_id: data.user_id ?? TEST_USER_ID,
    google_calendar_id: data.google_calendar_id ?? 'privat@gmail.com',
    summary: data.summary ?? 'Privat',
    description: data.description ?? null,
    time_zone: data.time_zone ?? 'Europe/Berlin',
    background_color: data.background_color ?? '#4a80ff',
    foreground_color: data.foreground_color ?? '#ffffff',
    access_role: data.access_role ?? 'owner',
    is_primary: data.is_primary ?? false,
    kind: data.kind ?? 'normal',
    is_selected: data.is_selected ?? true,
    default_reminder_minutes: data.default_reminder_minutes ?? null,
    sync_token: data.sync_token ?? null,
    is_available: data.is_available ?? true,
    last_synced_at: data.last_synced_at ?? null,
    last_error: data.last_error ?? null,
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
  googleConnections = [],
  googleCalendars = [],
  lists = [],
  listItems = [],
  expenses = [],
  // The eight finance tables, keyed by table name — `{ finance_transactions:
  // [...] }`. One option instead of eight, because a test usually seeds two of
  // them and nothing at all of the rest.
  finance = {},
  profiles = null,
  password = 'richtiges-passwort',
  failTable = null,
  // Called for every committed row change, the way Postgres reports one to the
  // Realtime server. Wiring tools/realtimeStub.mjs in here is what lets a write
  // in one window arrive in another.
  onChange = null,
  // Per-action answers for the Edge Function, keyed by action name. A test
  // that wants "connect returns this URL" or "sync fails" supplies it here.
  functions = {},
  // Answers for the database functions the app calls through PostgREST, keyed
  // by function name. `rpcCalls` is what the assertions read.
  rpc = {},
  // The public exchange-rate source (src/lib/exchangeRate.js). It is the one
  // request the app makes to something that is not Supabase, so the stub has to
  // answer it too — otherwise every Ausgaben test would silently be testing the
  // failure path. `exchangeRate: null` IS that failure path, on request.
  exchangeRate = 0.6,
} = {}) {
  const tables = {
    tasks: tasks.map(taskRow),
    events: events.map(eventRow),
    google_connections: googleConnections.map(googleConnectionRow),
    google_calendars: googleCalendars.map(googleCalendarRow),
    lists: lists.map(listRow),
    list_items: listItems.map(listItemRow),
    expenses: expenses.map(expenseRow),
    ...Object.fromEntries(
      FINANCE_TABLES.map((name) => [name, (finance[name] ?? []).map(financeRow)])
    ),
    profiles: profiles ?? [
      { id: TEST_USER_ID, display_name: 'Julian', timezone: 'Europe/Berlin', created_at: nowIso(), updated_at: nowIso() },
    ],
  }
  // Mutable so a test can turn a failure on and off between two requests;
  // `makeBackend({ failTable })` still sets the starting value.
  const state = { failTable }
  const calls = []
  const functionCalls = []
  const rpcCalls = []
  const rateCalls = []
  const auth = { session: makeSession(), signedOut: false, recoverEmails: [], newPasswords: [] }

  async function fetchStub(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
    // The body travels with the call, so a test can assert on what was SENT and
    // not only on what the stub stored. A repository that merges a patch before
    // writing it is only provable that way.
    let recorded
    if (typeof init.body === 'string') {
      try { recorded = JSON.parse(init.body) } catch { recorded = init.body }
    }
    calls.push({ method, path: url.pathname, search: url.search, body: recorded })

    // ── The exchange-rate source ──────────────────────────────────────────
    // Everything that is not this project's Supabase host is the rate API: the
    // app makes exactly one other request (see src/lib/exchangeRate.js), and
    // answering it here keeps the smoke test off the network while still
    // running the real client code end to end.
    if (url.origin !== new URL(SUPABASE_URL).origin) {
      rateCalls.push(url.href)
      if (exchangeRate === null) {
        return json({ message: 'rate source down (Test)' }, 503)
      }
      return json({
        amount: 1,
        base: 'AUD',
        date: nowIso().slice(0, 10),
        rates: { EUR: exchangeRate },
      })
    }

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

    // ── Edge Functions ────────────────────────────────────────────────────
    // Every write in the Google integration goes through one, so the smoke
    // test has to answer them — and, more usefully, can assert *what* the app
    // asked for. `functionCalls` is what the assertions read.
    if (url.pathname.startsWith('/functions/v1/')) {
      const name = url.pathname.replace('/functions/v1/', '')
      const body = init.body ? JSON.parse(init.body) : {}
      // The real function is deployed with verify_jwt, so an unauthenticated
      // call never reaches its code. The stub refuses one for the same reason.
      if (!headers.get('authorization')) {
        return json({ error: 'Nicht angemeldet.' }, 401)
      }
      functionCalls.push({ name, action: body.action ?? null, body })
      const handler = functions[body.action ?? name]
      if (typeof handler === 'function') return handler(body)
      return json({ ok: true })
    }

    // ── Database functions ────────────────────────────────────────────────
    // PostgREST offers a function at /rest/v1/rpc/<name>; supabase-js `.rpc()`
    // posts the named arguments as the body. The finance module's learning
    // call is one of these, and what matters to a test is exactly that body.
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.replace('/rest/v1/rpc/', '')
      if (!headers.get('apikey') || !headers.get('authorization')) {
        return json({ message: 'No API key found in request', code: '401' }, 401)
      }
      const body = init.body ? JSON.parse(init.body) : {}
      rpcCalls.push({ name, body })
      const handler = rpc[name]
      if (typeof handler === 'function') return handler(body)
      if (name === 'finance_update_account') {
        const result = updateAccount(body)
        return json(result, result?.message ? 400 : 200)
      }
      if (name === 'finance_set_account_archived') {
        const result = setAccountArchived(body)
        return json(result, result?.message ? 400 : 200)
      }
      if (name === 'finance_delete_empty_account') {
        const result = deleteEmptyAccount(body)
        return json(result, result?.message ? 400 : 200)
      }
      if (name === 'finance_learn_merchant_rule') return json(learnMerchantRule(body))
      if (name === 'finance_apply_ai_import') {
        const result = applyAiImport(body)
        return json(result, result?.message ? 400 : 200)
      }
      return json({ ok: true })
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
    // Read from the mutable holder, not from the argument: a test that has to
    // fail ONE write and then let the retry through needs to switch it mid-run.
    if (state.failTable === table) {
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
      const build =
        {
          events: eventRow,
          google_calendars: googleCalendarRow,
          google_connections: googleConnectionRow,
          lists: listRow,
          list_items: listItemRow,
          expenses: expenseRow,
          ...Object.fromEntries(FINANCE_TABLES.map((name) => [name, financeRow])),
        }[table] ?? taskRow
      // An UPSERT is a POST with `Prefer: resolution=merge-duplicates` and the
      // conflict target in `on_conflict`. Without this the stub inserted a
      // second row where Postgres would have updated the first — so a test
      // could pass here and the app lose data in production, which is the one
      // thing this stub exists to prevent.
      // Read off the URL rather than the parsed filters: `on_conflict` is not a
      // filter, it is the conflict target, and it never appears as `col=eq.x`.
      const prefer = headers.get('prefer') ?? ''
      const conflict = prefer.includes('resolution=merge-duplicates')
        ? (url.searchParams.get('on_conflict') ?? '').split(',').filter(Boolean)
        : []

      const created = []
      const updated = []
      for (const data of incoming) {
        // The database rejects a row without an owner, and so does this.
        if (!data.user_id) throw new Error('supabaseStub: insert without user_id')
        const existing =
          conflict.length > 0
            ? rows.find((r) => conflict.every((column) => r[column] === data[column]))
            : null
        if (existing) {
          // ON CONFLICT DO UPDATE writes the columns the payload names and
          // leaves every other one alone.
          Object.assign(existing, data)
          updated.push(existing)
        } else {
          const row = build(data)
          rows.push(row)
          created.push(row)
        }
      }
      for (const row of created) onChange?.({ table, type: 'INSERT', record: { ...row } })
      for (const row of updated) onChange?.({ table, type: 'UPDATE', record: { ...row } })
      return respond([...created, ...updated])
    }

    if (method === 'PATCH') {
      const patch = JSON.parse(init.body)
      const hit = rows.filter((r) => matches(r, params))
      for (const row of hit) Object.assign(row, patch, { updated_at: nowIso() })
      for (const row of hit) onChange?.({ table, type: 'UPDATE', record: { ...row } })
      return respond(hit)
    }

    if (method === 'DELETE') {
      const hit = rows.filter((r) => matches(r, params))
      tables[table] = rows.filter((r) => !hit.includes(r))
      for (const row of hit) onChange?.({ table, type: 'DELETE', old_record: { id: row.id } })
      // `list_items.list_id` is `on delete cascade` in the migration, so a
      // deleted list takes its entries with it. Emulated here rather than left
      // out: without it the harness would show orphans the database can never
      // produce, and a test asserting "the entries are gone too" would be
      // asserting the stub instead of the schema.
      if (table === 'lists' && hit.length) {
        const goneIds = new Set(hit.map((r) => r.id))
        const orphans = tables.list_items.filter((r) => goneIds.has(r.list_id))
        tables.list_items = tables.list_items.filter((r) => !goneIds.has(r.list_id))
        for (const row of orphans) {
          onChange?.({ table: 'list_items', type: 'DELETE', old_record: { id: row.id } })
        }
      }
      return respond(hit)
    }

    return json({ message: `method ${method} not stubbed` }, 405)
  }

  // ── Die drei Konto-Funktionen aus 0013, so weit ein Screen sie merkt ─────
  //
  // Die echten stehen in supabase/migrations/0013 und werden gegen ein echtes
  // Postgres geprüft (tools/financeAccountsE2E.mjs). Was ein DOM-Test braucht,
  // sind ihre SICHTBAREN Wirkungen — und die beiden Regeln, an denen eine
  // Oberfläche scheitern kann, sind hier bewusst nachgebildet statt dem
  // Aufrufer geglaubt:
  //   • die Währung eines Kontos mit Buchungen oder Importen ändert sich nicht;
  //   • ein Konto mit Finanzdaten wird nicht gelöscht, und zwar mit demselben
  //     Fehlercode, an dem der Client die Meldung auswählt.
  const ownFinance = (table) => tables[table].filter((r) => r.user_id === TEST_USER_ID)
  const ownAccount = (id) => ownFinance('finance_accounts').find((a) => a.id === id) ?? null
  const accountHasHistory = (id) =>
    ownFinance('finance_transactions').some((r) => r.account_id === id) ||
    ownFinance('finance_imports').some((r) => r.account_id === id) ||
    ownFinance('finance_import_review_items').some((r) => r.account_id === id)

  function updateAccount(body) {
    const p = body ?? {}
    const account = ownAccount(p.p_account_id)
    if (!account) return { message: 'finance: Konto nicht gefunden', code: 'P0002' }
    const name = String(p.p_name ?? '').trim()
    if (name === '') return { message: 'Das Konto braucht einen Namen.', code: 'FIN03' }
    const currency = String(p.p_currency ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { message: 'Die Währung braucht drei Buchstaben, zum Beispiel EUR.', code: 'FIN03' }
    }
    if (currency !== account.currency && accountHasHistory(account.id)) {
      return {
        message:
          'Die Währung kann nicht mehr geändert werden, weil das Konto bereits Buchungen enthält.',
        code: 'FIN01',
      }
    }
    account.name = name
    account.provider = String(p.p_provider ?? '').trim() || null
    account.currency = currency
    account.updated_at = nowIso()
    onChange?.({ table: 'finance_accounts', type: 'UPDATE', record: { ...account } })
    return { ...account }
  }

  function setAccountArchived(body) {
    const p = body ?? {}
    const account = ownAccount(p.p_account_id)
    if (!account) return { message: 'finance: Konto nicht gefunden', code: 'P0002' }
    account.archived_at = p.p_archived ? account.archived_at ?? nowIso() : null
    account.updated_at = nowIso()
    onChange?.({ table: 'finance_accounts', type: 'UPDATE', record: { ...account } })
    return { ...account }
  }

  function deleteEmptyAccount(body) {
    const p = body ?? {}
    const account = ownAccount(p.p_account_id)
    if (!account) return { message: 'finance: Konto nicht gefunden', code: 'P0002' }
    if (accountHasHistory(account.id)) {
      return {
        message: 'Dieses Konto enthält bereits Finanzdaten und kann nur archiviert werden.',
        code: 'FIN02',
      }
    }
    tables.finance_accounts = tables.finance_accounts.filter((a) => a.id !== account.id)
    onChange?.({ table: 'finance_accounts', type: 'DELETE', old_record: { id: account.id } })
    return account.id
  }

  // ── finance_apply_ai_import, as far as a screen can tell ─────────────────
  //
  // The real one is in 0011/0012 and is tested against a real Postgres
  // (tools/financeAiE2E.mjs, tools/financeLearningE2E.mjs). What a DOM test
  // needs is its OBSERVABLE effects, and for v1.24 that is one effect above
  // all: an import that was told to remember something leaves a memory behind,
  // so the next „KI-Kontext kopieren" says something different than before.
  //
  // The rules that decide WHAT is remembered are reproduced here rather than
  // trusted to the caller, because they are the ones a screen can get wrong:
  //   • nothing is learned unless the human corrected the row AND chose a scope;
  //   • the note is never learned;
  //   • type and inclusion only when they differ from the model's suggestion;
  //   • one active strong rule per merchant — a new one replaces the old, and
  //     provider and merchant rule cannot both be active for the same name.
  function memoryKey(name) {
    const text = String(name ?? '')
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
    return text === '' ? null : text
  }

  function applyAiImport(body) {
    const p = body ?? {}
    const owned = (list) => list.filter((r) => r.user_id === TEST_USER_ID)
    const found = owned(tables.finance_imports).find((row) => row.id === p.p_import_id)
    if (!found) return { message: 'finance: Import nicht gefunden' }
    if (found.account_id !== p.p_account_id) {
      return { message: 'finance: der Import gehoert zu einem anderen Konto' }
    }
    if (found.status === 'imported') {
      return { ...(found.apply_result ?? { import_id: found.id }), replayed: true }
    }

    let created = 0
    let suggestions = 0
    let decisions = 0
    let memories = 0

    for (const booking of p.p_bookings ?? []) {
      const s = booking.suggestion ?? {}
      const d = booking.user_decision ?? null
      const type = booking.transaction_type || 'purchase'
      const include = booking.include_in_analytics !== false

      const transaction = financeRow({
        user_id: TEST_USER_ID,
        account_id: p.p_account_id,
        import_id: p.p_import_id,
        booking_date: booking.booking_date,
        amount_minor: booking.amount_minor,
        currency: booking.currency ?? 'EUR',
        raw_description: booking.raw_description,
        normalized_tokens: booking.normalized_tokens ?? [],
        category_id: booking.category_id ?? null,
        transaction_type: type,
        include_in_analytics: include,
        manual_lock: false,
        source_metadata: booking.source_metadata ?? null,
      })
      tables.finance_transactions.push(transaction)
      created += 1

      const review = ['confirmed', 'corrected'].includes(s.human_review) ? s.human_review : 'none'
      const sugType = s.transaction_type || type
      const sugInclude = s.include_in_analytics !== false
      const suggestion = financeRow({
        user_id: TEST_USER_ID,
        transaction_id: transaction.id,
        import_id: p.p_import_id,
        merchant_name: s.merchant_name ?? null,
        category_id: s.category_id ?? null,
        transaction_type: sugType,
        include_in_analytics: sugInclude,
        note: s.note ?? null,
        needs_review: s.needs_review === true,
        human_review: review,
        format_version: s.format_version ?? 1,
      })
      tables.finance_transaction_ai_suggestions.push(suggestion)
      suggestions += 1

      let decidedName = null
      if (d) {
        decidedName = (d.merchant_name ?? '').trim() || null
        const classifies = Boolean(d.merchant_id || decidedName || d.category_id)
        if (classifies || d.note || d.include_in_analytics === false) {
          tables.finance_transaction_overrides.push(
            financeRow({
              user_id: TEST_USER_ID,
              transaction_id: transaction.id,
              merchant_id: d.merchant_id ?? null,
              merchant_name: decidedName,
              category_id: d.category_id ?? null,
              include_in_analytics: d.include_in_analytics === false ? false : null,
              transaction_type: d.transaction_type ?? null,
              note: d.note ?? null,
            })
          )
          decisions += 1
        }
        if (classifies) transaction.manual_lock = true
      }

      const mode = booking.learning?.mode ?? 'none'
      if (mode === 'none') continue
      if (review !== 'corrected') {
        return { message: 'finance: gemerkt wird nur, was der Mensch korrigiert hat' }
      }
      // „Korrigiert" reicht nicht: eine geänderte Notiz ist eine Entscheidung
      // über diese Buchung und trotzdem nichts, woraus sich eine Regel für
      // kommende Importe ableiten ließe.
      const learnable = Boolean(d) && (
        d.merchant_id != null ||
        (d.merchant_name ?? null) !== (s.merchant_name ?? null) ||
        (d.category_id ?? null) !== (s.category_id ?? null) ||
        (d.transaction_type != null && d.transaction_type !== sugType) ||
        (typeof d.include_in_analytics === 'boolean' && d.include_in_analytics !== sugInclude)
      )
      if (!learnable) {
        return { message: 'finance: aus dieser Aenderung laesst sich nichts lernen' }
      }

      const name =
        decidedName ??
        owned(tables.finance_merchants).find((m) => m.id === d?.merchant_id)?.canonical_name ??
        null
      const key = memoryKey(name)
      const learnedCategory = d?.category_id ?? null
      const learnedType =
        d?.transaction_type && d.transaction_type !== sugType ? d.transaction_type : null
      const learnedInclude =
        typeof d?.include_in_analytics === 'boolean' && d.include_in_analytics !== sugInclude
          ? d.include_in_analytics
          : null

      const common = {
        user_id: TEST_USER_ID,
        merchant_name: name,
        merchant_key: key,
        source_description: booking.raw_description,
        source_transaction_id: transaction.id,
        source_suggestion_id: suggestion.id,
        suggested_merchant_name: s.merchant_name ?? null,
        suggested_category_id: s.category_id ?? null,
        suggested_transaction_type: sugType,
        suggested_include_in_analytics: sugInclude,
        active: true,
      }

      if (mode === 'similar') {
        const exampleKey = [
          memoryKey(booking.raw_description), memoryKey(s.merchant_name),
          s.category_id ?? '', sugType, String(sugInclude),
          key ?? '', learnedCategory ?? '', learnedType ?? '', String(learnedInclude),
        ].join('|')
        const twice = owned(tables.finance_ai_learning_memories).some(
          (m) => m.active && m.kind === 'similar_example' && m.example_key === exampleKey
        )
        if (twice) continue
        tables.finance_ai_learning_memories.push(
          financeRow({
            ...common,
            kind: 'similar_example',
            category_id: learnedCategory,
            transaction_type: learnedType,
            include_in_analytics: learnedInclude,
            example_key: exampleKey,
          })
        )
        memories += 1
        continue
      }

      if (!key) return { message: 'finance: eine Regel fuer die Zukunft braucht einen Haendler' }
      const kind = mode === 'merchant_rule' ? 'merchant_rule' : 'payment_provider'
      if (kind === 'merchant_rule' && !learnedCategory && !learnedType && learnedInclude === null) {
        return { message: 'finance: eine Haendlerregel braucht eine Kategorie oder eine Abweichung' }
      }

      for (const memory of owned(tables.finance_ai_learning_memories)) {
        if (!memory.active || memory.merchant_key !== key) continue
        if (memory.kind === 'similar_example') continue
        if (memory.kind === kind) {
          Object.assign(memory, common, {
            category_id: kind === 'merchant_rule' ? learnedCategory : null,
            transaction_type: kind === 'merchant_rule' ? learnedType : null,
            include_in_analytics: kind === 'merchant_rule' ? learnedInclude : null,
            updated_at: nowIso(),
          })
          memory.replaced = true
        } else {
          memory.active = false
          memory.updated_at = nowIso()
        }
      }
      const replaced = owned(tables.finance_ai_learning_memories).find((m) => m.replaced)
      if (replaced) {
        delete replaced.replaced
        memories += 1
        continue
      }
      tables.finance_ai_learning_memories.push(
        financeRow({
          ...common,
          kind,
          category_id: kind === 'merchant_rule' ? learnedCategory : null,
          transaction_type: kind === 'merchant_rule' ? learnedType : null,
          include_in_analytics: kind === 'merchant_rule' ? learnedInclude : null,
          example_key: null,
        })
      )
      memories += 1
    }

    const result = {
      import_id: p.p_import_id,
      account_id: p.p_account_id,
      created,
      suggestions,
      decisions,
      memories,
    }
    found.status = 'imported'
    found.imported_at = nowIso()
    found.apply_result = result
    found.updated_at = nowIso()
    return { ...result, replayed: false }
  }

  // ── finance_learn_merchant_rule, as far as a screen can tell ─────────────
  //
  // The real one is 200 lines of plpgsql in 0008 and is tested against a real
  // Postgres (tools/financeClassifyE2E.mjs). What a DOM test needs is its
  // OBSERVABLE effects: the merchant, pattern and rule exist afterwards, the
  // booking is stamped, and the queue therefore no longer contains it. Without
  // that, the call was counted and nothing changed — so a test could not tell a
  // successful save from a no-op, and the end-of-queue cases could not be
  // reached at all.
  //
  // The three conditions that protect a decision somebody already made are
  // reproduced, because they are the ones a screen can get wrong: a booking is
  // only swept up when it has no merchant, is not locked and has no override.
  function learnMerchantRule(body) {
    const p = body ?? {}
    const tokens = p.p_tokens ?? []
    const matches = (row) => {
      const have = Array.isArray(row?.normalized_tokens) ? row.normalized_tokens : []
      if (p.p_pattern_type === 'exact_token') return tokens.length === 1 && have.includes(tokens[0])
      if (p.p_pattern_type !== 'exact_phrase' || tokens.length < 2) return false
      for (let i = 0; i + tokens.length <= have.length; i += 1) {
        if (tokens.every((t, k) => have[i + k] === t)) return true
      }
      return false
    }
    const owned = (list) => list.filter((r) => r.user_id === TEST_USER_ID)
    const category = owned(tables.finance_categories).find((c) => c.slug === p.p_category_slug)
    if (!category) return { message: `finance: Kategorie ${p.p_category_slug} gibt es nicht` }

    const name = (p.p_merchant_name ?? '').trim()
    let merchant = p.p_merchant_id
      ? owned(tables.finance_merchants).find((m) => m.id === p.p_merchant_id)
      : owned(tables.finance_merchants).find(
          (m) => m.canonical_name.trim().toLowerCase() === name.toLowerCase())
    let merchantCreated = false
    if (!merchant) {
      merchant = financeRow({
        user_id: TEST_USER_ID, canonical_name: name,
        review_mode: p.p_review_mode ?? 'auto', default_include_in_analytics: true,
      })
      tables.finance_merchants.push(merchant)
      merchantCreated = true
    } else if (p.p_review_mode) {
      merchant.review_mode = p.p_review_mode
    }

    let pattern = owned(tables.finance_merchant_patterns).find(
      (x) => x.active && x.pattern_type === p.p_pattern_type &&
        (x.tokens ?? []).join('\u0000') === tokens.join('\u0000'))
    let patternCreated = false
    if (!pattern) {
      pattern = financeRow({
        user_id: TEST_USER_ID, merchant_id: merchant.id,
        pattern_type: p.p_pattern_type, tokens, active: true,
      })
      tables.finance_merchant_patterns.push(pattern)
      patternCreated = true
    }

    let rule = owned(tables.finance_category_rules).find(
      (r) => r.active && r.merchant_id === merchant.id &&
        (r.min_amount_minor ?? null) === (p.p_min_amount_minor ?? null) &&
        (r.max_amount_minor ?? null) === (p.p_max_amount_minor ?? null))
    let ruleCreated = false
    if (!rule) {
      rule = financeRow({
        user_id: TEST_USER_ID, merchant_id: merchant.id, category_id: category.id,
        min_amount_minor: p.p_min_amount_minor ?? null,
        max_amount_minor: p.p_max_amount_minor ?? null,
        min_inclusive: p.p_min_inclusive ?? true, max_inclusive: p.p_max_inclusive ?? true,
        currency: p.p_rule_currency ?? null, active: true,
      })
      tables.finance_category_rules.push(rule)
      ruleCreated = true
    } else {
      rule.category_id = category.id
    }

    const overridden = (id) =>
      owned(tables.finance_transaction_overrides).some((o) => o.transaction_id === id)
    const stamp = (row) => {
      row.merchant_id = merchant.id
      row.category_id = category.id
    }

    const target = owned(tables.finance_transactions).find((t) => t.id === p.p_transaction_id)
    let transactionUpdated = false
    // The booking in hand: not locked, no override — its merchant_id is not a
    // condition here, which is the asymmetry the real function has too.
    if (target && target.manual_lock !== true && !overridden(target.id)) {
      stamp(target)
      transactionUpdated = true
    }

    const requested = p.p_apply_transaction_ids ?? []
    let applied = 0
    for (const id of requested) {
      const row = owned(tables.finance_transactions).find((t) => t.id === id)
      if (!row || row.id === p.p_transaction_id) continue
      if (row.merchant_id) continue
      if (row.manual_lock === true) continue
      if (overridden(row.id)) continue
      if (!matches(row)) continue
      stamp(row)
      applied += 1
    }

    return {
      merchant_id: merchant.id,
      merchant_created: merchantCreated,
      pattern_id: pattern.id,
      pattern_created: patternCreated,
      rule_id: rule.id,
      rule_created: ruleCreated,
      category_id: category.id,
      transaction_id: p.p_transaction_id,
      transaction_updated: transactionUpdated,
      requested_count: requested.length,
      applied_count: applied,
    }
  }

  const backend = {
    fetch: fetchStub, tables, calls, functionCalls, rpcCalls, rateCalls, auth,
    session: auth.session,
  }
  Object.defineProperty(backend, 'failTable', {
    get: () => state.failTable,
    set: (value) => { state.failTable = value },
    enumerable: true,
  })
  return backend
}
