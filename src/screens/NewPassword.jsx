import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage, passwordProblem } from '../lib/auth'
import { AuthShell, AuthField, AuthNote, AuthSubmit } from '../components/AuthForm'

// Where the reset mail lands. The link already signed the user in, so this is
// the one screen between them and the app: set a password, then continue.
export default function NewPassword() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const problem = password || repeat ? passwordProblem(password, repeat) : ''

  const submit = async (e) => {
    e.preventDefault()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    const { error } = await updatePassword(password)
    if (error) setError(authErrorMessage(error))
    setBusy(false)
  }

  return (
    <AuthShell title="Neues Passwort" subtitle="Danach geht es direkt weiter">
      <form onSubmit={submit} className="space-y-3">
        <AuthField
          type="password"
          autoComplete="new-password"
          label="Neues Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthField
          type="password"
          autoComplete="new-password"
          label="Passwort wiederholen"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />

        <AuthNote>{error || problem}</AuthNote>

        <AuthSubmit busy={busy} disabled={!password || !repeat || Boolean(problem)} busyLabel="Speichern…">
          Passwort speichern
        </AuthSubmit>
      </form>
    </AuthShell>
  )
}
