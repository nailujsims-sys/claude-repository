// Pure auth helpers — no Supabase import, so they are unit-testable and the
// gate's logic can be read in one place (see tools/authLogic.mjs).

// Which screen the app owes the user right now. One function rather than a
// chain of ternaries in App.jsx, because "what may be rendered before there is
// a session" is a security decision, not a layout detail.
//
//   backend-missing → the build has no Supabase project; nothing may be stored
//   loading         → we do not know yet whether there is a session
//   recovery        → came back from a password-reset mail, must set a password
//   login           → no session
//   app             → signed in
export function resolveAuthPhase({ configured, status, user, recovery }) {
  if (!configured) return 'backend-missing'
  if (status === 'loading') return 'loading'
  if (!user) return 'login'
  if (recovery) return 'recovery'
  return 'app'
}

// The password-reset mail returns to `…/?recovery=1`. A query parameter, not a
// fragment: the app runs under a hash router, and two parties writing the same
// fragment is how reset links quietly stop working.
export function isRecoveryReturn(search = '') {
  return new URLSearchParams(search).get('recovery') === '1'
}

// Strips the marker once it has been acted on, so a reload does not put the
// user back into "set a new password".
export function urlWithoutRecoveryMarker(href) {
  const url = new URL(href)
  url.searchParams.delete('recovery')
  return url.toString()
}

// Supabase speaks English and in codes. The user gets one sentence that says
// what happened and what to do — never a raw API message, which would leak
// implementation detail and read as broken.
export function authErrorMessage(error) {
  if (!error) return ''
  const code = error.code || ''
  const message = (error.message || '').toLowerCase()

  if (code === 'invalid_credentials' || message.includes('invalid login credentials'))
    return 'E-Mail oder Passwort stimmt nicht.'
  if (code === 'email_not_confirmed' || message.includes('email not confirmed'))
    return 'Diese E-Mail ist noch nicht bestätigt. Bitte zuerst den Link in der Bestätigungsmail öffnen.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || message.includes('rate limit'))
    return 'Zu viele Versuche. Bitte warte einen Moment und versuch es dann noch einmal.'
  if (code === 'same_password' || message.includes('should be different from the old password'))
    return 'Das neue Passwort muss sich vom alten unterscheiden.'
  if (code === 'weak_password' || message.includes('password should be at least'))
    return 'Das Passwort ist zu kurz — mindestens 8 Zeichen.'
  if (code === 'session_not_found' || message.includes('auth session missing'))
    return 'Die Sitzung ist abgelaufen. Bitte melde dich neu an.'
  if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('load failed'))
    return 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.'
  return 'Das hat nicht geklappt. Bitte versuch es noch einmal.'
}

// The one rule the client can check before spending a round trip. Supabase
// enforces its own minimum server-side; this only spares the user the trip.
export const MIN_PASSWORD_LENGTH = 8

export function passwordProblem(password, repeat) {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`
  if (repeat !== undefined && password !== repeat)
    return 'Die beiden Passwörter sind nicht gleich.'
  return ''
}

// What the app calls the signed-in person. The profile wins; the email's local
// part is the fallback so the greeting never reads "Hallo undefined".
export function displayNameFor(profile, user) {
  const fromProfile = profile?.display_name?.trim()
  if (fromProfile) return fromProfile
  // "julian.simsheuser@…" is a mailbox, not a name — the first segment is the
  // part a person would actually answer to.
  const first = (user?.email || '').split('@')[0].split(/[._+-]/)[0]
  if (!first) return 'Willkommen'
  return first.charAt(0).toUpperCase() + first.slice(1)
}
