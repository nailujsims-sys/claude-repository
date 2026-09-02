// Pure-logic tests for the Google-Kalender integration: the mapping between a
// Google event and an `events` row, the conflict rule, calendar writability
// and the signed OAuth state.
//
// These import the *shipping* modules under supabase/functions/_shared/ —
// there is no test copy of the logic. They are plain ESM with no Deno APIs in
// them precisely so both the Edge Runtime and this file can run the same code;
// the engine that uses them is exercised in tools/googleSyncLogic.mjs.
//
// The promises pinned here are the ones a timezone bug or an off-by-one in
// Google's exclusive all-day end would quietly break, and neither of those
// shows up as a crash — only as an appointment at the wrong hour or on the
// wrong day.

import {
  googleEventToRow,
  rowToGoogleEvent,
  recurrenceFromGoogle,
  recurrenceToGoogle,
  reminderFromGoogle,
  reminderToGoogle,
  differsInSyncedFields,
  externalKey,
} from '../supabase/functions/_shared/mapping.js'
import { resolveIncoming, resolveOutgoing } from '../supabase/functions/_shared/conflict.js'
import {
  calendarKind,
  calendarWritability,
  canCreateEventsIn,
  isWritableRole,
  safeHexColor,
  calendarListEntryToRow,
  defaultSelection,
} from '../supabase/functions/_shared/calendars.js'
import { signState, verifyState, isAllowedRedirect } from '../supabase/functions/_shared/state.js'
import { applyConnectionChange } from '../src/lib/googleCalendar.js'
import {
  wallClockInZone,
  instantFromWallClock,
  isoDateAddDays,
  todayInZone,
} from '../supabase/functions/_shared/time.js'
import { initialWindow, IMPORT_PAST_YEARS } from '../supabase/functions/_shared/sync.js'

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

const USER = '11111111-2222-4333-8444-555555555555'
const privat = {
  google_calendar_id: 'privat@gmail.com',
  kind: 'normal',
  access_role: 'owner',
  default_reminder_minutes: 30,
}

// ── 1. Zeitzonen: ein 14:00-Termin bleibt 14:00 ─────────────────────────────
{
  // Google sends an instant with an offset. Berlin in July is UTC+2, so
  // 12:00Z is 14:00 on the user's clock — and that is what has to be stored.
  const row = googleEventToRow(
    {
      id: 'g1',
      summary: 'Zahnarzt',
      start: { dateTime: '2026-07-01T14:00:00+02:00', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-07-01T15:00:00+02:00', timeZone: 'Europe/Berlin' },
      updated: '2026-06-01T10:00:00.000Z',
      etag: '"a"',
    },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('14:00 bleibt 14:00', row.start_at, '2026-07-01T14:00')
  eq('15:00 bleibt 15:00', row.end_at, '2026-07-01T15:00')

  // Winter: the same wall-clock hour, one hour less of offset. A fixed
  // subtraction would be wrong on exactly one of these two.
  const winter = googleEventToRow(
    {
      id: 'g2',
      summary: 'Zahnarzt',
      start: { dateTime: '2026-01-15T14:00:00+01:00' },
      end: { dateTime: '2026-01-15T15:00:00+01:00' },
    },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('Winterzeit: 14:00 bleibt 14:00', winter.start_at, '2026-01-15T14:00')

  // A calendar in another zone: the instant is the same, the clock is the
  // user's. 09:00 in New York is 15:00 in Berlin, and that is when it happens.
  const foreign = googleEventToRow(
    {
      id: 'g3',
      summary: 'Call',
      start: { dateTime: '2026-07-01T09:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-07-01T10:00:00-04:00', timeZone: 'America/New_York' },
    },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('fremde Zeitzone wird auf die eigene Uhr gerechnet', foreign.start_at, '2026-07-01T15:00')

  // Round trip: what we send back carries the wall-clock plus the zone name,
  // never a precomputed offset — that is what survives a DST change inside a
  // recurring series.
  const body = rowToGoogleEvent({
    title: 'Zahnarzt',
    start_at: '2026-07-01T14:00',
    end_at: '2026-07-01T15:00',
    all_day: false,
    timezone: 'Europe/Berlin',
    recurrence: null,
    reminder: 30,
  })
  eq('Rückweg: Wanduhrzeit', body.start.dateTime, '2026-07-01T14:00:00')
  eq('Rückweg: Zone statt Offset', body.start.timeZone, 'Europe/Berlin')
  ok('Rückweg trägt keinen Offset', !/[+-]\d\d:\d\d$/.test(body.start.dateTime))

  // The DST boundary itself, both directions, through the real tz database.
  eq('DST-Wechsel März', wallClockInZone(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin'), '2026-03-29T01:30')
  eq('DST-Wechsel Oktober', wallClockInZone(new Date('2026-10-25T00:30:00Z'), 'Europe/Berlin'), '2026-10-25T02:30')
  eq(
    'Wanduhr → Instant → Wanduhr',
    wallClockInZone(instantFromWallClock('2026-07-01T14:00', 'Europe/Berlin'), 'Europe/Berlin'),
    '2026-07-01T14:00'
  )
}

// ── 2. Ganztägige Termine: Googles Ende ist exklusiv ────────────────────────
{
  // One day in Google: 2026-07-01 → 2026-07-02 (exclusive). One day in the
  // app: start and end both on 2026-07-01. Getting this wrong makes every
  // all-day event a day too long, every time.
  const oneDay = googleEventToRow(
    { id: 'a1', summary: 'Feiertag', start: { date: '2026-07-01' }, end: { date: '2026-07-02' } },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  ok('ganztägig erkannt', oneDay.all_day === true)
  eq('ganztägig: Start', oneDay.start_at, '2026-07-01T00:00')
  eq('ganztägig: Ende ist derselbe Tag', oneDay.end_at, '2026-07-01T00:00')

  const threeDays = googleEventToRow(
    { id: 'a2', summary: 'Urlaub', start: { date: '2026-07-01' }, end: { date: '2026-07-04' } },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('mehrtägig: letzter Tag ist inklusiv', threeDays.end_at, '2026-07-03T00:00')

  const back = rowToGoogleEvent({
    title: 'Urlaub',
    start_at: '2026-07-01T00:00',
    end_at: '2026-07-03T00:00',
    all_day: true,
    timezone: 'Europe/Berlin',
  })
  eq('Rückweg: Datum ohne Uhrzeit', back.start.date, '2026-07-01')
  eq('Rückweg: Ende wieder exklusiv', back.end.date, '2026-07-04')

  const single = rowToGoogleEvent({
    title: 'Feiertag',
    start_at: '2026-07-01T00:00',
    end_at: '2026-07-01T00:00',
    all_day: true,
  })
  eq('Rückweg: ein Tag wird zu +1', single.end.date, '2026-07-02')

  // Google may omit `end` entirely for a single day.
  const noEnd = googleEventToRow(
    { id: 'a3', summary: 'Tag', start: { date: '2026-07-01' } },
    { userId: USER, calendar: privat }
  )
  eq('fehlendes Ende ist derselbe Tag', noEnd.end_at, '2026-07-01T00:00')

  // Month and year boundaries, including a leap day.
  eq('Monatswechsel', isoDateAddDays('2026-01-31', 1), '2026-02-01')
  eq('Schaltjahr', isoDateAddDays('2024-02-28', 1), '2024-02-29')
  eq('Jahreswechsel rückwärts', isoDateAddDays('2026-01-01', -1), '2025-12-31')
}

// ── 3. Wiederholungen bleiben Regeln ────────────────────────────────────────
{
  eq('RRULE wird ausgepackt', recurrenceFromGoogle(['RRULE:FREQ=WEEKLY;BYDAY=MO']), 'FREQ=WEEKLY;BYDAY=MO')
  eq('EXDATE wird ignoriert', recurrenceFromGoogle(['EXDATE;TZID=Europe/Berlin:20260701T090000']), null)
  ok('keine Wiederholung bleibt null', recurrenceFromGoogle(undefined) === null)
  eq('RRULE wird wieder verpackt', recurrenceToGoogle('FREQ=WEEKLY')[0], 'RRULE:FREQ=WEEKLY')
  eq('doppeltes Präfix wird vermieden', recurrenceToGoogle('RRULE:FREQ=DAILY')[0], 'RRULE:FREQ=DAILY')
  ok('gelöschte Wiederholung wird leer übertragen', recurrenceToGoogle(null).length === 0)

  const series = googleEventToRow(
    {
      id: 's1',
      summary: 'Vorlesung',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;VALUE=DATE:20260714'],
      start: { dateTime: '2026-07-07T10:00:00+02:00' },
      end: { dateTime: '2026-07-07T12:00:00+02:00' },
    },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('Serie bleibt eine Regel', series.recurrence, 'FREQ=WEEKLY;BYDAY=TU')
  ok('Serie ist eine Zeile, keine hundert', typeof series.recurrence === 'string')

  // An overridden occurrence keeps its own id and points at its master, so it
  // never collides with the series row.
  const exception = googleEventToRow(
    {
      id: 's1_20260714T080000Z',
      recurringEventId: 's1',
      summary: 'Vorlesung (verlegt)',
      start: { dateTime: '2026-07-14T14:00:00+02:00' },
      end: { dateTime: '2026-07-14T16:00:00+02:00' },
    },
    { userId: USER, calendar: privat, userTimeZone: 'Europe/Berlin' }
  )
  eq('Ausnahme zeigt auf ihre Serie', exception.google_recurring_event_id, 's1')
  ok('Ausnahme hat eine eigene Identität', externalKey(exception) !== externalKey(series))
}

// ── 4. Erinnerungen ─────────────────────────────────────────────────────────
{
  eq('Override gewinnt', reminderFromGoogle({ overrides: [{ minutes: 15 }, { minutes: 60 }] }, 30), 15)
  eq('useDefault nimmt den Kalender-Standard', reminderFromGoogle({ useDefault: true }, 30), 30)
  ok('ohne Standard bleibt es leer', reminderFromGoogle({ useDefault: true }, null) === null)
  ok('leere Overrides sind „Keine“', reminderFromGoogle({ useDefault: false, overrides: [] }, 30) === null)
  // "Keine" has to be sent explicitly: useDefault would switch the calendar's
  // own reminder back on, which is the opposite of what the user asked for.
  const none = reminderToGoogle(null)
  ok('„Keine“ wird ausdrücklich übertragen', none.useDefault === false && none.overrides.length === 0)
  eq('30 Minuten werden übertragen', reminderToGoogle(30).overrides[0].minutes, 30)
}

// ── 5. Kalenderarten und Schreibrechte ──────────────────────────────────────
{
  eq('Geburtstagskalender erkannt', calendarKind({ id: 'addressbook#contacts@group.v.calendar.google.com' }), 'birthday')
  eq('Feiertagskalender erkannt', calendarKind({ id: 'de.german#holiday@group.v.calendar.google.com' }), 'holiday')
  eq('normaler Kalender', calendarKind({ id: 'julian@gmail.com' }), 'normal')

  // The rule the spec insists on: the access role decides, not the name.
  ok('owner darf schreiben', isWritableRole('owner'))
  ok('writer darf schreiben', isWritableRole('writer'))
  ok('reader darf nicht schreiben', !isWritableRole('reader'))
  ok('freeBusyReader darf nicht schreiben', !isWritableRole('freeBusyReader'))

  const privatCal = { kind: 'normal', access_role: 'owner' }
  const familie = { kind: 'normal', access_role: 'writer' }
  const feiertage = { kind: 'holiday', access_role: 'reader' }
  const geburtstage = { kind: 'birthday', access_role: 'reader' }
  // A calendar somebody *named* "Feiertage" but actually owns.
  const namedHoliday = { kind: 'normal', access_role: 'owner', summary: 'Feiertage' }
  // A normal calendar shared read-only with us.
  const sharedRead = { kind: 'normal', access_role: 'reader', summary: 'Team' }

  eq('Privat: lesen + schreiben', calendarWritability(privatCal), 'events')
  eq('Familie: lesen + schreiben', calendarWritability(familie), 'events')
  eq('Feiertage: read-only', calendarWritability(feiertage), 'none')
  eq('Geburtstage: über Kontakte', calendarWritability(geburtstage), 'contacts')
  eq('„Feiertage“ mit owner-Recht bleibt schreibbar', calendarWritability(namedHoliday), 'events')
  eq('fremder Kalender mit reader-Recht ist read-only', calendarWritability(sharedRead), 'none')

  ok('neue Termine nur in schreibbaren Kalendern', canCreateEventsIn(privatCal))
  ok('keine neuen Termine in Feiertagen', !canCreateEventsIn(feiertage))
  ok('keine neuen Termine in Geburtstagen', !canCreateEventsIn(geburtstage))

  // Colours come from Google and go straight into a style attribute, so
  // anything that is not a hex triple is dropped rather than passed on.
  eq('Farbe wird übernommen', safeHexColor('#0B8043'), '#0b8043')
  ok('Unsinn wird verworfen', safeHexColor('javascript:alert(1)') === null)
  ok('Kurzform wird verworfen', safeHexColor('#fff') === null)

  const row = calendarListEntryToRow(
    {
      id: 'julian@gmail.com',
      summary: 'Julian',
      backgroundColor: '#4A80FF',
      foregroundColor: '#FFFFFF',
      accessRole: 'owner',
      primary: true,
      timeZone: 'Europe/Berlin',
      defaultReminders: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 60 }],
    },
    USER
  )
  eq('Kalenderfarbe wird gespeichert', row.background_color, '#4a80ff')
  eq('Standard-Erinnerung: die früheste', row.default_reminder_minutes, 30)
  ok('Hauptkalender erkannt', row.is_primary === true)
  eq('erste Verbindung wählt den Hauptkalender', defaultSelection([row, { google_calendar_id: 'x', is_primary: false }]).join(), 'julian@gmail.com')
}

// ── 6. Geburtstage kommen aus den Kontakten ─────────────────────────────────
{
  const birthday = googleEventToRow(
    {
      id: 'b1',
      summary: 'Mama',
      eventType: 'birthday',
      birthdayProperties: { contact: 'people/c123', type: 'birthday' },
      recurrence: ['RRULE:FREQ=YEARLY'],
      start: { date: '1965-04-12' },
      end: { date: '1965-04-13' },
    },
    { userId: USER, calendar: { google_calendar_id: 'contacts', kind: 'birthday', access_role: 'reader' } }
  )
  ok('Geburtstag ist als solcher markiert', birthday.is_birthday === true)
  ok('Geburtstag ist ganztägig', birthday.all_day === true)
  eq('Geburtstag ist jährlich', birthday.recurrence, 'FREQ=YEARLY')
  // The link to the contact is the whole reason a birthday can be edited at
  // all — without it there is nothing to write to.
  eq('Geburtstag kennt seinen Kontakt', birthday.google_contact_id, 'people/c123')

  // A birthday sitting in a normal calendar is an ordinary event.
  const notBirthday = googleEventToRow(
    { id: 'n1', summary: 'Kuchen kaufen', start: { date: '2026-04-12' }, end: { date: '2026-04-13' } },
    { userId: USER, calendar: privat }
  )
  ok('normaler ganztägiger Termin ist kein Geburtstag', notBirthday.is_birthday === false)
}

// ── 7. Konflikte: die neueste Änderung gewinnt ──────────────────────────────
{
  const base = { updated_at: '2026-09-02T10:02:00Z', google_updated_at: '2026-09-02T09:00:00Z' }

  // Das Beispiel aus der Spezifikation, in beide Richtungen.
  eq(
    '10:01 Google, 10:02 App → App gewinnt',
    resolveIncoming({
      local: { ...base, sync_state: 'pending', updated_at: '2026-09-02T10:02:00Z' },
      incoming: { google_updated_at: '2026-09-02T10:01:00Z' },
    }),
    'local'
  )
  eq(
    '10:01 App, 10:02 Google → Google gewinnt',
    resolveIncoming({
      local: { ...base, sync_state: 'pending', updated_at: '2026-09-02T10:01:00Z' },
      incoming: { google_updated_at: '2026-09-02T10:02:00Z' },
    }),
    'google'
  )

  eq('unbekanntes Event wird übernommen', resolveIncoming({ local: null, incoming: { google_updated_at: 'x' } }), 'google')
  eq(
    'dieselbe Version ist ein Echo',
    resolveIncoming({
      local: { sync_state: 'synced', google_updated_at: '2026-09-02T10:00:00Z' },
      incoming: { google_updated_at: '2026-09-02T10:00:00.000Z' },
    }),
    'none'
  )
  eq(
    'ohne lokale Änderung gewinnt Google',
    resolveIncoming({
      local: { sync_state: 'synced', google_updated_at: '2026-09-02T09:00:00Z', updated_at: '2026-09-02T11:00:00Z' },
      incoming: { google_updated_at: '2026-09-02T10:00:00Z' },
    }),
    'google'
  )

  // Auf dem Rückweg, wenn Google den Etag ablehnt.
  eq(
    'Etag-Konflikt: neuere Google-Version gewinnt',
    resolveOutgoing({ local: { updated_at: '2026-09-02T10:00:00Z' }, remote: { updated: '2026-09-02T10:05:00Z' } }),
    'google'
  )
  eq(
    'Etag-Konflikt: neuere App-Version gewinnt',
    resolveOutgoing({ local: { updated_at: '2026-09-02T10:10:00Z' }, remote: { updated: '2026-09-02T10:05:00Z' } }),
    'local'
  )
}

// ── 8. Identität und Duplikate ──────────────────────────────────────────────
{
  const a = { google_calendar_id: 'privat', google_event_id: 'g1' }
  const b = { google_calendar_id: 'familie', google_event_id: 'g1' }
  ok('gleiche Identität → gleicher Schlüssel', externalKey(a) === externalKey({ ...a }))
  ok('anderer Kalender → andere Identität', externalKey(a) !== externalKey(b))
  ok('ohne Google-ID gibt es keine externe Identität', externalKey({ google_calendar_id: 'privat' }) === null)
  ok('App-only Event hat keine externe Identität', externalKey({ title: 'Nur hier' }) === null)

  // Identity is the id pair, never the title and time — two lectures can share
  // both and are still two events.
  const one = { google_calendar_id: 'privat', google_event_id: 'g1', title: 'Sport', start_at: '2026-07-01T10:00' }
  const two = { google_calendar_id: 'privat', google_event_id: 'g2', title: 'Sport', start_at: '2026-07-01T10:00' }
  ok('gleicher Titel und Zeit sind nicht dieselbe Identität', externalKey(one) !== externalKey(two))
}

// ── 9. Nur sichtbare Änderungen lösen einen Schreibvorgang aus ──────────────
{
  const row = { title: 'A', start_at: '2026-07-01T10:00', end_at: '2026-07-01T11:00', all_day: false, recurrence: null, reminder: 30, location: null, description: null, is_birthday: false }
  ok('identische Felder → kein Schreibvorgang', !differsInSyncedFields(row, { ...row }))
  ok('anderer Titel → Schreibvorgang', differsInSyncedFields(row, { ...row, title: 'B' }))
  ok('andere Uhrzeit → Schreibvorgang', differsInSyncedFields(row, { ...row, start_at: '2026-07-01T11:00' }))
  // Bookkeeping changes are not the event changing.
  ok('neuer Etag allein ist keine Änderung', !differsInSyncedFields(row, { ...row, google_etag: '"neu"' }))
}

// ── 10. Der OAuth-State ist fälschungssicher ────────────────────────────────
{
  const secret = 'server-side-secret'
  const token = await signState({ user_id: USER, redirect: 'https://x.test/app/', exp: Date.now() + 60000 }, secret)
  const verified = await verifyState(token, secret)
  eq('gültiger State nennt den Benutzer', verified?.user_id, USER)

  // Each of these is a way somebody could otherwise attach *their* Google
  // account to *this* user's app account.
  ok('fremdes Secret wird abgelehnt', (await verifyState(token, 'anderes-secret')) === null)
  ok('manipulierter State wird abgelehnt', (await verifyState(token.slice(0, -3) + 'aaa', secret)) === null)
  ok('State ohne Signatur wird abgelehnt', (await verifyState('nur-payload', secret)) === null)
  ok('abgelaufener State wird abgelehnt', (await verifyState(await signState({ user_id: USER, exp: Date.now() - 1 }, secret), secret)) === null)

  const allow = ['https://nailujsims-sys.github.io/claude-repository/']
  ok('erlaubte Rücksprungadresse', isAllowedRedirect('https://nailujsims-sys.github.io/claude-repository/', allow))
  ok('erlaubte Unterseite', isAllowedRedirect('https://nailujsims-sys.github.io/claude-repository/#/profil', allow))
  ok('fremde Domain wird abgelehnt', !isAllowedRedirect('https://evil.test/', allow))
  ok('andere Seite derselben Domain wird abgelehnt', !isAllowedRedirect('https://nailujsims-sys.github.io/anderes/', allow))
  ok('http wird abgelehnt', !isAllowedRedirect('http://nailujsims-sys.github.io/claude-repository/', allow))
  ok('localhost bleibt für die Entwicklung erlaubt', isAllowedRedirect('http://localhost:5173/', ['http://localhost:5173/']))
}

// ── 11. Das Importfenster ───────────────────────────────────────────────────
{
  const now = new Date('2026-09-02T12:00:00Z')
  const window = initialWindow(now, 'Europe/Berlin')
  eq('zwei Jahre Vergangenheit', IMPORT_PAST_YEARS, 2)
  ok('Startdatum liegt zwei Jahre zurück', window.timeMin.startsWith('2024-09-02'))
  // Open-ended on purpose: a birthday in 2031 has to come along.
  ok('die Zukunft ist nicht begrenzt', window.timeMax === undefined)
  eq('heute wird in der Zone des Nutzers bestimmt', todayInZone(now, 'Europe/Berlin'), '2026-09-02')
  // 23:30 UTC is already tomorrow in Berlin — the window must follow the
  // user's day, not UTC's.
  eq('Tageswechsel folgt dem Nutzer', todayInZone(new Date('2026-09-02T23:30:00Z'), 'Europe/Berlin'), '2026-09-03')
}

// ── 12. Die Verbindungszeile in Echtzeit ────────────────────────────────────
// `google_connections` hat `user_id` als Primärschlüssel, nicht `id`. Der
// gemeinsame Reducer schlüsselt auf `id` — richtig für jede andere Tabelle der
// App und falsch für genau diese. Ein DELETE trägt nur den Primärschlüssel,
// also käme ein Trennen auf dem zweiten Gerät nie an.
{
  const connection = { user_id: USER, status: 'connected', google_account_email: 'a@test' }
  const other = '99999999-8888-4777-8666-555555555555'

  const inserted = applyConnectionChange(null, { eventType: 'INSERT', new: connection }, USER)
  eq('eine neue Verbindung kommt an', inserted?.status, 'connected')

  const updated = applyConnectionChange(
    connection,
    { eventType: 'UPDATE', new: { ...connection, status: 'needs_reauth' } },
    USER
  )
  eq('ein Statuswechsel kommt an', updated?.status, 'needs_reauth')

  // Das eigentliche Ziel: Trennen auf Gerät A erreicht Gerät B.
  const removed = applyConnectionChange(connection, { eventType: 'DELETE', old: { user_id: USER } }, USER)
  ok('das Trennen kommt auf dem anderen Gerät an', removed === null)

  // Ein DELETE geht ungefiltert an alle Abonnenten der Tabelle — fremde
  // dürfen unsere Verbindung nicht löschen.
  ok(
    'ein fremdes Trennen lässt unsere Verbindung stehen',
    applyConnectionChange(connection, { eventType: 'DELETE', old: { user_id: other } }, USER) === connection
  )
  ok(
    'eine fremde Verbindung wird nicht übernommen',
    applyConnectionChange(null, { eventType: 'INSERT', new: { ...connection, user_id: other } }, USER) === null
  )
  // Das Echo der eigenen Schreiboperation darf kein Re-Render auslösen.
  ok(
    'dieselbe Zeile gibt dasselbe Objekt zurück',
    applyConnectionChange(connection, { eventType: 'UPDATE', new: { ...connection } }, USER) === connection
  )
}

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
