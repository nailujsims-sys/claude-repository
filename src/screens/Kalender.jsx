import { Menu, CalendarDays } from 'lucide-react'
import { useUI } from '../context/UIContext'

// Placeholder module — navigation target only for now.
export default function Kalender() {
  const { openSidebar } = useUI()
  return (
    <div className="min-h-screen px-5 pt-5 pb-28">
      <header className="flex items-center gap-2">
        <button onClick={openSidebar} aria-label="Menü öffnen" className="-ml-1 p-1 text-text-primary">
          <Menu size={26} />
        </button>
        <h1 className="text-[28px] font-bold text-text-primary">Kalender</h1>
      </header>

      <div className="flex flex-col items-center justify-center pt-40 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-card bg-bg-card text-text-secondary">
          <CalendarDays size={30} />
        </div>
        <p className="mt-4 text-[18px] font-bold text-text-primary">Kalender</p>
        <p className="mt-1 text-[14px] text-text-secondary">Kommt bald</p>
      </div>
    </div>
  )
}
