import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { googleRepository } from '../data/googleRepository'
import { applyRealtimeChange, mergeRows } from '../lib/realtimeSync'
import { useRealtimeSync } from '../lib/useRealtimeSync'
import { useAuth } from './AuthContext'
import {
  AUTO_SYNC_INTERVAL_MS,
  applyConnectionChange,
  defaultCalendarFor,
  selectableCalendars,
  shouldClientAutoSync,
} from '../lib/googleCalendar'

const GoogleContext = createContext(null)

// The Google connection as the app sees it: which account, which calendars,
// and what the sync last did. Built exactly like TasksProvider and
// EventsProvider — same repository shape, same Realtime hook, same silent
// resync after a reconnect — so the settings screen is live for the same
// reason the calendar is, and there is one sync mechanism in the app, not two.
//
// Nothing here ever holds a Google token. The two tables it reads do not have
// one, and every action is a call to the Edge Function that does.
export function GoogleProvider({ children }) {
  const { user } = useAuth()

  const [connection, setConnection] = useState(null)
  const [calendars, setCalendars] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // 'sync' | 'connect' | 'disconnect' | calendar id
  const [error, setError] = useState(null)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const [row, list] = await Promise.all([
          googleRepository.getConnection(user.id),
          googleRepository.listCalendars(user.id),
        ])
        setConnection(row)
        setCalendars((prev) => (silent ? mergeRows(prev, list) : list))
        setError(null)
      } catch (err) {
        console.error(err)
        // A missing integration is not a broken app: the calendar and the
        // tasks keep working, and only this screen says something is wrong.
        setError(err)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [user]
  )

  useEffect(() => {
    load()
  }, [load])

  // `google_connections` is keyed by `user_id`, so it needs the reducer written
  // for that key rather than the id-keyed one every other table uses — see
  // lib/googleCalendar.js. Getting this wrong is invisible until somebody
  // disconnects on one device and the other keeps saying "Verbunden".
  const onConnectionChange = useCallback(
    (payload) => setConnection((prev) => applyConnectionChange(prev, payload, user?.id)),
    [user]
  )
  const applyCalendarChange = useCallback(
    (payload) => setCalendars((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )
  const resync = useCallback(() => load({ silent: true }), [load])

  // A sync that finishes on the phone updates the Mac's settings screen on its
  // own — the same guarantee the calendar already gives.
  useRealtimeSync({
    table: 'google_connections',
    userId: user?.id ?? null,
    onChange: onConnectionChange,
    onResync: resync,
  })
  useRealtimeSync({
    table: 'google_calendars',
    userId: user?.id ?? null,
    onChange: applyCalendarChange,
    onResync: resync,
  })

  // ── Der automatische Lauf, solange die App offen ist ──────────────────────
  //
  // Der eigentliche 5-Minuten-Takt läuft auf dem Server (pg_cron →
  // `google-api` → `sync-all`, siehe Migration 0007) und braucht kein offenes
  // Fenster. Dieser Timer ist das Netz darunter: er ruft dieselbe Function mit
  // derselben Sync-Logik auf und sorgt dafür, dass ein geöffnetes Gerät auch
  // dann im Takt bleibt, wenn der Zeitplan in der Datenbank (noch) nicht
  // eingerichtet ist.
  //
  // Bewusst still: kein `busy`, kein `error`, kein Toast. Ein automatischer
  // Lauf, der scheitert, darf weder die Ansicht blockieren noch den Nutzer
  // unterbrechen — was schiefging, steht danach ohnehin an der Verbindung, wo
  // der Bildschirm es bereits anzeigt. Und weil der Server jeden zu frühen und
  // jeden gleichzeitigen Lauf ablehnt, kann auch ein Dutzend offener Tabs
  // nicht mehr als einen Lauf je Takt auslösen.
  const connectionRef = useRef(null)
  const busyRef = useRef(null)
  const lastAttemptRef = useRef(0)
  connectionRef.current = connection
  busyRef.current = busy

  useEffect(() => {
    if (!user) return undefined

    const tick = async () => {
      const now = Date.now()
      if (
        !shouldClientAutoSync(
          {
            connection: connectionRef.current,
            visible:
              typeof document === 'undefined' || document.visibilityState === 'visible',
            busy: !!busyRef.current,
            lastAttemptAt: lastAttemptRef.current,
          },
          now
        )
      ) {
        return
      }
      lastAttemptRef.current = now
      try {
        await googleRepository.autoSync()
      } catch (err) {
        // Nur fürs Log. Der Bildschirm bleibt, wie er ist.
        console.warn('Automatischer Google-Sync fehlgeschlagen', err)
      }
      await load({ silent: true })
    }

    const timer = setInterval(tick, AUTO_SYNC_INTERVAL_MS)
    // Ein Gerät, das eine Stunde in der Tasche war, soll beim Aufwachen nicht
    // erst die nächsten fünf Minuten abwarten.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user, load])

  // Every action goes through here: one busy flag, one error surface, one
  // reload afterwards, so no screen has to remember to do any of it.
  const run = useCallback(
    async (key, work) => {
      setBusy(key)
      setError(null)
      try {
        return await work()
      } catch (err) {
        console.error(err)
        setError(err)
        throw err
      } finally {
        setBusy(null)
        await load({ silent: true })
      }
    },
    [load]
  )

  const connect = useCallback(
    async (redirect) =>
      run('connect', async () => {
        const url = await googleRepository.startConnect(redirect)
        if (!url) throw new Error('Google-Anmeldung konnte nicht gestartet werden.')
        // A full navigation, not a popup: the consent screen is Google's page
        // and blocking a popup is the most common way this flow dies.
        window.location.assign(url)
        return url
      }),
    [run]
  )

  const disconnect = useCallback(
    () => run('disconnect', () => googleRepository.disconnect()),
    [run]
  )
  const syncNow = useCallback(() => run('sync', () => googleRepository.sync()), [run])
  const refreshCalendars = useCallback(
    () => run('calendars', () => googleRepository.refreshCalendars()),
    [run]
  )
  const setCalendarSelected = useCallback(
    (id, selected) => run(id, () => googleRepository.setCalendarSelected(id, selected)),
    [run]
  )
  const setDefaultCalendar = useCallback(
    (id) => run('default', () => googleRepository.setDefaultCalendar(id)),
    [run]
  )

  const connected = !!connection
  const usableCalendars = useMemo(() => selectableCalendars(calendars), [calendars])
  const defaultCalendar = useMemo(
    () => defaultCalendarFor(calendars, connection),
    [calendars, connection]
  )

  const value = useMemo(
    () => ({
      connection,
      calendars,
      usableCalendars,
      defaultCalendar,
      connected,
      // The form only offers the sync switch when there is somewhere for it to
      // sync *to*; a connection without a writable calendar is not one.
      canSync: connected && usableCalendars.length > 0,
      loading,
      busy,
      error,
      reload: load,
      connect,
      disconnect,
      syncNow,
      refreshCalendars,
      setCalendarSelected,
      setDefaultCalendar,
    }),
    [
      connection,
      calendars,
      usableCalendars,
      defaultCalendar,
      connected,
      loading,
      busy,
      error,
      load,
      connect,
      disconnect,
      syncNow,
      refreshCalendars,
      setCalendarSelected,
      setDefaultCalendar,
    ]
  )

  return <GoogleContext.Provider value={value}>{children}</GoogleContext.Provider>
}

export function useGoogle() {
  const ctx = useContext(GoogleContext)
  if (!ctx) throw new Error('useGoogle must be used within GoogleProvider')
  return ctx
}
