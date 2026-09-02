// Everything the signed-in app asks the sync service to do.
//
// Deployed with `verify_jwt: true`, so the platform has already rejected any
// request without a valid Supabase session before this code runs. The user id
// then comes from that verified token and from nowhere else — never from the
// request body, which is the one way this endpoint could be talked into acting
// for somebody else.
//
// Google's tokens are read and written here and are never part of a response.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { createStore } from '../_shared/store.js'
import { createGoogleClient, consentUrl, SCOPES, GoogleError } from '../_shared/google.js'
import { signState } from '../_shared/state.js'
import { runSync, refreshCalendars } from '../_shared/sync.js'
import { json, fail, preflight, googleConfig } from '../_shared/http.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const store = createStore(admin)
const config = googleConfig(Deno.env)

const callbackUrl = () => `${SUPABASE_URL}/functions/v1/google-hooks/callback`
const randomId = () => crypto.randomUUID()

// The connected user, from the verified bearer token. `verify_jwt` already
// checked the signature; this turns it into an id we can filter rows by.
async function currentUser(req: Request) {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error) return null
  return data.user ?? null
}

// A Google client for this user, wired so a refreshed token is written back
// immediately — a refresh that is not persisted is a refresh that happens
// again on every single request.
async function clientFor(userId: string) {
  const credentials = await store.getCredentials(userId)
  if (!credentials?.refresh_token) return null
  return createGoogleClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    credentials,
    onTokenRefresh: async (next: Record<string, unknown>) => {
      await store.saveCredentials(userId, {
        access_token: next.access_token,
        refresh_token: next.refresh_token,
        expires_at: next.expires_at,
        scopes: next.scopes,
      })
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return fail('Nur POST.', 405)

  const user = await currentUser(req)
  if (!user) return fail('Nicht angemeldet.', 401)

  let payload: Record<string, unknown> = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }
  const action = String(payload.action ?? '')

  if (!config.ready && action !== 'status') {
    return fail(
      'Google-Integration ist auf dem Server noch nicht konfiguriert.',
      503,
      { missing: config.missing }
    )
  }

  try {
    switch (action) {
      // What the settings screen shows. Never includes a token.
      case 'status': {
        const connection = await store.getConnection(user.id)
        return json({
          configured: config.ready,
          connection,
          calendars: connection ? await store.listCalendars(user.id) : [],
        })
      }

      // Hands back the Google consent URL. The state is signed and short-lived,
      // and it carries the return address, which the callback re-checks against
      // its allowlist.
      case 'connect': {
        const redirect = String(payload.redirect ?? '')
        const state = await signState(
          {
            user_id: user.id,
            redirect,
            nonce: randomId(),
            exp: Date.now() + 10 * 60 * 1000,
          },
          config.stateSecret
        )
        return json({
          url: consentUrl({
            clientId: config.clientId,
            redirectUri: callbackUrl(),
            state,
            scopes: SCOPES,
          }),
        })
      }

      case 'refresh-calendars': {
        const google = await clientFor(user.id)
        if (!google) return fail('Keine Google-Verbindung.', 409)
        const result = await refreshCalendars(
          { google, store, now: Date.now },
          { userId: user.id }
        )
        return json({ calendars: result.calendars })
      }

      case 'select-calendar': {
        const calendarId = String(payload.calendar_id ?? '')
        const selected = payload.selected !== false
        if (!calendarId) return fail('calendar_id fehlt.', 400)
        await store.setCalendarSelected(user.id, calendarId, selected)
        // Switching one on means importing it, right now, so the calendar is
        // populated by the time the user gets back to it.
        if (selected) {
          const google = await clientFor(user.id)
          if (google) {
            await runSync(
              { google, store, now: Date.now, randomId },
              {
                userId: user.id,
                userTimeZone: await store.getTimeZone(user.id),
                pushAddress: config.pushAddress,
                calendarIds: [calendarId],
              }
            )
          }
        }
        return json({ calendars: await store.listCalendars(user.id) })
      }

      case 'set-default-calendar': {
        const calendarId = payload.calendar_id ? String(payload.calendar_id) : null
        if (calendarId) {
          // Only a calendar this user actually has, and only one we could
          // write to. Anything else would be a default that always fails.
          const calendars = await store.listCalendars(user.id)
          const match = calendars.find((c) => c.google_calendar_id === calendarId)
          if (!match) return fail('Unbekannter Kalender.', 404)
        }
        const connection = await store.updateConnection(user.id, {
          default_calendar_id: calendarId,
        })
        return json({ connection })
      }

      case 'sync': {
        const google = await clientFor(user.id)
        if (!google) return fail('Keine Google-Verbindung.', 409)
        const result = await runSync(
          { google, store, now: Date.now, randomId },
          {
            userId: user.id,
            userTimeZone: await store.getTimeZone(user.id),
            pushAddress: config.pushAddress,
          }
        )
        return json({ result, connection: await store.getConnection(user.id) })
      }

      // Ends the connection and keeps the data. The events stay, as app-only
      // events — the one behaviour the spec is explicit about.
      case 'disconnect': {
        const google = await clientFor(user.id)
        if (google) {
          for (const channel of await store.listChannels(user.id)) {
            await google
              .stopChannel({ id: channel.id, resourceId: channel.resource_id })
              .catch(() => {})
            await store.deleteChannel(channel.id)
          }
        }
        await store.detachEvents(user.id)
        await store.clearTombstones(user.id)
        await store.deleteCalendars(user.id)
        await store.deleteCredentials(user.id)
        await store.deleteConnection(user.id)
        return json({ ok: true })
      }

      default:
        return fail(`Unbekannte Aktion: ${action || '(keine)'}`, 400)
    }
  } catch (error) {
    console.error('google-api', action, error)
    if (error instanceof GoogleError && error.needsReauth) {
      await store
        .updateConnection(user.id, {
          status: 'needs_reauth',
          last_error: 'Google-Verbindung abgelaufen.',
        })
        .catch(() => {})
      return fail('Google-Verbindung abgelaufen. Bitte neu verbinden.', 409, {
        needs_reauth: true,
      })
    }
    // A GoogleError says something the user can act on ("dieser Kalender ist
    // schreibgeschützt"). Anything else is ours — a Postgres message or a
    // stack — and belongs in the function log, not in a browser: that is what
    // http.js promises, and returning `error.message` unfiltered broke it.
    if (error instanceof GoogleError) return fail(error.message, 502)
    return fail('Die Synchronisierung ist fehlgeschlagen.', 500)
  }
})
