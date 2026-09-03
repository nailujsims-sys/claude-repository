// Der automatische Lauf im 5-Minuten-Takt — gegen dieselbe Sync-Maschine, die
// auch der Knopf in der App startet (supabase/functions/_shared/sync.js), und
// gegen dieselbe In-Memory-Datenbank wie googleSyncLogic.mjs.
//
// Was hier bewiesen wird:
//
//   * alle fünf Minuten läuft genau ein Lauf — nicht keiner und nicht drei,
//     auch wenn Cron und mehrere offene Geräte gleichzeitig anklopfen;
//   * zwei Läufe überschneiden sich nie: das Schloss in `google_connections`
//     lässt nur einen gleichzeitig durch;
//   * ein Schloss überlebt keinen abgestürzten Lauf — es läuft ab;
//   * der manuelle Sync verhält sich unverändert: kein Mindestabstand, kein
//     Aussetzen bei abgelaufener Verbindung;
//   * ein abgelaufenes Token stoppt die Automatik, statt Google im Minutentakt
//     damit zu behelligen — und beschädigt nichts;
//   * ein Nutzer, dessen Lauf scheitert, hält die anderen nicht auf.

import {
  runGuardedSync,
  runAutoSyncForAll,
  autoSyncSkipReason,
  AUTO,
  MANUAL,
  PUSH,
  SKIP_BUSY,
  SKIP_RECENT,
  SKIP_REAUTH,
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_MIN_GAP_MS,
  SYNC_LOCK_MS,
} from '../supabase/functions/_shared/autoSync.js'
import { shouldClientAutoSync } from '../supabase/functions/_shared/autoSyncPolicy.js'
import { refreshCalendars } from '../supabase/functions/_shared/sync.js'
import { makeGoogle, makeStore } from './googleSyncFake.mjs'

let pass = 0
let fail = 0
const ok = (name, cond) => {
  if (cond) pass++
  else {
    fail++
    console.log('  ✗ ' + name)
  }
}
const eq = (name, actual, expected) =>
  ok(`${name} (${JSON.stringify(actual)} === ${JSON.stringify(expected)})`, actual === expected)

const A = '11111111-2222-4333-8444-555555555555'
const B = '99999999-8888-4777-8666-555555555555'
const TZ = 'Europe/Berlin'
const T0 = Date.parse('2026-09-02T12:00:00Z')

// Eine verbundene Ablage mit einem Kalender und einer beweglichen Uhr.
async function connected({ userId = A, store = makeStore(), clock } = {}) {
  const google = makeGoogle({ now: () => clock.now })
  google.addCalendar({ id: `${userId}@gmail.com`, summary: 'Privat', primary: true, accessRole: 'owner' })
  store.db.connections.set(userId, { user_id: userId, status: 'connected' })
  store.db.credentials.set(userId, { user_id: userId, refresh_token: 'refresh-1' })
  const deps = { google: google.client(), store, now: () => clock.now, randomId: () => crypto.randomUUID() }
  await refreshCalendars(deps, { userId, firstConnection: true })
  return { google, store, deps, userId }
}

const makeClock = (start = T0) => ({
  now: start,
  advance(ms) {
    this.now += ms
    return this.now
  },
})

const run = (deps, userId, over = {}) =>
  runGuardedSync(deps, { userId, userTimeZone: TZ, ...over })

// ── 1. Die Regeln allein ────────────────────────────────────────────────────
{
  const now = T0
  eq('ohne Verbindung keine Aussage', autoSyncSkipReason(null, now), null)
  eq(
    'eine nie synchronisierte Verbindung darf laufen',
    autoSyncSkipReason({ status: 'connected' }, now),
    null
  )
  eq(
    'ein Lauf vor einer Minute reicht',
    autoSyncSkipReason({ status: 'connected', last_sync_at: new Date(now - 60_000).toISOString() }, now),
    SKIP_RECENT
  )
  eq(
    'nach dem Takt darf wieder gelaufen werden',
    autoSyncSkipReason(
      { status: 'connected', last_sync_at: new Date(now - AUTO_SYNC_INTERVAL_MS).toISOString() },
      now
    ),
    null
  )
  eq(
    'eine abgelaufene Verbindung läuft nicht automatisch',
    autoSyncSkipReason({ status: 'needs_reauth' }, now),
    SKIP_REAUTH
  )
  ok('der Mindestabstand ist kürzer als der Takt', AUTO_SYNC_MIN_GAP_MS < AUTO_SYNC_INTERVAL_MS)
  eq('der Takt sind fünf Minuten', AUTO_SYNC_INTERVAL_MS, 5 * 60 * 1000)
}

// ── 2. Dieselben Regeln in der App ──────────────────────────────────────────
{
  const connection = { status: 'connected' }
  ok(
    'ein sichtbarer, verbundener Tab synchronisiert',
    shouldClientAutoSync({ connection, visible: true, busy: false, lastAttemptAt: 0 }, T0)
  )
  ok(
    'ohne Verbindung passiert nichts',
    !shouldClientAutoSync({ connection: null, visible: true }, T0)
  )
  ok(
    'ein Tab im Hintergrund hält still',
    !shouldClientAutoSync({ connection, visible: false }, T0)
  )
  ok(
    'während einer Nutzeraktion hält der Automatismus still',
    !shouldClientAutoSync({ connection, visible: true, busy: 'sync' }, T0)
  )
  ok(
    'ein abgelaufener Zugang wird nicht automatisch nachgefasst',
    !shouldClientAutoSync({ connection: { status: 'needs_reauth' }, visible: true }, T0)
  )
  ok(
    'derselbe Tab versucht es nicht sofort noch einmal',
    !shouldClientAutoSync({ connection, visible: true, lastAttemptAt: T0 - 30_000 }, T0)
  )
  ok(
    'nach dem Takt versucht er es wieder',
    shouldClientAutoSync({ connection, visible: true, lastAttemptAt: T0 - AUTO_SYNC_INTERVAL_MS }, T0)
  )
}

// ── 3. Der Takt: alle fünf Minuten genau ein Lauf ───────────────────────────
{
  const clock = makeClock()
  const { store, deps, google } = await connected({ clock })
  google.addEvent(`${A}@gmail.com`, {
    summary: 'Zahnarzt',
    start: { dateTime: '2026-09-03T10:00:00+02:00' },
    end: { dateTime: '2026-09-03T11:00:00+02:00' },
  })

  const outcomes = []
  for (let minute = 0; minute <= 30; minute += 5) {
    outcomes.push(await run(deps, A, { trigger: AUTO }))
    clock.advance(5 * 60 * 1000)
  }
  eq('jeder der sieben Takte hat gelaufen', outcomes.filter((o) => o.result).length, 7)
  eq('keiner wurde ausgelassen', outcomes.filter((o) => o.skipped).length, 0)
  eq('der Termin ist genau einmal da', store.db.events.length, 1)
  eq(
    'die Verbindung führt den letzten Lauf',
    store.db.connections.get(A).last_sync_status,
    'ok'
  )
}

// ── 4. Zu früh ist zu früh — auch bei drei offenen Geräten ──────────────────
{
  const clock = makeClock()
  const { deps } = await connected({ clock })

  const first = await run(deps, A, { trigger: AUTO })
  ok('der erste Lauf im Takt läuft', !!first.result)

  clock.advance(30_000)
  const second = await run(deps, A, { trigger: AUTO })
  const third = await run(deps, A, { trigger: AUTO })
  eq('ein zweiter Aufruf 30 Sekunden später läuft nicht', second.skipped, SKIP_RECENT)
  eq('ein dritter genauso wenig', third.skipped, SKIP_RECENT)

  clock.advance(AUTO_SYNC_INTERVAL_MS)
  ok('nach dem Takt läuft wieder einer', !!(await run(deps, A, { trigger: AUTO })).result)
}

// ── 5. Zwei Läufe überschneiden sich nicht ──────────────────────────────────
{
  const clock = makeClock()
  const { store, deps } = await connected({ clock })

  // Ein Lauf, der hängt: solange er hängt, darf kein zweiter beginnen.
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const slowStore = {
    ...store,
    async listTombstones(userId) {
      await blocked
      return store.listTombstones(userId)
    },
  }

  const running = runGuardedSync({ ...deps, store: slowStore }, { userId: A, trigger: AUTO, userTimeZone: TZ })
  await Promise.resolve()

  const parallelAuto = await run(deps, A, { trigger: AUTO })
  const parallelManual = await run(deps, A, { trigger: MANUAL })
  const parallelPush = await run(deps, A, { trigger: PUSH })
  eq('ein zweiter automatischer Lauf tritt beiseite', parallelAuto.skipped, SKIP_BUSY)
  eq('auch ein manueller wartet', parallelManual.skipped, SKIP_BUSY)
  eq('auch eine Push-Benachrichtigung wartet', parallelPush.skipped, SKIP_BUSY)

  release()
  ok('der erste Lauf kommt zu Ende', !!(await running).result)
  eq('und gibt das Schloss frei', store.db.connections.get(A).sync_lock_until, null)

  clock.advance(AUTO_SYNC_INTERVAL_MS)
  ok('danach läuft wieder einer', !!(await run(deps, A, { trigger: AUTO })).result)
}

// ── 6. Ein Schloss ist kein Riegel: es läuft ab ─────────────────────────────
{
  const clock = makeClock()
  const { store, deps } = await connected({ clock })
  // Ein Lauf, der mitten drin abgeräumt wurde: das Schloss steht noch.
  store.db.connections.set(A, {
    ...store.db.connections.get(A),
    sync_lock_until: new Date(clock.now + SYNC_LOCK_MS).toISOString(),
  })
  eq('solange es gilt, wird gewartet', (await run(deps, A, { trigger: AUTO })).skipped, SKIP_BUSY)

  clock.advance(SYNC_LOCK_MS + 1000)
  ok('danach ist die Bahn frei', !!(await run(deps, A, { trigger: AUTO })).result)
}

// ── 7. Der manuelle Sync bleibt, wie er war ─────────────────────────────────
{
  const clock = makeClock()
  const { store, deps } = await connected({ clock })
  ok('der Knopf löst einen Lauf aus', !!(await run(deps, A, { trigger: MANUAL })).result)

  clock.advance(10_000)
  ok(
    'und zehn Sekunden später noch einen — kein Mindestabstand für den Nutzer',
    !!(await run(deps, A, { trigger: MANUAL })).result
  )

  store.db.connections.set(A, { ...store.db.connections.get(A), status: 'needs_reauth' })
  clock.advance(AUTO_SYNC_INTERVAL_MS)
  eq(
    'die Automatik hält bei abgelaufener Verbindung still',
    (await run(deps, A, { trigger: AUTO })).skipped,
    SKIP_REAUTH
  )
  ok(
    'der Knopf versucht es trotzdem',
    !!(await run(deps, A, { trigger: MANUAL })).result
  )
}

// ── 8. Ein Fehler beschädigt nichts und blockiert nichts ────────────────────
{
  const clock = makeClock()
  const { store, deps, google } = await connected({ clock })
  google.addEvent(`${A}@gmail.com`, {
    summary: 'Bleibt',
    start: { dateTime: '2026-09-03T10:00:00+02:00' },
    end: { dateTime: '2026-09-03T11:00:00+02:00' },
  })
  await run(deps, A, { trigger: AUTO })
  eq('ein Termin ist da', store.db.events.length, 1)

  // Google antwortet nicht mehr — der Lauf wirft.
  clock.advance(AUTO_SYNC_INTERVAL_MS)
  const brokenStore = {
    ...store,
    async listPendingEvents() {
      throw new Error('Datenbank kurz weg')
    },
  }
  let threw = false
  try {
    await runGuardedSync({ ...deps, store: brokenStore }, { userId: A, trigger: AUTO, userTimeZone: TZ })
  } catch {
    threw = true
  }
  ok('der Fehler wird nicht verschluckt', threw)
  eq('das Schloss ist trotzdem frei', store.db.connections.get(A).sync_lock_until, null)
  eq('der Termin ist unversehrt', store.db.events.length, 1)

  clock.advance(AUTO_SYNC_INTERVAL_MS)
  ok('der nächste Takt läuft wieder', !!(await run(deps, A, { trigger: AUTO })).result)
}

// ── 9. Abgelaufenes Token: der Lauf endet sauber in 'needs_reauth' ──────────
{
  const clock = makeClock()
  const { store, deps, google } = await connected({ clock })
  google.revoked = true
  google.accessToken = 'abgelaufen'
  const outcome = await run(deps, A, { trigger: AUTO })
  eq('der Lauf endet, statt zu explodieren', outcome.result.status, 'needs_reauth')
  eq('die Verbindung sagt es', store.db.connections.get(A).status, 'needs_reauth')
  eq('und das Schloss ist frei', store.db.connections.get(A).sync_lock_until, null)

  clock.advance(AUTO_SYNC_INTERVAL_MS)
  eq(
    'danach klopft die Automatik nicht weiter bei Google an',
    (await run(deps, A, { trigger: AUTO })).skipped,
    SKIP_REAUTH
  )
}

// ── 10. Der Zeitplan über alle Konten ───────────────────────────────────────
{
  const clock = makeClock()
  const store = makeStore()
  const a = await connected({ userId: A, store, clock })
  const b = await connected({ userId: B, store, clock })
  a.google.addEvent(`${A}@gmail.com`, {
    summary: 'A',
    start: { dateTime: '2026-09-03T10:00:00+02:00' },
    end: { dateTime: '2026-09-03T11:00:00+02:00' },
  })
  b.google.addEvent(`${B}@gmail.com`, {
    summary: 'B',
    start: { dateTime: '2026-09-03T10:00:00+02:00' },
    end: { dateTime: '2026-09-03T11:00:00+02:00' },
  })

  const clients = { [A]: a.deps.google, [B]: b.deps.google }
  const tick = () =>
    runAutoSyncForAll({
      store,
      now: () => clock.now,
      randomId: () => crypto.randomUUID(),
      clientFor: async (userId) => clients[userId] ?? null,
      contextFor: async () => ({ userTimeZone: TZ }),
    })

  const first = await tick()
  eq('beide Konten werden angesehen', first.checked, 2)
  eq('beide laufen', first.runs.filter((r) => r.result).length, 2)
  eq('jedes Konto bekommt seinen Termin', store.db.events.length, 2)
  ok(
    'und keiner den des anderen',
    store.db.events.every((e) => (e.title === 'A' ? e.user_id === A : e.user_id === B))
  )

  const tooSoon = await tick()
  eq('ein Zeitplan-Lauf eine Sekunde später tut nichts', tooSoon.runs.filter((r) => r.result).length, 0)

  // Ein Konto ohne Zugangsdaten hält den Zeitplan nicht auf.
  clock.advance(AUTO_SYNC_INTERVAL_MS)
  delete clients[A]
  const partial = await tick()
  eq('das Konto ohne Zugang wird übersprungen', partial.runs.find((r) => r.userId === A).skipped, 'no-credentials')
  ok('das andere läuft trotzdem', !!partial.runs.find((r) => r.userId === B).result)

  // Ein Konto, dessen Lauf wirft, ebenso wenig.
  clock.advance(AUTO_SYNC_INTERVAL_MS)
  clients[A] = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('Google antwortet nicht')
      },
    }
  )
  const errors = []
  const withFailure = await runAutoSyncForAll({
    store,
    now: () => clock.now,
    randomId: () => crypto.randomUUID(),
    clientFor: async (userId) => clients[userId] ?? null,
    contextFor: async () => ({ userTimeZone: TZ }),
    onError: async (userId, error) => errors.push([userId, error.message]),
  })
  ok('der Fehler wird gemeldet', errors.length === 1 && errors[0][0] === A)
  ok('und das andere Konto läuft', !!withFailure.runs.find((r) => r.userId === B).result)
  eq('das Schloss des gescheiterten Kontos ist frei', store.db.connections.get(A).sync_lock_until, null)

  // Eine abgelaufene Verbindung wird gar nicht erst geladen.
  store.db.connections.set(B, { ...store.db.connections.get(B), status: 'needs_reauth' })
  clock.advance(AUTO_SYNC_INTERVAL_MS)
  const skipped = await tick()
  ok(
    'ein abgelaufenes Konto steht nicht mehr auf der Liste',
    !skipped.runs.some((r) => r.userId === B)
  )
}

console.log(`googleAutoSyncLogic: ${pass} ok, ${fail} fehlgeschlagen`)
if (fail) process.exit(1)
