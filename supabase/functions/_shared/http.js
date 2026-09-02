// Small shared HTTP bits: JSON responses, CORS, and the environment check.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })

// An error the client may see. Deliberately short and free of internals: the
// details go to the function log, not to a browser.
export const fail = (message, status = 400, extra = {}) =>
  json({ error: message, ...extra }, status)

export const preflight = () => new Response('ok', { headers: CORS_HEADERS })

// The Google credentials this deployment was given. Missing configuration is
// a clear, actionable answer rather than a stack trace — the functions can be
// deployed before the Google Cloud project exists, and say so until it does.
export function googleConfig(env) {
  const clientId = env.get('GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const stateSecret = env.get('GOOGLE_STATE_SECRET') ?? ''
  const missing = []
  if (!clientId) missing.push('GOOGLE_CLIENT_ID')
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET')
  if (!stateSecret) missing.push('GOOGLE_STATE_SECRET')
  return {
    clientId,
    clientSecret,
    stateSecret,
    appRedirects: (env.get('GOOGLE_APP_REDIRECTS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pushAddress: env.get('GOOGLE_PUSH_ENDPOINT') ?? '',
    ready: missing.length === 0,
    missing,
  }
}
