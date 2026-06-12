import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Minimal email/password login. Only reached when Supabase is configured and
// no session exists. Julian is pre-created — there is no registration flow.
export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await signIn(email.trim(), password)
    if (error) setError('Anmeldung fehlgeschlagen. Bitte erneut versuchen.')
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-accent/15 text-accent">
          <Sparkles size={26} />
        </div>
        <h1 className="mt-4 text-[26px] font-bold text-text-primary">Mind Whiteboard</h1>
        <p className="mt-1 text-[14px] text-text-secondary">Willkommen zurück</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-Mail"
          className="w-full rounded-input bg-bg-input px-4 py-3.5 text-[16px] text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full rounded-input bg-bg-input px-4 py-3.5 text-[16px] text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className={`w-full rounded-btn py-3.5 text-[15px] font-semibold ${
            busy || !email || !password
              ? 'bg-bg-input text-text-muted'
              : 'bg-accent text-white'
          }`}
        >
          {busy ? 'Anmelden…' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
