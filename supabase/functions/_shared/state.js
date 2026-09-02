// The OAuth `state` parameter, signed so the callback can trust it.
//
// The callback is a public endpoint — the browser arrives there straight from
// Google, carrying no session. The only thing that says which account this
// grant belongs to is `state`, so `state` has to be unforgeable: it is a JSON
// payload with an HMAC-SHA256 signature over it, made with a server-side
// secret, and it expires. Without that, anyone could hand our callback a code
// of their own and attach their Google account to somebody else's app account.
//
// It also carries the return URL, which is checked against an allowlist by the
// callback — an open redirect on an OAuth endpoint is how tokens leak.

const encoder = new TextEncoder()

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromB64url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function key(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signState(payload, secret) {
  const body = b64url(encoder.encode(JSON.stringify(payload)))
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))
  return `${body}.${b64url(mac)}`
}

// Returns the payload, or null. Every failure returns the same null: a caller
// that could tell "bad signature" from "expired" would be an oracle.
export async function verifyState(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  let ok = false
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      fromB64url(signature),
      encoder.encode(body)
    )
  } catch {
    return null
  }
  if (!ok) return null

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (!payload.exp || payload.exp < now) return null
  return payload
}

// The return URL is only followed if it is one we already know. An OAuth
// callback that redirects wherever it is told is an open redirect, and this
// one carries a freshly established session state.
export function isAllowedRedirect(url, allowlist) {
  if (!url) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return false
  }
  return allowlist.some((allowed) => {
    let base
    try {
      base = new URL(allowed)
    } catch {
      return false
    }
    return base.origin === parsed.origin && parsed.pathname.startsWith(base.pathname)
  })
}
