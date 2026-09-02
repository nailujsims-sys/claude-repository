import { AlertTriangle } from 'lucide-react'
import { useTasks } from '../context/TasksContext'
import { useEvents } from '../context/EventsContext'

// One banner for the whole data layer. It used to watch tasks only, so a
// calendar that could not reach the database looked merely empty.
//
// It stays non-blocking on purpose: the screen keeps whatever it has, and the
// banner says why nothing new is arriving.
export default function ErrorBanner() {
  const { error: taskError } = useTasks()
  const { error: eventError } = useEvents()
  const error = taskError || eventError
  if (!error) return null

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div className="px-5 pt-2">
      <div
        role="alert"
        className="flex items-center gap-2 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-label text-danger"
      >
        <AlertTriangle size={16} className="shrink-0" />
        <span>
          {offline
            ? 'Keine Internetverbindung. Deine Daten liegen sicher in der Datenbank.'
            : 'Die Daten konnten nicht geladen werden. Bitte prüfe deine Verbindung.'}
        </span>
      </div>
    </div>
  )
}
