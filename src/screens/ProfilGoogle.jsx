import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft,
  RefreshCw,
  Check,
  AlertTriangle,
  Link2Off,
  Calendar,
} from 'lucide-react'
import TopBar from '../components/TopBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { useGoogle } from '../context/GoogleContext'
import { useToast } from '../context/ToastContext'
import {
  APP_EVENT_COLOR,
  calendarRoleLabel,
  canCreateEventsIn,
  connectionStatusLabel,
  connectionTone,
  lastSyncLabel,
  safeHexColor,
} from '../lib/googleCalendar'

// Profil → Integrationen → Google Kalender. Everything the connection needs:
// connect, see the account, choose which calendars sync, pick the default for
// new appointments, read the last sync, disconnect.
//
// It is built out of the components the rest of the app already uses — the
// TopBar, cards on `bg-bg-card` with `border-subtle`, the same toggle as the
// Termin-Dialog, ConfirmDialog for the one destructive action, and toasts for
// feedback — so it reads as the same product, not as a settings page bolted on.
export default function ProfilGoogle() {
  const {
    connection,
    calendars,
    connected,
    loading,
    busy,
    error,
    connect,
    disconnect,
    syncNow,
    refreshCalendars,
    setCalendarSelected,
    setDefaultCalendar,
  } = useGoogle()
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Was der letzte Verbindungsversuch ergeben hat. Ein Toast allein reicht
  // hier nicht: wenn das Verbinden scheitert, ist danach *nichts* verbunden,
  // und der Bildschirm sähe ohne diesen Hinweis aus wie beim allerersten
  // Öffnen — als hätte der Nutzer es nie versucht.
  const [attempt, setAttempt] = useState(null)

  // The Edge Function sends the browser back here with a plain marker — never
  // with a code or a token. The marker is read once and then removed, so a
  // reload does not repeat the toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('google')
    if (!result) return
    if (result === 'verbunden') {
      showToast('Google Kalender verbunden ✓')
      setAttempt(null)
    } else if (result === 'abgebrochen') {
      showToast('Google-Verbindung abgebrochen')
      setAttempt(null)
    } else {
      showToast('Google-Verbindung fehlgeschlagen')
      setAttempt(result)
    }
    params.delete('google')
    const search = params.toString()
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
    )
  }, [showToast])

  const handleConnect = async () => {
    setAttempt(null)
    try {
      // Where Google should send the browser back to. The Edge Function checks
      // it against its own allowlist before following it.
      await connect(`${window.location.origin}${window.location.pathname}#/profil/google-kalender`)
    } catch {
      // Surfaced below as the section's error line.
    }
  }

  const handleSync = async () => {
    try {
      await syncNow()
      showToast('Synchronisiert ✓')
    } catch {
      /* shown inline */
    }
  }

  const handleDisconnect = async () => {
    setConfirmOpen(false)
    try {
      await disconnect()
      showToast('Google-Verbindung getrennt')
    } catch {
      /* shown inline */
    }
  }

  const tone = connectionTone(connection)

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Google Kalender" />

      <div className="px-5">
        <Link
          to="/profil"
          className="press-fade -ml-1 mt-1 inline-flex items-center gap-1 text-ui text-text-secondary"
        >
          <ChevronLeft size={16} /> Profil
        </Link>

        {loading ? (
          <p className="mt-6 text-body text-text-secondary">Lädt…</p>
        ) : !connected ? (
          <NotConnected
            onConnect={handleConnect}
            busy={busy === 'connect'}
            problem={attempt}
          />
        ) : (
          <>
            {/* Konto + Zustand */}
            <section className="mt-4 rounded-card border border-subtle bg-bg-card px-4 py-4">
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                    tone === 'ok' ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'
                  }`}
                >
                  {tone === 'ok' ? <Check size={20} /> : <AlertTriangle size={20} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-text-primary">
                    {connection.google_account_email || 'Google-Konto'}
                  </p>
                  <p
                    className={`truncate text-caption ${
                      tone === 'danger' ? 'text-danger' : 'text-text-secondary'
                    }`}
                  >
                    {connectionStatusLabel(connection)}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-caption text-text-secondary">
                {lastSyncLabel(connection.last_sync_at)}
              </p>

              {connection.status === 'needs_reauth' && (
                <button
                  onClick={handleConnect}
                  disabled={busy === 'connect'}
                  className="press-tint mt-3 w-full rounded-btn bg-accent py-3 text-ui font-semibold text-white disabled:opacity-60"
                >
                  Verbindung erneuern
                </button>
              )}

              {/* One primary action across the full width, and the rarer one
                  as a quiet line under it. Side by side, both labels wrap onto
                  two lines inside a 390px frame, which reads as two competing
                  buttons; syncing is the action this screen is for, and
                  reloading the list is the exception. */}
              <button
                onClick={handleSync}
                disabled={!!busy}
                className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-2.5 text-ui font-semibold text-accent disabled:opacity-60"
              >
                <RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} />
                {busy === 'sync' ? 'Synchronisiert…' : 'Jetzt synchronisieren'}
              </button>
              <button
                onClick={refreshCalendars}
                disabled={!!busy}
                className="press-fade mt-2 w-full py-1.5 text-caption text-text-secondary disabled:opacity-60"
              >
                Kalenderliste neu laden
              </button>
            </section>

            {error && (
              <p className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-3 text-caption text-danger">
                {error.message}
              </p>
            )}

            {/* Standardkalender für neue Termine */}
            <Section title="Standardkalender für neue Termine">
              {calendars.filter((c) => c.is_selected && canCreateEventsIn(c)).length === 0 ? (
                <p className="px-4 py-4 text-caption text-text-secondary">
                  Aktiviere unten einen Kalender, in den geschrieben werden darf.
                </p>
              ) : (
                calendars
                  .filter((c) => c.is_selected && canCreateEventsIn(c))
                  .map((c) => {
                    const selected = connection.default_calendar_id === c.google_calendar_id
                    return (
                      <button
                        key={c.google_calendar_id}
                        onClick={() => setDefaultCalendar(c.google_calendar_id)}
                        disabled={!!busy}
                        className="press-tint flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:opacity-60"
                      >
                        <Dot color={c.background_color} />
                        <span
                          className={`flex-1 truncate text-body ${
                            selected ? 'font-medium text-accent' : 'text-text-primary'
                          }`}
                        >
                          {c.summary}
                        </span>
                        {selected && <Check size={18} className="shrink-0 text-accent" />}
                      </button>
                    )
                  })
              )}
            </Section>

            {/* Welche Kalender synchronisiert werden */}
            <Section title="Synchronisierte Kalender">
              {calendars.length === 0 ? (
                <p className="px-4 py-4 text-caption text-text-secondary">
                  Keine Kalender gefunden.
                </p>
              ) : (
                calendars.map((c) => (
                  <div key={c.google_calendar_id} className="flex items-center gap-3 px-4 py-3.5">
                    <Dot color={c.background_color} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-body ${
                          c.is_available ? 'text-text-primary' : 'text-text-muted'
                        }`}
                      >
                        {c.summary}
                      </span>
                      <span
                        className={`block truncate text-caption ${
                          c.last_error ? 'text-danger' : 'text-text-secondary'
                        }`}
                      >
                        {c.last_error || calendarRoleLabel(c)}
                      </span>
                    </span>
                    <Toggle
                      checked={c.is_selected}
                      disabled={!!busy || !c.is_available}
                      onChange={(v) => setCalendarSelected(c.google_calendar_id, v)}
                    />
                  </div>
                ))
              )}
            </Section>

            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!!busy}
              className="press-tint mt-6 flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-body font-semibold text-danger disabled:opacity-60"
              style={{ background: 'rgba(239, 68, 68, 0.12)' }}
            >
              <Link2Off size={18} /> Verbindung trennen
            </button>
          </>
        )}
      </div>

      {/* The one place a confirmation is warranted here: disconnecting is not
          undoable in one tap, and the dialog is what makes clear that it does
          *not* delete anything. */}
      <ConfirmDialog
        open={confirmOpen}
        title="Google-Verbindung trennen?"
        message="Die Synchronisierung wird beendet. Alle bereits vorhandenen Termine bleiben in dieser App erhalten und werden zu reinen App-Terminen."
        confirmLabel="Trennen"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
      />
    </div>
  )
}

// Was schiefgehen kann, in Sätzen, die sagen, was als Nächstes zu tun ist.
// Der Ton ist Absicht: nichts davon ist ein Fehler des Nutzers.
const CONNECT_PROBLEMS = {
  'rechte-fehlen': {
    title: 'Es fehlen Berechtigungen',
    body: 'Der Zugriff auf Kalender und Termine wurde bei Google nicht vollständig erlaubt. Beim nächsten Versuch bitte alle angezeigten Häkchen gesetzt lassen.',
  },
  'kalender-fehler': {
    title: 'Die Kalender konnten nicht geladen werden',
    body: 'Google hat die Verbindung bestätigt, aber keine Kalender geliefert. Der unvollständige Zugang wurde wieder entfernt — versuche es in einem Moment noch einmal.',
  },
}

function NotConnected({ onConnect, busy, problem = null }) {
  const trouble = CONNECT_PROBLEMS[problem] ?? (problem ? CONNECT_PROBLEMS['kalender-fehler'] : null)

  return (
    <section className="mt-4 rounded-card border border-subtle bg-bg-card px-4 py-6 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-bg-elevated text-text-secondary">
        <Calendar size={26} />
      </span>
      <h2 className="mt-4 text-section font-bold text-text-primary">
        Google Kalender verbinden
      </h2>
      <p className="mx-auto mt-2 max-w-[290px] text-caption leading-relaxed text-text-secondary">
        Termine aus Google erscheinen in dieser App, und Termine aus dieser App
        erscheinen in Google. Du wählst danach aus, welche Kalender
        synchronisiert werden.
      </p>

      {/* Bleibt stehen, bis es einen neuen Versuch gibt — anders als der
          Toast, der genau dann weg ist, wenn man ihn nachlesen möchte. */}
      {trouble && (
        <div
          role="status"
          className="mt-4 rounded-card border border-subtle px-4 py-3 text-left"
          style={{ background: 'rgba(239, 68, 68, 0.10)' }}
        >
          <p className="flex items-center gap-2 text-ui font-semibold text-danger">
            <AlertTriangle size={16} className="shrink-0" />
            {trouble.title}
          </p>
          <p className="mt-1 text-caption leading-relaxed text-text-secondary">
            {trouble.body}
          </p>
        </div>
      )}

      <button
        onClick={onConnect}
        disabled={busy}
        className="press-tint mt-5 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Wird geöffnet…' : trouble ? 'Erneut versuchen' : 'Mit Google verbinden'}
      </button>
    </section>
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

function Dot({ color }) {
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-full"
      style={{ background: safeHexColor(color) || APP_EVENT_COLOR }}
    />
  )
}

// The same switch as the Termin-Dialog: same size, same colours, same
// disabled treatment.
function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press-tint relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-input'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
