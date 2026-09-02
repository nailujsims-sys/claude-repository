import { Sparkles } from 'lucide-react'

// The shared vocabulary of the three screens that exist before there is a
// session — Login, "Passwort vergessen" and "Neues Passwort". One place, so
// they cannot drift apart, and so the app already looks like itself before the
// user is inside it.

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-accent/15 text-accent">
          <Sparkles size={26} />
        </div>
        <h1 className="mt-4 text-[26px] font-bold text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-ui text-text-secondary">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function AuthField({ label, ...props }) {
  return (
    <input
      aria-label={label}
      placeholder={label}
      className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
      {...props}
    />
  )
}

// Feedback belongs to the field it is about, so it sits between the inputs and
// the button rather than at the bottom of the screen. `role="status"` for the
// good news, `role="alert"` for the bad, so both are announced.
export function AuthNote({ tone = 'error', children }) {
  if (!children) return null
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`text-label ${tone === 'error' ? 'text-danger' : 'text-success'}`}
    >
      {children}
    </p>
  )
}

export function AuthSubmit({ busy, disabled, children, busyLabel }) {
  const dead = busy || disabled
  return (
    <button
      type="submit"
      disabled={dead}
      className={`press-tint w-full rounded-btn py-3.5 text-body font-semibold ${
        dead ? 'bg-bg-input text-text-muted' : 'bg-accent text-white'
      }`}
    >
      {busy ? busyLabel : children}
    </button>
  )
}

// A quiet, full-width text action — "Passwort vergessen?" and its way back.
export function AuthLink({ children, ...props }) {
  return (
    <button
      type="button"
      className="press-fade w-full py-1 text-label text-text-secondary"
      {...props}
    >
      {children}
    </button>
  )
}
