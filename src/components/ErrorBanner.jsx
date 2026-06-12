import { AlertTriangle } from 'lucide-react'
import { useTasks } from '../context/TasksContext'

// Non-blocking banner shown when the data layer (Supabase) errors.
export default function ErrorBanner() {
  const { error } = useTasks()
  if (!error) return null

  return (
    <div className="px-5 pt-2">
      <div className="flex items-center gap-2 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
        <AlertTriangle size={16} className="shrink-0" />
        <span>Verbindungsfehler. Bitte überprüfe deine Internetverbindung.</span>
      </div>
    </div>
  )
}
