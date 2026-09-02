// The sync engine. Pure orchestration over two injected ports — `google` (the
// API client) and `store` (the Supabase access) — which is what lets
// tools/googleSyncLogic.mjs run every path in this file against a fake Google
// and an in-memory database, with no network and no browser.
//
// ── The order of a run, and why it is that order ────────────────────────────
//
//   1. tombstones — events deleted here, deleted in Google
//   2. push       — events changed here, written to Google
//   3. pull       — everything Google changed since the last run
//
// Push before pull. A local change that has not reached Google yet would
// otherwise be read back as "Google's version", and the newer local edit would
// lose to the older remote one on the way in. Doing it in this order means the
// pull sees the state the push just created and recognises it as its own.
//
// ── Why this cannot loop ────────────────────────────────────────────────────
//
// A write from here reaches Postgres as `service_role`, and the trigger
// `events_mark_pending` (migration 0005) leaves those rows alone. Only a write
// from a device becomes `pending`. So Google → app does not create work for
// app → Google, and the cycle has nowhere to go. On top of that, an incoming
// version whose `updated` matches the one we already stored is dropped before
// it is written at all (conflict.js → 'none'), so even a redelivered
// notification changes nothing.

import { googleEventToRow, rowToGoogleEvent, differsInSyncedFields } from './mapping.js'
import { resolveIncoming, resolveOutgoing, GOOGLE, LOCAL, NONE } from './conflict.js'
import { calendarListEntryToRow, calendarWritability, defaultSelection } from './calendars.js'
import { GoogleError, CONTACTS_SCOPE } from './google.js'
import { dateOf, isoDateAddDays, rfc3339InZone, todayInZone } from './time.js'

// How far back the first import reaches. Two years, as specified — far enough
// that last year's holidays and birthdays are there, near enough that the
// first sync finishes in one run.
export const IMPORT_PAST_YEARS = 2

// Forward: everything Google will give us. `timeMax` is left off entirely, so
// the window is open-ended and a yearly birthday in 2031 comes along too.
// After the first run the sync token takes over and the window stops mattering.
export function initialWindow(now, timeZone) {
  const today = todayInZone(now, timeZone)
  const [year, month, day] = today.split('-').map(Number)
  const from = `${year - IMPORT_PAST_YEARS}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { timeMin: `${from}T00:00:00Z` }
}

const isoNow = (now) => new Date(now()).toISOString()

// ── Calendars ───────────────────────────────────────────────────────────────

// Reads Google's calendar list into `google_calendars`, keeping whatever the
// user already chose. A calendar that disappeared from Google is marked
// unavailable rather than deleted: its events stay in the app, and the
// settings screen can say what happened.
export async function refreshCalendars(deps, { userId, firstConnection = false }) {
  const { google, store, now } = deps
  const entries = await google.calendarList()
  const rows = entries.map((entry) => calendarListEntryToRow(entry, userId))
  const existing = await store.listCalendars(userId)
  const known = new Map(existing.map((c) => [c.google_calendar_id, c]))

  const selection = firstConnection ? new Set(defaultSelection(rows)) : null

  const upserts = rows.map((row) => ({
    ...row,
    is_selected: selection
      ? selection.has(row.google_calendar_id)
      : (known.get(row.google_calendar_id)?.is_selected ?? false),
    // A calendar that came back after being gone starts a fresh full read:
    // whatever changed while it was away never reached us.
    sync_token: known.get(row.google_calendar_id)?.is_available === false
      ? null
      : (known.get(row.google_calendar_id)?.sync_token ?? null),
  }))
  await store.upsertCalendars(upserts)

  const live = new Set(rows.map((r) => r.google_calendar_id))
  const vanished = existing.filter((c) => !live.has(c.google_calendar_id) && c.is_available)
  if (vanished.length) {
    await store.markCalendarsUnavailable(userId, vanished.map((c) => c.google_calendar_id))
  }

  return { calendars: await store.listCalendars(userId), vanished: vanished.length }
}

// ── Google → app ────────────────────────────────────────────────────────────

// One calendar, one incremental read. `syncToken` present means "only what
// changed"; absent means the full window.
//
// Google answers a stale token with 410 GONE. That is not an error to report —
// it means the cursor aged out and the calendar has to be read in full again,
// which is exactly what happens.
export async function pullCalendar(deps, { userId, calendar, userTimeZone }) {
  const { google, store, now } = deps
  const base = {
    maxResults: 250,
    // Masters, not occurrences. Expanding a series into hundreds of rows is
    // the thing the spec rules out — the RRULE is the event.
    singleEvents: false,
    showDeleted: true,
  }

  let pageToken = null
  let syncToken = calendar.sync_token
  let nextSyncToken = null
  let applied = 0
  let removed = 0

  const params = syncToken
    ? { ...base, syncToken }
    : { ...base, ...initialWindow(now(), userTimeZone) }

  for (;;) {
    let page
    try {
      page = await google.listEvents(calendar.google_calendar_id, { ...params, pageToken })
    } catch (error) {
      if (error instanceof GoogleError && error.status === 410 && syncToken) {
        // The cursor expired. Start over from the full window, once.
        syncToken = null
        pageToken = null
        Object.assign(params, base, initialWindow(now(), userTimeZone))
        delete params.syncToken
        await store.setCalendarSyncToken(userId, calendar.google_calendar_id, null)
        continue
      }
      throw error
    }

    for (const event of page?.items ?? []) {
      const result = await applyIncomingEvent(deps, { userId, calendar, event, userTimeZone })
      if (result === 'deleted') removed += 1
      else if (result === 'applied') applied += 1
    }

    pageToken = page?.nextPageToken ?? null
    // The token only arrives on the last page, and only then is it safe to
    // store: keeping a token from a half-read list would skip the remainder
    // on the next run, permanently.
    if (!pageToken) {
      nextSyncToken = page?.nextSyncToken ?? null
      break
    }
  }

  await store.updateCalendarAfterSync(userId, calendar.google_calendar_id, {
    sync_token: nextSyncToken,
    last_synced_at: isoNow(now),
    last_error: null,
  })

  return { applied, removed }
}

// One event from Google, folded into the app's rows.
export async function applyIncomingEvent(deps, { userId, calendar, event, userTimeZone }) {
  const { store } = deps
  if (!event?.id) return 'skipped'

  const local = await store.findEventByGoogleId(userId, calendar.google_calendar_id, event.id)

  // Google reports a deletion as a `cancelled` status, not as an absence.
  if (event.status === 'cancelled') {
    if (!local) return 'skipped'
    await store.deleteEventById(local.id)
    return 'deleted'
  }

  const incoming = googleEventToRow(event, {
    userId,
    calendar,
    userTimeZone,
    calendarDefaultMinutes: calendar.default_reminder_minutes ?? null,
  })

  const verdict = resolveIncoming({ local, incoming })
  if (verdict === NONE) return 'skipped'
  if (verdict === LOCAL) {
    // Our version is newer and still owed to Google. Leave it pending; the
    // next push sends it, and Google ends up agreeing with us.
    return 'skipped'
  }

  if (local) {
    // Nothing the user can see has changed — only bookkeeping. Store the new
    // etag so the next comparison is against the current version, but do not
    // touch the row's own fields, which would wake up every open device for
    // nothing.
    if (!differsInSyncedFields(local, incoming)) {
      await store.updateEvent(local.id, {
        google_etag: incoming.google_etag,
        google_updated_at: incoming.google_updated_at,
        sync_state: 'synced',
        sync_error: null,
      })
      return 'skipped'
    }
    await store.updateEvent(local.id, incoming)
    return 'applied'
  }

  await store.insertEvent(incoming)
  return 'applied'
}

// ── app → Google ────────────────────────────────────────────────────────────

// Everything changed here since the last run. Each event is handled on its
// own: one that fails is marked and the rest still go, because a single bad
// event must not stop a sync.
export async function pushPending(deps, { userId, calendars }) {
  const { store } = deps
  const pending = await store.listPendingEvents(userId)
  const byId = new Map(calendars.map((c) => [c.google_calendar_id, c]))

  let pushed = 0
  const failures = []

  for (const row of pending) {
    const calendar = byId.get(row.google_calendar_id)
    if (!calendar || !calendar.is_selected || !calendar.is_available) {
      // The calendar is no longer synced. The event stays exactly as it is —
      // dropping it, or forcing it somewhere else, would be data loss.
      await store.updateEvent(row.id, {
        sync_state: 'error',
        sync_error: 'Kalender wird nicht mehr synchronisiert.',
      })
      failures.push({ id: row.id, message: 'Kalender wird nicht mehr synchronisiert.' })
      continue
    }
    try {
      await pushEvent(deps, { userId, row, calendar })
      pushed += 1
    } catch (error) {
      const message = error?.message || String(error)
      await store.updateEvent(row.id, {
        // Retryable means Google was busy, not that the event is wrong: it
        // stays `pending` so the next run picks it up again.
        sync_state: error instanceof GoogleError && error.retryable ? 'pending' : 'error',
        sync_error: message.slice(0, 400),
      })
      failures.push({ id: row.id, message })
      if (error instanceof GoogleError && error.needsReauth) throw error
    }
  }

  return { pushed, failures }
}

export async function pushEvent(deps, { userId, row, calendar }) {
  const { google, store, now } = deps
  const writability = calendarWritability(calendar)

  if (writability === 'none') {
    throw new Error('Dieser Kalender ist in Google schreibgeschützt.')
  }

  if (writability === 'contacts') {
    return pushBirthday(deps, { row, calendar })
  }

  const body = rowToGoogleEvent(row)

  if (!row.google_event_id) {
    const created = await google.insertEvent(calendar.google_calendar_id, body)
    await store.updateEvent(row.id, {
      google_event_id: created.id,
      google_calendar_id: calendar.google_calendar_id,
      google_etag: created.etag ?? null,
      google_updated_at: created.updated ?? isoNow(now),
      sync_state: 'synced',
      sync_error: null,
    })
    return 'created'
  }

  try {
    const updated = await google.patchEvent(
      calendar.google_calendar_id,
      row.google_event_id,
      body,
      row.google_etag
    )
    await store.updateEvent(row.id, {
      google_etag: updated?.etag ?? null,
      google_updated_at: updated?.updated ?? isoNow(now),
      sync_state: 'synced',
      sync_error: null,
    })
    return 'updated'
  } catch (error) {
    // Deleted in Google while we were editing it here. Re-creating it behind
    // the user's back would resurrect something they may have deleted on
    // purpose on the other side, so the row simply becomes app-only and says so.
    if (error instanceof GoogleError && (error.status === 404 || error.status === 410)) {
      await store.updateEvent(row.id, {
        google_event_id: null,
        google_etag: null,
        google_updated_at: null,
        sync_state: 'local',
        sync_enabled: false,
        sync_error: 'In Google nicht mehr vorhanden — nur noch in der App.',
      })
      return 'orphaned'
    }

    // Somebody changed the event in Google after we last read it. Now the
    // timestamps decide, and only now.
    if (error instanceof GoogleError && error.status === 412) {
      const remote = await google.getEvent(calendar.google_calendar_id, row.google_event_id)
      if (resolveOutgoing({ local: row, remote }) === GOOGLE) {
        const incoming = googleEventToRow(remote, {
          userId,
          calendar,
          userTimeZone: row.timezone,
          calendarDefaultMinutes: calendar.default_reminder_minutes ?? null,
        })
        await store.updateEvent(row.id, incoming)
        return 'yielded'
      }
      const forced = await google.patchEvent(
        calendar.google_calendar_id,
        row.google_event_id,
        body,
        null // our version is the newer one; write it without the condition
      )
      await store.updateEvent(row.id, {
        google_etag: forced?.etag ?? null,
        google_updated_at: forced?.updated ?? isoNow(now),
        sync_state: 'synced',
        sync_error: null,
      })
      return 'updated'
    }
    throw error
  }
}

// A birthday is a contact, so this writes to People API — the calendar entry
// Google shows is generated from it and cannot be patched directly.
export async function pushBirthday(deps, { row, calendar }) {
  const { google, store, now } = deps

  if (!row.google_contact_id) {
    throw new Error('Zu diesem Geburtstag gibt es keinen Google-Kontakt.')
  }
  // Lesen ging über calendar.events, Schreiben geht nur über die Kontakte —
  // und die fragt die normale Kalenderverbindung bewusst nicht mehr ab. Bis
  // es dafür einen eigenen Schalter gibt, ist das kein Fehler, sondern eine
  // Auskunft: der Geburtstag bleibt sichtbar, nur eben in Google unverändert.
  if (!google.hasScope(CONTACTS_SCOPE)) {
    throw new Error(
      'Geburtstage in Google ändern ist noch nicht freigegeben — die Kontakte-Berechtigung fehlt.'
    )
  }

  const date = dateOf(row.start_at)
  if (!date) throw new Error('Geburtstag ohne Datum.')
  const [year, month, day] = date.split('-').map(Number)

  const contact = await google.getContact(row.google_contact_id)
  await google.updateContactBirthday(row.google_contact_id, contact?.etag, {
    year,
    month,
    day,
  })

  await store.updateEvent(row.id, {
    sync_state: 'synced',
    sync_error: null,
    google_updated_at: isoNow(now),
  })
  return 'contact-updated'
}

// ── Deletes ─────────────────────────────────────────────────────────────────
// The row is already gone by the time we get here — `google_event_tombstones`
// is what is left of it, written by a trigger, and it exists precisely so a
// delete in the app can still find its Google event.
export async function drainTombstones(deps, { userId, calendars }) {
  const { google, store } = deps
  const tombstones = await store.listTombstones(userId)
  const byId = new Map(calendars.map((c) => [c.google_calendar_id, c]))

  let deleted = 0
  const failures = []

  for (const stone of tombstones) {
    const calendar = byId.get(stone.google_calendar_id)
    if (!calendar || calendarWritability(calendar) !== 'events') {
      // Nothing we can do about it and nothing we should keep retrying.
      await store.deleteTombstone(stone.id)
      continue
    }
    try {
      await google.deleteEvent(stone.google_calendar_id, stone.google_event_id)
      await store.deleteTombstone(stone.id)
      deleted += 1
    } catch (error) {
      // Already gone in Google — which is the outcome we wanted.
      if (error instanceof GoogleError && (error.status === 404 || error.status === 410)) {
        await store.deleteTombstone(stone.id)
        deleted += 1
        continue
      }
      await store.touchTombstone(stone.id, error?.message ?? String(error))
      failures.push({ id: stone.id, message: error?.message ?? String(error) })
      if (error instanceof GoogleError && error.needsReauth) throw error
    }
  }

  return { deleted, failures }
}

// ── Push channels ───────────────────────────────────────────────────────────
// Google's own notification of a change, so the app does not have to ask.
// Channels expire, so every run renews the ones that are close to it. A failure
// here never fails the run: without a channel the sync still works, it just
// waits for the next trigger instead of being told.
export async function ensureChannels(deps, { userId, calendars, address, ttlSeconds = 7 * 24 * 3600 }) {
  const { google, store, now, randomId } = deps
  if (!address) return { watched: 0, skipped: 'no-endpoint' }

  const existing = await store.listChannels(userId)
  const byCalendar = new Map(existing.map((c) => [c.google_calendar_id, c]))
  const soon = now() + 24 * 3600 * 1000
  let watched = 0

  for (const calendar of calendars) {
    const current = byCalendar.get(calendar.google_calendar_id)
    if (current && Date.parse(current.expires_at ?? 0) > soon) continue
    try {
      if (current) {
        await google.stopChannel({ id: current.id, resourceId: current.resource_id }).catch(() => {})
        await store.deleteChannel(current.id)
      }
      const id = randomId()
      const token = randomId()
      const response = await google.watch(calendar.google_calendar_id, {
        id,
        address,
        token,
        ttlSeconds,
      })
      await store.insertChannel({
        id,
        user_id: userId,
        google_calendar_id: calendar.google_calendar_id,
        resource_id: response?.resourceId ?? null,
        token,
        expires_at: response?.expiration
          ? new Date(Number(response.expiration)).toISOString()
          : new Date(now() + ttlSeconds * 1000).toISOString(),
      })
      watched += 1
    } catch {
      // A calendar we cannot watch is a calendar we pull on the next run.
    }
  }

  return { watched }
}

// ── One full run ────────────────────────────────────────────────────────────
export async function runSync(deps, { userId, userTimeZone, pushAddress = null, calendarIds = null }) {
  const { store, now } = deps
  const all = await store.listCalendars(userId)
  const selected = all.filter(
    (c) =>
      c.is_selected &&
      c.is_available &&
      (!calendarIds || calendarIds.includes(c.google_calendar_id))
  )

  const result = {
    pushed: 0,
    deleted: 0,
    applied: 0,
    removed: 0,
    calendars: selected.length,
    failures: [],
  }

  let needsReauth = false

  try {
    const tomb = await drainTombstones(deps, { userId, calendars: all })
    result.deleted = tomb.deleted
    result.failures.push(...tomb.failures)

    const push = await pushPending(deps, { userId, calendars: all })
    result.pushed = push.pushed
    result.failures.push(...push.failures)

    for (const calendar of selected) {
      try {
        const pull = await pullCalendar(deps, { userId, calendar, userTimeZone })
        result.applied += pull.applied
        result.removed += pull.removed
      } catch (error) {
        if (error instanceof GoogleError && error.needsReauth) throw error
        // One calendar failing is one calendar's problem. The others still
        // sync, and the failure is written where the user can see it.
        await store.updateCalendarAfterSync(userId, calendar.google_calendar_id, {
          last_error: (error?.message ?? String(error)).slice(0, 400),
        })
        result.failures.push({ calendar: calendar.google_calendar_id, message: error?.message })
      }
    }

    await ensureChannels(deps, { userId, calendars: selected, address: pushAddress })
  } catch (error) {
    if (error instanceof GoogleError && error.needsReauth) {
      needsReauth = true
      result.failures.push({ message: 'Google-Verbindung abgelaufen. Bitte neu verbinden.' })
    } else {
      throw error
    }
  }

  const status = needsReauth
    ? 'needs_reauth'
    : result.failures.length
      ? 'error'
      : 'connected'

  await store.updateConnection(userId, {
    status,
    last_sync_at: isoNow(now),
    last_sync_status: needsReauth ? 'failed' : result.failures.length ? 'partial' : 'ok',
    last_error: result.failures.length ? String(result.failures[0].message ?? '').slice(0, 400) : null,
  })

  return { ...result, status }
}

export { GOOGLE, LOCAL, NONE }
