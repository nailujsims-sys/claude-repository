// The Google client. Everything that talks to Google goes through here, so
// there is one place that knows about token refresh, about which errors are
// worth retrying, and about which are the user's problem to solve.
//
// It is constructed with a `fetch`, which is what lets tools/googleSyncLogic.mjs
// drive the whole sync against a fake Google without a network.

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const PEOPLE_API = 'https://people.googleapis.com/v1'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

// What connecting a calendar asks for, and nothing beyond it:
//   calendar.calendarlist.readonly — which calendars exist, their colours and
//                                    the access role that decides writability
//   calendar.events               — read and write events (not calendar
//                                    settings, not sharing, not deleting
//                                    calendars)
//   openid, email                 — to show which account is connected
//
// `contacts` is deliberately NOT in here. It used to be, so that a birthday
// could be written back to the contact Google actually keeps it in — but that
// made access to the user's whole address book a condition of using the
// calendar at all. Anyone who declined it ended up with a grant that was
// missing scopes and a connection that failed on its first request.
//
// Reading birthdays never needed it: the birthday calendar comes over
// `calendar.events` like any other. Only *editing* one does, and that is its
// own feature with its own consent screen — see BIRTHDAY_SCOPES.
export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts'

// The set a future "Geburtstage in Google bearbeiten" switch will ask for: the
// calendar scopes the connection already has, plus contacts. Kept next to
// SCOPES so it is obvious that the address book was parked, not lost — and so
// that turning it on later is one named constant rather than a rediscovery.
export const BIRTHDAY_SCOPES = [...SCOPES, CONTACTS_SCOPE]

// Without these two there is no calendar to speak of. Google lets the user
// untick individual permissions on the consent screen, and the token comes
// back regardless — only the granted `scope` string says what actually
// happened. Checking it at the door turns a later, unreadable
// "Request had insufficient authentication scopes" into a specific sentence
// about the permission that is missing.
export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

export function missingScopes(granted, required = REQUIRED_SCOPES) {
  const have = new Set(String(granted ?? '').split(/\s+/).filter(Boolean))
  return required.filter((scope) => !have.has(scope))
}

// An error we can name, so the UI can say something better than "Fehler".
export class GoogleError extends Error {
  constructor(message, { status = 0, reason = null, retryable = false, needsReauth = false } = {}) {
    super(message)
    this.name = 'GoogleError'
    this.status = status
    this.reason = reason
    this.retryable = retryable
    this.needsReauth = needsReauth
  }
}

// 429 and 5xx are Google having a moment — the same request will work later,
// and the run reports itself as partial instead of throwing data away.
// 403 is only retryable for the two quota reasons; a 403 for "you may not
// write to this calendar" would retry forever.
const RETRY_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'])

function classify(status, payload) {
  const error = payload?.error
  const reason =
    (Array.isArray(error?.errors) && error.errors[0]?.reason) || error?.status || null
  const message = error?.message || payload?.error_description || `Google API ${status}`
  if (status === 401) {
    return new GoogleError(message, { status, reason, needsReauth: true })
  }
  if (status === 429 || status >= 500) {
    return new GoogleError(message, { status, reason, retryable: true })
  }
  if (status === 403 && RETRY_REASONS.has(reason)) {
    return new GoogleError(message, { status, reason, retryable: true })
  }
  return new GoogleError(message, { status, reason })
}

export const consentUrl = ({ clientId, redirectUri, state, scopes = SCOPES }) => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    // `offline` is what produces a refresh token — without it the connection
    // would die an hour after it was made. `consent` forces Google to issue a
    // *new* refresh token even on a re-grant, which is what makes reconnecting
    // after a revoked token actually fix anything.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export function createGoogleClient({
  fetch: fetchImpl = globalThis.fetch,
  clientId,
  clientSecret,
  credentials,          // { access_token, refresh_token, expires_at, scopes }
  onTokenRefresh = null,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxRetries = 3,
}) {
  let tokens = { ...credentials }

  const hasScope = (scope) => String(tokens.scopes || '').split(/\s+/).includes(scope)

  async function refresh() {
    if (!tokens.refresh_token) {
      throw new GoogleError('Kein Refresh-Token gespeichert.', { needsReauth: true })
    }
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      // `invalid_grant` means the user revoked access, changed their password,
      // or the token simply aged out. No amount of retrying fixes it — the
      // only cure is a new consent, so the connection is marked and the UI
      // asks for one.
      const needsReauth = payload?.error === 'invalid_grant' || response.status === 400
      throw new GoogleError(payload?.error_description || 'Token-Refresh fehlgeschlagen.', {
        status: response.status,
        reason: payload?.error ?? null,
        needsReauth,
        retryable: !needsReauth && response.status >= 500,
      })
    }
    tokens = {
      ...tokens,
      access_token: payload.access_token,
      // Google only returns a refresh token on the first grant; keeping the
      // old one is not an optimisation, it is the difference between a
      // connection that survives an hour and one that survives.
      refresh_token: payload.refresh_token || tokens.refresh_token,
      expires_at: new Date(now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      scopes: payload.scope || tokens.scopes,
    }
    await onTokenRefresh?.(tokens)
    return tokens.access_token
  }

  // 60 seconds of slack: a token that expires while the request is in flight
  // is a 401 we can avoid having at all.
  async function accessToken() {
    const expiresAt = tokens.expires_at ? Date.parse(tokens.expires_at) : 0
    if (!tokens.access_token || !expiresAt || expiresAt - 60000 <= now()) return refresh()
    return tokens.access_token
  }

  async function request(url, { method = 'GET', body, headers = {}, retryOn412 = false } = {}) {
    let attempt = 0
    let refreshedOnce = false

    for (;;) {
      const token = await accessToken()
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      if (response.status === 204) return null
      const text = await response.text()
      const payload = text ? safeJson(text) : null

      if (response.ok) return payload

      // One expired-token retry: refresh and try again exactly once, so a
      // token that died mid-run costs a round trip and not the run.
      if (response.status === 401 && !refreshedOnce) {
        refreshedOnce = true
        tokens = { ...tokens, expires_at: null }
        continue
      }

      // 412 is "somebody else changed this event" — the caller decides,
      // because only it knows which version is newer.
      if (response.status === 412 && retryOn412) {
        throw new GoogleError('Etag stimmt nicht mehr.', { status: 412, reason: 'conditionNotMet' })
      }

      const error = classify(response.status, payload)
      if (error.retryable && attempt < maxRetries) {
        attempt += 1
        // Exponential, and jittered so several calendars failing at once do
        // not all come back in the same millisecond.
        await sleep(Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100))
        continue
      }
      throw error
    }
  }

  const qs = (params) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      search.set(key, String(value))
    }
    const text = search.toString()
    return text ? `?${text}` : ''
  }

  return {
    get tokens() {
      return tokens
    },
    hasScope,
    refresh,

    // The connected account, for the settings screen. `openid email` gives us
    // this without pulling in a profile scope we do not need.
    async userInfo() {
      return request('https://openidconnect.googleapis.com/v1/userinfo')
    },

    async calendarList() {
      const items = []
      let pageToken
      do {
        const page = await request(`${CALENDAR_API}/users/me/calendarList${qs({ pageToken, maxResults: 250 })}`)
        items.push(...(page?.items ?? []))
        pageToken = page?.nextPageToken
      } while (pageToken)
      return items
    },

    // One page at a time, because a sync token only becomes valid once the
    // *last* page has been read — stopping halfway and storing it would skip
    // everything in between on the next run.
    async listEvents(calendarId, params) {
      return request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${qs(params)}`)
    },

    async insertEvent(calendarId, body) {
      return request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        body,
      })
    },

    async patchEvent(calendarId, eventId, body, etag) {
      return request(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: 'PATCH',
          body,
          // Optimistic locking: Google rejects the write if the event changed
          // since we read it, and that rejection is what turns a silent
          // overwrite into a conflict we can resolve on the evidence.
          headers: etag ? { 'If-Match': etag } : {},
          retryOn412: !!etag,
        }
      )
    },

    async getEvent(calendarId, eventId) {
      return request(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      )
    },

    async deleteEvent(calendarId, eventId) {
      return request(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' }
      )
    },

    // ── Push notifications ────────────────────────────────────────────────
    async watch(calendarId, { id, address, token, ttlSeconds }) {
      return request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
        method: 'POST',
        body: { id, type: 'web_hook', address, token, params: { ttl: String(ttlSeconds) } },
      })
    },

    async stopChannel({ id, resourceId }) {
      return request(`${CALENDAR_API}/channels/stop`, { method: 'POST', body: { id, resourceId } })
    },

    // ── People API — the only way to change a birthday ────────────────────
    // A Google birthday is a field on a contact; the calendar entry is a
    // rendering of it. Writing to the calendar would be rejected, so the
    // contact is read (for its etag, which People API demands) and updated.
    async getContact(resourceName) {
      return request(
        `${PEOPLE_API}/${resourceName}${qs({ personFields: 'birthdays,names,metadata' })}`
      )
    },

    async updateContactBirthday(resourceName, etag, birthday) {
      return request(
        `${PEOPLE_API}/${resourceName}:updateContact${qs({ updatePersonFields: 'birthdays' })}`,
        { method: 'PATCH', body: { etag, birthdays: [{ date: birthday }] } }
      )
    },
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

// The code → tokens exchange. Separate from the client because it happens
// once, before there is a client to have.
export async function exchangeCode({
  fetch: fetchImpl = globalThis.fetch,
  clientId,
  clientSecret,
  code,
  redirectUri,
  now = () => Date.now(),
}) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new GoogleError(payload?.error_description || 'Code-Tausch fehlgeschlagen.', {
      status: response.status,
      reason: payload?.error ?? null,
    })
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? null,
    expires_at: new Date(now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    token_type: payload.token_type ?? 'Bearer',
    scopes: payload.scope ?? '',
    id_token: payload.id_token ?? null,
  }
}

// The email out of the id_token. Decoding is enough and verification is not
// needed: the token came straight back from Google's token endpoint over TLS,
// in a response to a request we made, and it is only ever used as a label.
export function emailFromIdToken(idToken) {
  if (typeof idToken !== 'string') return { email: null, sub: null }
  const parts = idToken.split('.')
  if (parts.length < 2) return { email: null, sub: null }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const claims = JSON.parse(json)
    return { email: claims.email ?? null, sub: claims.sub ?? null }
  } catch {
    return { email: null, sub: null }
  }
}
