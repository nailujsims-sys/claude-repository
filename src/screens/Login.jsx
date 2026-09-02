import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage } from '../lib/auth'
import { AuthShell, AuthField, AuthNote, AuthSubmit, AuthLink } from '../components/AuthForm'

// E-Mail + Passwort, plus the way out when the password is gone. Both live on
// one screen: it is the same task ("get me in"), so it stays one surface and
// swaps its middle rather than navigating somewhere else.
export default function Login() {
  const { signIn, requestPasswordReset } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const toReset = () => {
    setMode('reset')
    setError('')
    setSent(false)
  }
  const toLogin = () => {
    setMode('login')
    setError('')
    setSent(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    if (mode === 'login') {
      const { error } = await signIn(email.trim(), password)
      if (error) setError(authErrorMessage(error))
    } else {
      const { error } = await requestPasswordReset(email.trim())
      // Whether the address exists is not something a login screen may reveal —
      // the same answer either way, so the form cannot be used to find out who
      // has an account here.
      if (error && error.code === 'over_email_send_rate_limit') setError(authErrorMessage(error))
      else setSent(true)
    }
    setBusy(false)
  }

  const canSubmit = mode === 'login' ? Boolean(email && password) : Boolean(email)

  return (
    <AuthShell
      title="Mind Whiteboard"
      subtitle={mode === 'login' ? 'Willkommen zurück' : 'Passwort zurücksetzen'}
    >
      <form onSubmit={submit} className="space-y-3">
        <AuthField
          type="email"
          autoComplete="email"
          label="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === 'login' && (
          <AuthField
            type="password"
            autoComplete="current-password"
            label="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}

        <AuthNote>{error}</AuthNote>
        {mode === 'reset' && sent && !error && (
          <AuthNote tone="success">
            Wenn es zu dieser Adresse ein Konto gibt, ist der Link zum Zurücksetzen unterwegs.
          </AuthNote>
        )}

        <AuthSubmit busy={busy} disabled={!canSubmit} busyLabel={mode === 'login' ? 'Anmelden…' : 'Senden…'}>
          {mode === 'login' ? 'Anmelden' : 'Link senden'}
        </AuthSubmit>
      </form>

      <div className="mt-4">
        {mode === 'login' ? (
          <AuthLink onClick={toReset}>Passwort vergessen?</AuthLink>
        ) : (
          <AuthLink onClick={toLogin}>Zurück zur Anmeldung</AuthLink>
        )}
      </div>
    </AuthShell>
  )
}
