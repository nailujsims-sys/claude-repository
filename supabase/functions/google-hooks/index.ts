// The two endpoints Google itself calls. Both are public — a browser coming
// back from a consent screen carries no session, and Google's notification
// server has no account here — so neither can rely on a Supabase JWT and both
// bring their own proof instead:
//
//   /callback — the `state` we issued, HMAC-signed and expiring in 10 minutes.
//               It names the user, so a code delivered here can only ever
//               attach a Google account to the account that asked for it.
//   /push     — the channel token Google echoes back in X-Goog-Channel-Token,
//               compared against the one we generated for that channel. The
//               notification itself carries no data, so even a forged one
//               could at most cause an extra sync of the user it names.
//
// Deployed with `verify_jwt: false`, which is why the checks above are not
// optional and why nothing here reads a user id out of a request body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { createStore } from '../_shared/store.js'
import {
  createGoogleClient,
  exchangeCode,
  emailFromIdToken,
  GoogleError,
} from '../_shared/google.js'
import { verifyState, isAllowedRedirect } from '../_shared/state.js'
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

// The app is sent back with a plain marker and nothing else. A token or a code
// in a redirect URL ends up in history, in logs and in the Referer header.
function backToApp(target: string, params: Record<string, string>) {
  const url = new URL(target)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

// A readable page for the cases where we have nowhere safe to send the user —
// an unsigned state, or a return address that is not ours.
//
// Every caller passes a literal, and none of them may ever stop doing so: this
// is the one place in the integration that builds HTML by hand, on a public
// endpoint reached straight from a redirect. The escape is here so that
// staying safe does not depend on remembering that.
const escapeHtml = (text: string) =>
  String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

const stop = (message: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Google-Verbindung</title>` +
      `<body style="font-family:system-ui;background:#080C14;color:#fff;padding:32px">` +
      `<h1 style="font-size:20px">Google-Verbindung fehlgeschlagen</h1>` +
      `<p style="color:#8891A4">${escapeHtml(message)}</p></body>`,
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )

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
  const url = new URL(req.url)
  const route = url.pathname.split('/').filter(Boolean).pop()

  if (!config.ready) {
    return route === 'callback'
      ? stop('Die Google-Zugangsdaten sind auf dem Server nicht hinterlegt.')
      : fail('Google-Integration nicht konfiguriert.', 503)
  }

  // ── OAuth redirect target ────────────────────────────────────────────────
  if (route === 'callback') {
    const state = await verifyState(url.searchParams.get('state') ?? '', config.stateSecret)
    if (!state?.user_id) return stop('Die Anfrage ist abgelaufen oder ungültig.')

    const allowed = config.appRedirects.length ? config.appRedirects : []
    const target =
      state.redirect && isAllowedRedirect(state.redirect, allowed) ? state.redirect : null
    if (!target) {
      return stop('Die Rücksprungadresse ist nicht freigegeben (GOOGLE_APP_REDIRECTS).')
    }

    // The user said no, or closed the consent screen. Not an error — just a
    // decision, and the app says so instead of showing a failure.
    const denied = url.searchParams.get('error')
    if (denied) return backToApp(target, { google: 'abgebrochen' })

    const code = url.searchParams.get('code')
    if (!code) return backToApp(target, { google: 'fehler' })

    try {
      const tokens = await exchangeCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: callbackUrl(),
      })
      if (!tokens.refresh_token) {
        // Without one the connection would stop working within the hour.
        // `prompt=consent` is meant to prevent this; if it still happens the
        // honest answer is to ask again rather than to store half a connection.
        return backToApp(target, { google: 'fehler' })
      }

      const { email, sub } = emailFromIdToken(tokens.id_token)

      await store.saveCredentials(state.user_id, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        token_type: tokens.token_type,
        scopes: tokens.scopes,
      })
      await store.upsertConnection(state.user_id, {
        google_account_email: email,
        google_account_sub: sub,
        status: 'connected',
        scopes: tokens.scopes,
        last_error: null,
      })

      const google = await clientFor(state.user_id)
      if (google) {
        const known = await store.listCalendars(state.user_id)
        await refreshCalendars(
          { google, store, now: Date.now },
          { userId: state.user_id, firstConnection: known.length === 0 }
        )
        // The first import runs here, so the calendar has something in it by
        // the time the browser lands back on the app.
        await runSync(
          { google, store, now: Date.now, randomId },
          {
            userId: state.user_id,
            userTimeZone: await store.getTimeZone(state.user_id),
            pushAddress: config.pushAddress,
          }
        ).catch((error) => console.error('initial sync', error))
      }

      return backToApp(target, { google: 'verbunden' })
    } catch (error) {
      console.error('google callback', error)
      return backToApp(target, { google: 'fehler' })
    }
  }

  // ── Google push notification ─────────────────────────────────────────────
  // The body is empty by design: a notification says "something in this
  // resource changed", never what. So this verifies the channel, then runs the
  // normal incremental sync, which writes to Supabase — and the app's existing
  // Realtime subscription carries it to every open device from there.
  if (route === 'push') {
    const channelId = req.headers.get('X-Goog-Channel-ID') ?? ''
    const token = req.headers.get('X-Goog-Channel-Token') ?? ''
    const state = req.headers.get('X-Goog-Resource-State') ?? ''

    // Google sends one of these the moment a channel is opened. Nothing has
    // changed yet, so a sync would be pure noise.
    if (state === 'sync') return new Response(null, { status: 200 })

    const channel = channelId ? await store.findChannel(channelId) : null
    // Constant-shape answer either way: a probe must not be able to tell a
    // real channel id from an invented one.
    if (!channel || !token || channel.token !== token) {
      return new Response(null, { status: 200 })
    }

    try {
      const google = await clientFor(channel.user_id)
      if (google) {
        await runSync(
          { google, store, now: Date.now, randomId },
          {
            userId: channel.user_id,
            userTimeZone: await store.getTimeZone(channel.user_id),
            pushAddress: config.pushAddress,
            calendarIds: [channel.google_calendar_id],
          }
        )
      }
    } catch (error) {
      console.error('google push', error)
      if (error instanceof GoogleError && error.needsReauth) {
        await store
          .updateConnection(channel.user_id, {
            status: 'needs_reauth',
            last_error: 'Google-Verbindung abgelaufen.',
          })
          .catch(() => {})
      }
    }
    // Google retries anything that is not a 2xx, so a failure we have already
    // recorded is acknowledged rather than re-delivered in a loop.
    return new Response(null, { status: 200 })
  }

  return fail('Unbekannter Endpunkt.', 404)
})
