import { Link } from 'react-router-dom'
import {
  User,
  Palette,
  Bell,
  Vibrate,
  Calendar,
  KeyRound,
  LogOut,
  ChevronRight,
  Lock,
} from 'lucide-react'
import TopBar from '../components/TopBar'
import { useAuth } from '../context/AuthContext'
import { useGoogle } from '../context/GoogleContext'
import { connectionStatusLabel } from '../lib/googleCalendar'

// Profil. The structure is the one the product settled on — Persönliche Daten,
// App, Integrationen, Konto — but only what Google Kalender actually needs is
// built: the integration row and Abmelden. Everything else is listed the way
// unbuilt modules are listed everywhere else in this app, greyed out with a
// lock, so the shape of the screen is honest about what works today.
export default function Profil() {
  const { displayName, email, signOut } = useAuth()
  const { connection } = useGoogle()

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Profil" />

      <div className="px-5">
        {/* Who is signed in. Read from the account, not editable here yet. */}
        <div className="mt-4 flex items-center gap-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-bg-elevated text-text-secondary">
            <User size={24} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-heading font-bold text-text-primary">{displayName}</p>
            <p className="truncate text-caption text-text-secondary">{email}</p>
          </div>
        </div>

        <Section title="Persönliche Daten">
          <SoonRow icon={User} label="Name und Profilbild" />
        </Section>

        <Section title="App">
          <SoonRow icon={Palette} label="Darstellung" />
          <SoonRow icon={Bell} label="Benachrichtigungen" />
          <SoonRow icon={Vibrate} label="Haptisches Feedback" last />
        </Section>

        <Section title="Integrationen">
          <Link
            to="/profil/google-kalender"
            className="press-tint flex items-center gap-3 px-4 py-4"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-bg-elevated text-text-secondary">
              <Calendar size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-text-primary">
                Google Kalender
              </span>
              <span className="block truncate text-caption text-text-secondary">
                {connection?.google_account_email || connectionStatusLabel(connection)}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-text-muted" />
          </Link>
        </Section>

        <Section title="Konto">
          <SoonRow icon={KeyRound} label="Passwort & Sicherheit" />
          <button
            onClick={signOut}
            className="press-tint flex w-full items-center gap-3 px-4 py-4 text-left"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-bg-elevated text-text-secondary">
              <LogOut size={18} />
            </span>
            <span className="flex-1 text-body font-medium text-text-primary">Abmelden</span>
          </button>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        {title}
      </h2>
      <div className="divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-bg-card">
        {children}
      </div>
    </section>
  )
}

// The same "Demnächst" treatment /mehr and the sidebar already use, so an
// unbuilt setting reads as unbuilt rather than as broken.
function SoonRow({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-bg-elevated text-text-muted">
        <Icon size={18} />
      </span>
      <span className="flex-1 text-body font-medium text-text-secondary">{label}</span>
      <span className="flex items-center gap-1 rounded-chip bg-bg-elevated px-2 py-0.5 text-meta font-semibold text-text-muted">
        <Lock size={11} /> Demnächst
      </span>
    </div>
  )
}
