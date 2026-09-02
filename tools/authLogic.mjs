// Pure-logic tests for the auth foundation, below the pixels.
//
// Three of these are security properties rather than conveniences, and each of
// them is a rule that used to be either absent or spread across components:
//
//   1. which screen may be rendered in which auth state — "no session" and "we
//      do not know yet" are different answers, and only one of them may show
//      the app;
//   2. that no module under src/ writes personal data into the browser, which
//      is the guarantee the whole change is about;
//   3. that Supabase's English error codes arrive as one readable German
//      sentence, and never as a raw API message.
//
// No bundling needed: src/lib/auth.js is plain ESM with no imports.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveAuthPhase,
  isRecoveryReturn,
  urlWithoutRecoveryMarker,
  authErrorMessage,
  passwordProblem,
  displayNameFor,
  MIN_PASSWORD_LENGTH,
} from '../src/lib/auth.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// ── 1. the gate ─────────────────────────────────────────────────────────────
{
  const phase = (over = {}) =>
    resolveAuthPhase({ configured: true, status: 'ready', user: null, recovery: false, ...over })

  ok('without a backend nothing else matters', phase({ configured: false, user: { id: 'x' } }) === 'backend-missing')
  ok('an unknown session waits instead of guessing', phase({ status: 'loading' }) === 'loading')
  // The distinction that keeps a reload from flashing the login screen.
  ok('"loading" is not "signed out"', phase({ status: 'loading' }) !== phase({ status: 'ready' }))
  ok('no user means the login screen', phase() === 'login')
  ok('a session reaches the app', phase({ user: { id: 'x' } }) === 'app')
  ok('a reset link stops at the new password', phase({ user: { id: 'x' }, recovery: true }) === 'recovery')
  // The one that matters most: recovery must never be a way in without a user.
  ok('a recovery marker alone opens nothing', phase({ recovery: true }) === 'login')

  const phases = new Set(['backend-missing', 'loading', 'login', 'recovery', 'app'])
  let covered = 0
  for (const configured of [true, false])
    for (const status of ['loading', 'ready'])
      for (const user of [null, { id: 'u' }])
        for (const recovery of [false, true])
          if (phases.has(resolveAuthPhase({ configured, status, user, recovery }))) covered++
  ok('every combination resolves to a known phase', covered === 16)
}

// ── 2. the reset link's marker ──────────────────────────────────────────────
{
  ok('the marker is recognised', isRecoveryReturn('?recovery=1'))
  ok('it survives other parameters', isRecoveryReturn('?foo=bar&recovery=1'))
  ok('nothing else counts', !isRecoveryReturn('?recovery=0') && !isRecoveryReturn(''))
  // A fragment is the router's; if it ever ends up carrying the marker, that
  // is the bug this parameter exists to avoid.
  ok('a hash is not a marker', !isRecoveryReturn('#recovery=1'))

  const cleaned = urlWithoutRecoveryMarker('https://x.test/app/?recovery=1&keep=2#/kalender')
  ok('the marker is dropped after use', !cleaned.includes('recovery'))
  ok('the rest of the URL survives', cleaned.includes('keep=2') && cleaned.includes('#/kalender'))
}

// ── 3. error messages ───────────────────────────────────────────────────────
{
  const msg = (error) => authErrorMessage(error)

  ok('a wrong password is named as such', msg({ code: 'invalid_credentials' }).includes('E-Mail oder Passwort'))
  ok('the message survives without a code', msg({ message: 'Invalid login credentials' }).includes('E-Mail oder Passwort'))
  ok('an unconfirmed address is explained', msg({ code: 'email_not_confirmed' }).includes('bestätigt'))
  ok('a rate limit asks for patience', msg({ code: 'over_email_send_rate_limit' }).includes('Zu viele Versuche'))
  ok('a dead connection is not a wrong password', msg({ message: 'Failed to fetch' }).includes('Verbindung'))
  ok('an expired session says to sign in again', msg({ code: 'session_not_found' }).includes('abgelaufen'))
  ok('no error, no message', msg(null) === '')

  // Nothing raw ever reaches the screen: an unknown error still gets a
  // sentence, and it is not the API's.
  const unknown = msg({ code: 'xyz_totally_new', message: 'PGRST999 something internal' })
  ok('an unknown error is still readable', unknown.length > 10 && !unknown.includes('PGRST'))

  for (const error of [{ code: 'invalid_credentials' }, { code: 'weak_password' }, { message: 'boom' }]) {
    const m = msg(error)
    ok(`"${error.code || error.message}" is one German sentence`, /[a-zäöüß]/.test(m) && m.endsWith('.'))
  }
}

// ── 4. password rules ───────────────────────────────────────────────────────
{
  ok('too short is refused', passwordProblem('kurz') !== '')
  ok(`${MIN_PASSWORD_LENGTH} characters are enough`, passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH)) === '')
  ok('a typo in the repeat is caught', passwordProblem('richtig-langes-pw', 'richtig-langes-pX') !== '')
  ok('two equal passwords pass', passwordProblem('richtig-langes-pw', 'richtig-langes-pw') === '')
}

// ── 5. the name the app greets ──────────────────────────────────────────────
{
  ok('the profile wins', displayNameFor({ display_name: 'Julian' }, { email: 'x@y.z' }) === 'Julian')
  ok('an empty profile name does not', displayNameFor({ display_name: '  ' }, { email: 'max@y.z' }) === 'Max')
  ok('a mailbox becomes a name', displayNameFor(null, { email: 'julian.simsheuser@gmail.com' }) === 'Julian')
  ok('nothing is still something', displayNameFor(null, null).length > 0)
}

// ── 6. no personal data in the browser ──────────────────────────────────────
// The rule the whole change rests on, checked against the source rather than
// trusted: if a module under src/ ever reaches for a browser store again, the
// app has quietly grown a second database and this test says so.
{
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(js|jsx)$/.test(entry)) {
        const body = readFileSync(path, 'utf8')
        // Comments are allowed to mention it — this is about calls.
        const code = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
        if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(code)) offenders.push(path)
      }
    }
  }
  walk('src')
  if (offenders.length) console.log('  ✗ browser storage used in: ' + offenders.join(', '))
  ok('no module under src/ touches browser storage', offenders.length === 0)

  // The one legitimate user of localStorage is supabase-js, holding the
  // session. It is configured in exactly one place, and it is persistent on
  // purpose — that is what survives a reload.
  const client = readFileSync('src/lib/supabase.js', 'utf8')
  ok('the session is persisted by the Supabase client', client.includes('persistSession: true'))
  ok('the client refreshes its own token', client.includes('autoRefreshToken: true'))
  // PKCE keeps the reset link out of the fragment the hash router owns.
  ok('the reset link comes back in the query string', client.includes("flowType: 'pkce'"))
}

console.log(`auth logic: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
