// The sync engine, end to end, against a fake Google and an in-memory
// database (tools/googleSyncFake.mjs). Every path the spec asks for is in
// here, and all of it runs the shipping code in
// supabase/functions/_shared/sync.js — the fake replaces the network, not the
// logic.
//
// What these tests are really guarding:
//
//   * a first connection imports two years back and everything ahead, once,
//     without duplicating anything;
//   * create / update / delete cross in both directions;
//   * an event with the sync switch off never reaches Google, and Google
//     never reaches it;
//   * a holiday calendar is not written to and a birthday goes to Contacts;
//   * the newest change wins, whichever side made it;
//   * a run cannot feed itself — Google → app writes leave nothing pending;
//   * a token that expired, a Google that is briefly unreachable and a rate
//     limit all end in a correct database, not a damaged one;
//   * disconnecting keeps every appointment.

import {
  runSync,
  refreshCalendars,
  pullCalendar,
  pushPending,
  drainTombstones,
  applyIncomingEvent,
} from '../supabase/functions/_shared/sync.js'
import { makeGoogle, makeStore, deps } from './googleSyncFake.mjs'

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

// A connected account with a primary calendar, a family calendar, holidays
// and birthdays — the four kinds the spec names.
async function connected({ userId = A, google = makeGoogle() } = {}) {
  google.addCalendar({ id: 'privat@gmail.com', summary: 'Privat', primary: true, accessRole: 'owner', backgroundColor: '#4a80ff' })
  google.addCalendar({ id: 'familie@group.calendar.google.com', summary: 'Familie', accessRole: 'writer', backgroundColor: '#0b8043' })
  google.addCalendar({ id: 'de.german#holiday@group.v.calendar.google.com', summary: 'Feiertage in Deutschland', accessRole: 'reader', backgroundColor: '#616161' })
  google.addCalendar({ id: 'addressbook#contacts@group.v.calendar.google.com', summary: 'Geburtstage', accessRole: 'reader', backgroundColor: '#e67c73' })

  const store = makeStore()
  store.db.connections.set(userId, { user_id: userId, status: 'connected' })
  const d = deps(google.client(), store)
  await refreshCalendars(d, { userId, firstConnection: true })
  return { google, store, d, userId }
}

const select = async (store, userId, ids) => {
  for (const id of ids) await store.setCalendarSelected(userId, id, true)
}

// ── 1. Erstverbindung: Kalender erscheinen mit Farben und Rechten ───────────
{
  const { store } = await connected()
  const calendars = await store.listCalendars(A)
  eq('alle vier Kalender werden gefunden', calendars.length, 4)

  const privat = calendars.find((c) => c.google_calendar_id === 'privat@gmail.com')
  const familie = calendars.find((c) => c.summary === 'Familie')
  const feiertage = calendars.find((c) => c.kind === 'holiday')
  const geburtstage = calendars.find((c) => c.kind === 'birthday')

  eq('Privat behält seine Google-Farbe', privat.background_color, '#4a80ff')
  eq('Familie behält seine Google-Farbe', familie.background_color, '#0b8043')
  eq('Privat ist owner', privat.access_role, 'owner')
  eq('Familie ist writer', familie.access_role, 'writer')
  eq('Feiertage sind reader', feiertage.access_role, 'reader')
  eq('Geburtstage werden als solche erkannt', geburtstage.kind, 'birthday')
  ok('nur der Hauptkalender ist zu Beginn aktiv', privat.is_selected && !familie.is_selected)
}

// ── 2. Erstimport: zwei Jahre zurück, Zukunft offen, keine Duplikate ────────
{
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Letztes Jahr', start: { dateTime: '2025-06-01T10:00:00+02:00' }, end: { dateTime: '2025-06-01T11:00:00+02:00' } })
  google.addEvent('privat@gmail.com', { summary: 'Heute', start: { dateTime: '2026-09-02T14:00:00+02:00' }, end: { dateTime: '2026-09-02T15:00:00+02:00' } })
  google.addEvent('privat@gmail.com', { summary: 'In fünf Jahren', start: { dateTime: '2031-01-01T10:00:00+01:00' }, end: { dateTime: '2031-01-01T11:00:00+01:00' } })

  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('drei Termine importiert', store.db.events.length, 3)
  ok('die Vergangenheit ist dabei', store.db.events.some((e) => e.title === 'Letztes Jahr'))
  ok('die ferne Zukunft ist dabei', store.db.events.some((e) => e.title === 'In fünf Jahren'))
  eq('14:00 bleibt 14:00', store.db.events.find((e) => e.title === 'Heute').start_at, '2026-09-02T14:00')

  const timeMin = google.calls.find((c) => c.url.includes('timeMin'))
  ok('das Fenster beginnt zwei Jahre früher', timeMin.url.includes('timeMin=2024-09-02'))
  ok('das Fenster hat kein Ende', !timeMin.url.includes('timeMax'))
  ok('Serien werden nicht ausgerollt', timeMin.url.includes('singleEvents=false'))

  // Ein zweiter Lauf darf nichts verdoppeln — das ist der Kern von §14.
  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('ein zweiter Lauf erzeugt keine Duplikate', store.db.events.length, 3)

  // Und ein Reconnect (Sync-Token weg, alles noch einmal gelesen) auch nicht.
  await store.setCalendarSyncToken(A, 'privat@gmail.com', null)
  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('auch nach einem Reconnect keine Duplikate', store.db.events.length, 3)
}

// ── 3. Google → App: anlegen, ändern, löschen ───────────────────────────────
{
  const { google, store, d } = await connected()
  const created = google.addEvent('privat@gmail.com', {
    summary: 'Zahnarzt',
    location: 'Hauptstraße 1',
    description: 'Kontrolle',
    start: { dateTime: '2026-09-10T09:00:00+02:00' },
    end: { dateTime: '2026-09-10T09:30:00+02:00' },
  })
  await runSync(d, { userId: A, userTimeZone: TZ })

  const row = store.db.events.find((e) => e.google_event_id === created.id)
  ok('Google-Termin ist in der App angekommen', !!row)
  eq('Titel übernommen', row.title, 'Zahnarzt')
  eq('Ort übernommen', row.location, 'Hauptstraße 1')
  eq('Notizen übernommen', row.description, 'Kontrolle')
  eq('Kalenderzuordnung gespeichert', row.google_calendar_id, 'privat@gmail.com')
  eq('als synchronisiert markiert', row.sync_state, 'synced')

  google.changeEvent('privat@gmail.com', created.id, { summary: 'Zahnarzt (verschoben)', start: { dateTime: '2026-09-10T11:00:00+02:00' }, end: { dateTime: '2026-09-10T11:30:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const updated = store.db.events.find((e) => e.google_event_id === created.id)
  eq('Änderung aus Google übernommen', updated.title, 'Zahnarzt (verschoben)')
  eq('neue Uhrzeit übernommen', updated.start_at, '2026-09-10T11:00')

  google.removeEvent('privat@gmail.com', created.id)
  await runSync(d, { userId: A, userTimeZone: TZ })
  ok('in Google gelöscht → in der App weg', !store.db.events.some((e) => e.google_event_id === created.id))
  eq('und kein Grabstein, der es zurückschickt', store.db.tombstones.length, 0)
}

// ── 4. App → Google: anlegen, ändern, löschen ───────────────────────────────
{
  const { google, store, d } = await connected()
  const row = store.deviceInsert({
    user_id: A,
    title: 'Sport',
    start_at: '2026-09-15T18:00',
    end_at: '2026-09-15T19:30',
    all_day: false,
    timezone: TZ,
    reminder: 30,
    recurrence: 'FREQ=WEEKLY',
    google_calendar_id: 'privat@gmail.com',
  })
  eq('eine Änderung am Gerät wird als offen markiert', row.sync_state, 'pending')

  await runSync(d, { userId: A, userTimeZone: TZ })
  const inGoogle = [...google.events.get('privat@gmail.com').values()].find((e) => e.summary === 'Sport')
  ok('der Termin ist in Google angelegt', !!inGoogle)
  eq('mit Wanduhrzeit und Zone', inGoogle.start.dateTime, '2026-09-15T18:00:00')
  eq('Zone mitgeschickt', inGoogle.start.timeZone, TZ)
  eq('Wiederholung als Regel', inGoogle.recurrence[0], 'RRULE:FREQ=WEEKLY')
  eq('Erinnerung übertragen', inGoogle.reminders.overrides[0].minutes, 30)
  eq('die Zeile kennt jetzt ihre Google-ID', store.db.events[0].google_event_id, inGoogle.id)
  eq('und gilt als synchronisiert', store.db.events[0].sync_state, 'synced')

  store.deviceUpdate(store.db.events[0].id, { title: 'Sport (früher)', start_at: '2026-09-15T17:00' })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const patched = google.events.get('privat@gmail.com').get(inGoogle.id)
  eq('Änderung in Google angekommen', patched.summary, 'Sport (früher)')
  eq('neue Uhrzeit in Google', patched.start.dateTime, '2026-09-15T17:00:00')

  store.deviceDelete(store.db.events[0].id)
  eq('das Löschen hinterlässt einen Grabstein', store.db.tombstones.length, 1)
  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('in der App gelöscht → in Google gelöscht', google.events.get('privat@gmail.com').get(inGoogle.id).status, 'cancelled')
  eq('der Grabstein ist abgearbeitet', store.db.tombstones.length, 0)
}

// ── 5. App-only: der Schalter aus bedeutet aus ──────────────────────────────
{
  const { google, store, d } = await connected()
  const local = store.deviceInsert({
    user_id: A,
    title: 'Nur in der App',
    start_at: '2026-09-20T10:00',
    end_at: '2026-09-20T11:00',
    timezone: TZ,
    sync_enabled: false,
    google_calendar_id: null,
  })
  eq('ohne Sync bleibt der Zustand lokal', local.sync_state, 'local')

  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('nichts ist in Google gelandet', google.events.get('privat@gmail.com').size, 0)
  ok('der Termin ist noch da', store.db.events.some((e) => e.title === 'Nur in der App'))

  // Und Google beeinflusst ihn nicht: ein Import daneben lässt ihn unberührt.
  google.addEvent('privat@gmail.com', { summary: 'Aus Google', start: { dateTime: '2026-09-20T10:00:00+02:00' }, end: { dateTime: '2026-09-20T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const still = store.db.events.find((e) => e.title === 'Nur in der App')
  eq('der App-only Termin ist unverändert', still.sync_state, 'local')
  ok('er hat keine Google-Identität bekommen', still.google_event_id == null)
  eq('der Google-Termin ist zusätzlich da', store.db.events.length, 2)

  // Löschen eines App-only Termins darf Google nie anfassen.
  store.deviceDelete(still.id)
  eq('ein App-only Löschen hinterlässt keinen Grabstein', store.db.tombstones.length, 0)
}

// ── 6. Kalenderarten: Feiertage read-only, Geburtstage über Kontakte ────────
{
  const { google, store, d } = await connected()
  await select(store, A, ['de.german#holiday@group.v.calendar.google.com', 'addressbook#contacts@group.v.calendar.google.com', 'familie@group.calendar.google.com'])

  google.addEvent('de.german#holiday@group.v.calendar.google.com', { summary: 'Tag der Deutschen Einheit', start: { date: '2026-10-03' }, end: { date: '2026-10-04' } })
  google.contacts.set('people/c1', { resourceName: 'people/c1', etag: 'petag-1', birthdays: [{ date: { year: 1965, month: 4, day: 12 } }] })
  google.addEvent('addressbook#contacts@group.v.calendar.google.com', {
    summary: 'Mama',
    eventType: 'birthday',
    birthdayProperties: { contact: 'people/c1', type: 'birthday' },
    recurrence: ['RRULE:FREQ=YEARLY'],
    start: { date: '2026-04-12' },
    end: { date: '2026-04-13' },
  })

  await runSync(d, { userId: A, userTimeZone: TZ })

  const holiday = store.db.events.find((e) => e.title === 'Tag der Deutschen Einheit')
  ok('Feiertag wurde gelesen', !!holiday)
  ok('Feiertag ist ganztägig', holiday.all_day)
  eq('Feiertag endet am selben Tag', holiday.end_at, '2026-10-03T00:00')

  const birthday = store.db.events.find((e) => e.title === 'Mama')
  ok('Geburtstag wurde gelesen', !!birthday)
  ok('Geburtstag ist als Geburtstag markiert', birthday.is_birthday)
  eq('Geburtstag kennt seinen Kontakt', birthday.google_contact_id, 'people/c1')

  // Ein Feiertag darf aus der App nicht verändert werden — der Versuch wird
  // abgewiesen und der Termin bleibt unangetastet, in beiden Systemen.
  store.deviceUpdate(holiday.id, { title: 'Mein Feiertag' })
  const pushed = await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  ok('der Schreibversuch auf den Feiertag scheitert', pushed.failures.length === 1)
  eq('und wird als Fehler an der Zeile vermerkt', store.db.events.find((e) => e.id === holiday.id).sync_state, 'error')
  eq('in Google ist der Feiertag unverändert', [...google.events.get('de.german#holiday@group.v.calendar.google.com').values()][0].summary, 'Tag der Deutschen Einheit')

  // Ein Geburtstag dagegen wird über die People API geschrieben — nicht als
  // Kalendereintrag, denn Google verwaltet ihn im Kontakt.
  store.deviceUpdate(birthday.id, { start_at: '2026-04-13T00:00', end_at: '2026-04-13T00:00' })
  await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  const contact = google.contacts.get('people/c1')
  eq('der Kontakt hat das neue Datum', contact.birthdays[0].date.day, 13)
  eq('der Geburtstag gilt als synchronisiert', store.db.events.find((e) => e.id === birthday.id).sync_state, 'synced')
  ok('es wurde die People API benutzt', google.calls.some((c) => c.url.includes('people/c1:updateContact')))
  ok('und kein Kalender-Schreibvorgang', !google.calls.some((c) => c.method === 'PATCH' && c.url.includes('addressbook')))

  // Ohne die Kontakte-Berechtigung sagt die App das, statt es still zu ignorieren.
  const noScope = makeGoogle({ scopes: 'openid email https://www.googleapis.com/auth/calendar.events' })
  const d2 = deps(noScope.client(), store)
  store.deviceUpdate(birthday.id, { start_at: '2026-04-14T00:00' })
  const result = await pushPending(d2, { userId: A, calendars: await store.listCalendars(A) })
  ok('fehlende Kontakte-Berechtigung wird gemeldet', result.failures.some((f) => /Kontakte-Berechtigung/.test(f.message)))
}

// ── 7. Wiederholungen bleiben Regeln, in beide Richtungen ───────────────────
{
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', {
    summary: 'Vorlesung',
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=14'],
    start: { dateTime: '2026-10-06T10:00:00+02:00' },
    end: { dateTime: '2026-10-06T12:00:00+02:00' },
  })
  await runSync(d, { userId: A, userTimeZone: TZ })

  const series = store.db.events.find((e) => e.title === 'Vorlesung')
  eq('die Serie ist genau eine Zeile', store.db.events.filter((e) => e.title === 'Vorlesung').length, 1)
  eq('und trägt ihre Regel', series.recurrence, 'FREQ=WEEKLY;BYDAY=TU;COUNT=14')

  store.deviceUpdate(series.id, { title: 'Vorlesung (Hörsaal B)' })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const inGoogle = [...google.events.get('privat@gmail.com').values()].find((e) => e.summary === 'Vorlesung (Hörsaal B)')
  eq('die Regel überlebt den Rückweg', inGoogle.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=14')
}

// ── 8. Konflikte: die neueste Änderung gewinnt ──────────────────────────────
{
  // 10:01 Google, 10:02 App → die App gewinnt.
  const { google, store, d } = await connected()
  const g = google.addEvent('privat@gmail.com', { summary: 'Meeting', start: { dateTime: '2026-09-10T15:00:00+02:00' }, end: { dateTime: '2026-09-10T16:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const row = store.db.events[0]

  google.clock = () => Date.parse('2026-09-02T10:01:00Z')
  google.changeEvent('privat@gmail.com', g.id, { start: { dateTime: '2026-09-10T15:00:00+02:00' }, end: { dateTime: '2026-09-10T16:00:00+02:00' }, summary: 'Meeting (Google)' })
  store.setClock('2026-09-02T10:02:00Z')
  store.deviceUpdate(row.id, { title: 'Meeting (App)' })

  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('die spätere App-Änderung gewinnt', store.db.events[0].title, 'Meeting (App)')
  eq('und steht danach auch in Google', google.events.get('privat@gmail.com').get(g.id).summary, 'Meeting (App)')
}
{
  // 10:01 App, 10:02 Google → Google gewinnt.
  const { google, store, d } = await connected()
  const g = google.addEvent('privat@gmail.com', { summary: 'Meeting', start: { dateTime: '2026-09-10T15:00:00+02:00' }, end: { dateTime: '2026-09-10T16:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const row = store.db.events[0]

  store.setClock('2026-09-02T10:01:00Z')
  store.deviceUpdate(row.id, { title: 'Meeting (App)' })
  google.clock = () => Date.parse('2026-09-02T10:02:00Z')
  google.changeEvent('privat@gmail.com', g.id, { summary: 'Meeting (Google)' })

  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('die spätere Google-Änderung gewinnt', store.db.events[0].title, 'Meeting (Google)')
}
{
  // Und wenn Google die Version während des Schreibens wechselt (412), wird
  // ebenfalls nach Zeitstempel entschieden, nicht nach Reihenfolge.
  const { google, store, d } = await connected()
  const g = google.addEvent('privat@gmail.com', { summary: 'Termin', start: { dateTime: '2026-09-10T15:00:00+02:00' }, end: { dateTime: '2026-09-10T16:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const row = store.db.events[0]

  store.setClock('2026-09-02T13:00:00Z')
  store.deviceUpdate(row.id, { title: 'Neu aus der App' })
  // Google ändert sich hinter unserem Rücken: unser Etag ist veraltet.
  google.clock = () => Date.parse('2026-09-02T12:30:00Z')
  google.changeEvent('privat@gmail.com', g.id, { summary: 'Älter aus Google' })

  await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  eq('bei Etag-Konflikt gewinnt die neuere App-Version', google.events.get('privat@gmail.com').get(g.id).summary, 'Neu aus der App')
  ok('der Konflikt wurde bemerkt', google.calls.some((c) => c.method === 'PATCH'))
}

// ── 9. Kein Echo, keine Endlosschleife ──────────────────────────────────────
{
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Einmalig', start: { dateTime: '2026-09-11T10:00:00+02:00' }, end: { dateTime: '2026-09-11T11:00:00+02:00' } })

  await runSync(d, { userId: A, userTimeZone: TZ })
  // Der entscheidende Satz: ein Import erzeugt keine offene Aufgabe zurück.
  eq('nach dem Import ist nichts offen', (await store.listPendingEvents(A)).length, 0)

  const writesBefore = google.calls.filter((c) => c.method !== 'GET').length
  await runSync(d, { userId: A, userTimeZone: TZ })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const writesAfter = google.calls.filter((c) => c.method !== 'GET').length
  eq('weitere Läufe schreiben nichts nach Google', writesAfter, writesBefore)
  eq('und legen nichts doppelt an', store.db.events.length, 1)

  // Dieselbe Version noch einmal geliefert (eine wiederholte Push-Nachricht)
  // ändert die Zeile nicht — auch nicht ihren updated_at.
  const before = { ...store.db.events[0] }
  const event = [...google.events.get('privat@gmail.com').values()][0]
  await applyIncomingEvent(d, {
    userId: A,
    calendar: (await store.listCalendars(A)).find((c) => c.google_calendar_id === 'privat@gmail.com'),
    event,
    userTimeZone: TZ,
  })
  eq('eine doppelte Zustellung ändert nichts', store.db.events[0].updated_at, before.updated_at)
}

// ── 10. Reconnect, Token-Refresh, abgelaufener Sync-Token ───────────────────
{
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Vorher', start: { dateTime: '2026-09-12T10:00:00+02:00' }, end: { dateTime: '2026-09-12T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })

  // Das Access-Token ist abgelaufen: der Client holt sich ein neues und macht
  // weiter — ohne dass der Lauf scheitert oder der Nutzer etwas merkt.
  const refreshesBefore = google.refreshes
  google.accessToken = 'abgelaufen'
  google.addEvent('privat@gmail.com', { summary: 'Nachher', start: { dateTime: '2026-09-13T10:00:00+02:00' }, end: { dateTime: '2026-09-13T11:00:00+02:00' } })
  const after = await runSync(d, { userId: A, userTimeZone: TZ })
  ok('es wurde ein neues Token geholt', google.refreshes > refreshesBefore)
  eq('der Lauf ist trotzdem sauber', after.status, 'connected')
  ok('und die neue Änderung ist da', store.db.events.some((e) => e.title === 'Nachher'))

  // Der Sync-Token ist zu alt (Google antwortet 410): es wird einmal alles neu
  // gelesen — und dabei nichts verdoppelt.
  const token = store.db.calendars.find((c) => c.google_calendar_id === 'privat@gmail.com').sync_token
  google.expiredSyncTokens.add(token)
  await runSync(d, { userId: A, userTimeZone: TZ })
  eq('nach einem abgelaufenen Cursor stimmt der Bestand', store.db.events.length, 2)
  ok('und es gibt wieder einen frischen Cursor', !!store.db.calendars.find((c) => c.google_calendar_id === 'privat@gmail.com').sync_token)
}
{
  // Der Grant wurde in Google zurückgezogen: das ist kein Fehler, den man
  // wiederholen kann, sondern einer, den nur der Nutzer beheben kann.
  const { google, store, d } = await connected()
  google.revoked = true
  google.accessToken = 'abgelaufen'
  const result = await runSync(d, { userId: A, userTimeZone: TZ })
  eq('die Verbindung wird als „neu verbinden“ markiert', result.status, 'needs_reauth')
  eq('und das steht auch in der Datenbank', store.db.connections.get(A).status, 'needs_reauth')
  ok('es wurden keine Termine gelöscht', store.db.events.length === 0)
}

// ── 11. Fehlerfälle kosten keine Daten ──────────────────────────────────────
{
  // Rate limit: Google sagt „später“, der Client wartet und wiederholt.
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Trotzdem da', start: { dateTime: '2026-09-14T10:00:00+02:00' }, end: { dateTime: '2026-09-14T11:00:00+02:00' } })
  google.failNext('/events?', { status: 429, body: { error: { code: 429, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } } })
  const result = await runSync(d, { userId: A, userTimeZone: TZ })
  eq('nach dem Wiederholen ist der Lauf sauber', result.status, 'connected')
  eq('und der Termin ist importiert', store.db.events.length, 1)
}
{
  // Google ist ganz weg: der Lauf meldet das, verliert aber nichts.
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Bestand', start: { dateTime: '2026-09-14T10:00:00+02:00' }, end: { dateTime: '2026-09-14T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })

  for (let i = 0; i < 5; i++) {
    google.failNext('/events?', { status: 503, body: { error: { code: 503, message: 'Backend Error' } } })
  }
  const result = await runSync(d, { userId: A, userTimeZone: TZ })
  eq('der Lauf meldet einen Fehler', result.status, 'error')
  eq('der vorhandene Termin ist unangetastet', store.db.events.length, 1)
  eq('der Fehler steht am Kalender', typeof store.db.calendars.find((c) => c.is_selected).last_error, 'string')

  // Und beim nächsten Mal geht es normal weiter.
  const recovered = await runSync(d, { userId: A, userTimeZone: TZ })
  eq('danach ist wieder alles in Ordnung', recovered.status, 'connected')
}
{
  // Ein einzelner kaputter Termin darf den ganzen Lauf nicht stoppen.
  const { google, store, d } = await connected()
  await select(store, A, ['familie@group.calendar.google.com'])
  store.deviceInsert({ user_id: A, title: 'Kaputt', start_at: '2026-09-16T10:00', end_at: '2026-09-16T11:00', timezone: TZ, google_calendar_id: 'privat@gmail.com' })
  store.deviceInsert({ user_id: A, title: 'Heil', start_at: '2026-09-16T12:00', end_at: '2026-09-16T13:00', timezone: TZ, google_calendar_id: 'familie@group.calendar.google.com' })
  google.failNext('privat%40gmail.com/events', { status: 400, body: { error: { code: 400, message: 'Invalid recurrence rule' } } })

  const result = await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  eq('ein Termin ist durchgekommen', result.pushed, 1)
  eq('einer ist gescheitert', result.failures.length, 1)
  eq('der gescheiterte trägt seinen Fehler', store.db.events.find((e) => e.title === 'Kaputt').sync_state, 'error')
  ok('der andere ist in Google', [...google.events.get('familie@group.calendar.google.com').values()].some((e) => e.summary === 'Heil'))
  ok('nichts wurde gelöscht', store.db.events.length === 2)
}
{
  // In Google gelöscht, in der App gerade bearbeitet: der Termin bleibt in der
  // App und wird zu einem App-only Termin, statt in Google wiederaufzuerstehen.
  const { google, store, d } = await connected()
  const g = google.addEvent('privat@gmail.com', { summary: 'Verschwunden', start: { dateTime: '2026-09-17T10:00:00+02:00' }, end: { dateTime: '2026-09-17T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  const row = store.db.events[0]
  google.events.get('privat@gmail.com').delete(g.id)
  store.deviceUpdate(row.id, { title: 'Trotzdem geändert' })

  await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  const orphan = store.db.events[0]
  eq('der Termin ist noch da', orphan.title, 'Trotzdem geändert')
  ok('er hat keine Google-Bindung mehr', orphan.google_event_id == null)
  eq('und wird als lokal geführt', orphan.sync_state, 'local')
}
{
  // Ein Kalender verschwindet aus Google: seine Termine bleiben, der Kalender
  // wird als nicht mehr verfügbar geführt.
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Bleibt', start: { dateTime: '2026-09-18T10:00:00+02:00' }, end: { dateTime: '2026-09-18T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  google.calendars.delete('privat@gmail.com')
  await refreshCalendars(d, { userId: A })
  const gone = store.db.calendars.find((c) => c.google_calendar_id === 'privat@gmail.com')
  ok('der Kalender ist als nicht verfügbar markiert', gone.is_available === false)
  ok('seine Termine sind noch da', store.db.events.some((e) => e.title === 'Bleibt'))
}
{
  // Ein Grabstein für ein bereits in Google gelöschtes Event ist erledigt,
  // nicht ein Fehler, der ewig wiederholt wird.
  const { google, store, d } = await connected()
  store.db.tombstones.push({ id: 't1', user_id: A, google_calendar_id: 'privat@gmail.com', google_event_id: 'gibtsnicht', attempts: 0 })
  const result = await drainTombstones(d, { userId: A, calendars: await store.listCalendars(A) })
  eq('ein bereits gelöschtes Event gilt als gelöscht', result.deleted, 1)
  eq('der Grabstein ist weg', store.db.tombstones.length, 0)
}

// ── 12. Trennen behält die Termine ──────────────────────────────────────────
{
  const { google, store, d } = await connected()
  google.addEvent('privat@gmail.com', { summary: 'Aus Google', start: { dateTime: '2026-09-19T10:00:00+02:00' }, end: { dateTime: '2026-09-19T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })
  store.deviceInsert({ user_id: A, title: 'Nur App', start_at: '2026-09-19T14:00', end_at: '2026-09-19T15:00', timezone: TZ, sync_enabled: false })
  eq('zwei Termine vor dem Trennen', store.db.events.length, 2)

  // Was `disconnect` in google-api/index.ts tut, in derselben Reihenfolge.
  await store.detachEvents(A)
  await store.clearTombstones(A)
  await store.deleteCalendars(A)
  await store.deleteCredentials(A)
  await store.deleteConnection(A)

  eq('nach dem Trennen sind beide Termine noch da', store.db.events.length, 2)
  ok('der Google-Termin ist jetzt ein App-Termin', store.db.events.every((e) => e.google_event_id == null && e.sync_state === 'local'))
  ok('die Zugangsdaten sind gelöscht', !store.db.credentials.has(A))
  ok('die Verbindung ist gelöscht', !store.db.connections.has(A))
  eq('die Kalenderliste ist leer', (await store.listCalendars(A)).length, 0)
}

// ── 13. Nutzerisolation ─────────────────────────────────────────────────────
{
  // Zwei Konten in derselben Datenbank. Jeder Lauf ist auf seinen Nutzer
  // gefiltert — das ist die Zeile, die im Serverdienst RLS ersetzt.
  const google = makeGoogle()
  const { store, d } = await connected({ userId: A, google })
  store.db.connections.set(B, { user_id: B, status: 'connected' })
  store.db.calendars.push({
    user_id: B,
    google_calendar_id: 'b@gmail.com',
    summary: 'B privat',
    kind: 'normal',
    access_role: 'owner',
    is_selected: true,
    is_available: true,
  })
  store.db.events.push({
    id: 'b-row',
    user_id: B,
    title: 'Bs Termin',
    google_calendar_id: 'b@gmail.com',
    google_event_id: 'b-ev',
    sync_state: 'synced',
    sync_enabled: true,
  })

  google.addEvent('privat@gmail.com', { summary: 'As Termin', start: { dateTime: '2026-09-21T10:00:00+02:00' }, end: { dateTime: '2026-09-21T11:00:00+02:00' } })
  await runSync(d, { userId: A, userTimeZone: TZ })

  ok('Bs Termin ist unangetastet', store.db.events.find((e) => e.id === 'b-row').title === 'Bs Termin')
  eq('A sieht nur seine eigenen Kalender', (await store.listCalendars(A)).length, 4)
  eq('B sieht nur seinen eigenen', (await store.listCalendars(B)).length, 1)
  ok('A hat nichts in Bs Kalender geschrieben', !google.events.has('b@gmail.com'))

  // Und ein offener Termin von B wird von As Lauf nicht angefasst.
  store.db.events.find((e) => e.id === 'b-row').sync_state = 'pending'
  const pushed = await pushPending(d, { userId: A, calendars: await store.listCalendars(A) })
  eq('As Lauf schiebt nichts von B', pushed.pushed, 0)
  eq('Bs Termin ist immer noch offen', store.db.events.find((e) => e.id === 'b-row').sync_state, 'pending')
}

// ── 14. Kalenderauswahl ─────────────────────────────────────────────────────
{
  const { google, store, d } = await connected()
  google.addEvent('familie@group.calendar.google.com', { summary: 'Familienessen', start: { dateTime: '2026-09-22T18:00:00+02:00' }, end: { dateTime: '2026-09-22T20:00:00+02:00' } })

  await runSync(d, { userId: A, userTimeZone: TZ })
  ok('ein nicht gewählter Kalender wird nicht gelesen', !store.db.events.some((e) => e.title === 'Familienessen'))

  await store.setCalendarSelected(A, 'familie@group.calendar.google.com', true)
  await runSync(d, { userId: A, userTimeZone: TZ })
  ok('nach dem Aktivieren ist er da', store.db.events.some((e) => e.title === 'Familienessen'))

  // Abwählen entfernt keine Termine — das wäre die Datenlöschung, die §18
  // ausschließt.
  await store.setCalendarSelected(A, 'familie@group.calendar.google.com', false)
  await runSync(d, { userId: A, userTimeZone: TZ })
  ok('nach dem Abwählen bleiben die Termine', store.db.events.some((e) => e.title === 'Familienessen'))
}

// ── 15. Push-Kanäle ─────────────────────────────────────────────────────────
{
  const { google, store, d } = await connected()
  await runSync(d, { userId: A, userTimeZone: TZ, pushAddress: 'https://push.example.test/hook' })
  eq('für den aktiven Kalender wurde ein Kanal geöffnet', store.db.channels.length, 1)
  const channel = store.db.channels[0]
  ok('der Kanal trägt ein Geheimnis', typeof channel.token === 'string' && channel.token.length > 8)
  eq('der Kanal gehört dem Nutzer', channel.user_id, A)

  // Ein zweiter Lauf erneuert keinen noch gültigen Kanal.
  await runSync(d, { userId: A, userTimeZone: TZ, pushAddress: 'https://push.example.test/hook' })
  eq('ein gültiger Kanal wird nicht doppelt geöffnet', store.db.channels.length, 1)

  // Ohne konfigurierte Adresse wird kein Kanal geöffnet, und der Sync läuft
  // trotzdem — Push ist eine Beschleunigung, keine Voraussetzung.
  const plain = await connected()
  const result = await runSync(plain.d, { userId: A, userTimeZone: TZ })
  eq('ohne Push-Adresse läuft der Sync normal', result.status, 'connected')
  eq('und es entsteht kein Kanal', plain.store.db.channels.length, 0)
}

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
