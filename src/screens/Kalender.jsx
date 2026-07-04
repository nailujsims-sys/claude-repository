import { useState } from 'react'
import { Menu, CalendarDays, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { useEvents } from '../context/EventsContext'
import { useTasks } from '../context/TasksContext'
import { useNow } from '../lib/useNow'
import {
  MONTHS_DE,
  WEEKDAYS_DE_LONG,
  weekdayMon,
  startOfDay,
  addDays,
  startOfISOWeek,
  getISOWeek,
  formatLongDate,
  formatWeekRangeWithYear,
} from '../lib/date'
import DayView from './calendar/DayView'
import WeekView from './calendar/WeekView'
import MonthView from './calendar/MonthView'
import EventDetailSheet from '../components/EventDetailSheet'

const VIEWS = [
  { id: 'day', label: 'Tag' },
  { id: 'week', label: 'Woche' },
  { id: 'month', label: 'Monat' },
]

// The calendar module: a fixed-height shell (header + view switch) hosting the
// three views, which each manage their own internal scrolling. Events come from
// EventsContext; tasks are reused from TasksContext (no duplicate data).
export default function Kalender() {
  const { openSidebar } = useUI()
  const { events } = useEvents()
  const { tasks } = useTasks()
  const now = useNow()

  const [view, setView] = useState('day')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const monday = startOfISOWeek(anchor)

  // Header period label + subtitle per view.
  let primary = ''
  let sub = ''
  if (view === 'day') {
    primary = formatLongDate(anchor)
    sub = WEEKDAYS_DE_LONG[weekdayMon(anchor)]
  } else if (view === 'week') {
    primary = formatWeekRangeWithYear(monday)
    sub = `KW ${getISOWeek(monday)}`
  } else {
    primary = `${MONTHS_DE[anchor.getMonth()]} ${anchor.getFullYear()}`
  }

  const step = (dir) => {
    if (view === 'day') setAnchor((d) => addDays(d, dir))
    else if (view === 'week') setAnchor((d) => addDays(d, dir * 7))
    else setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1))
  }

  const goToday = () => setAnchor(startOfDay(new Date()))

  const selectDay = (day) => {
    setAnchor(startOfDay(day))
    setView('day')
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ height: '100dvh', paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button onClick={openSidebar} aria-label="Menü öffnen" className="-ml-1 p-1 text-text-primary">
          <Menu size={26} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[19px] font-bold leading-tight text-text-primary">
            {primary}
          </h1>
          {sub && <p className="truncate text-[12px] text-text-secondary">{sub}</p>}
        </div>
        <button onClick={goToday} aria-label="Heute" className="p-1 text-text-primary">
          <CalendarDays size={22} />
        </button>
        <button onClick={() => setSearchOpen(true)} aria-label="Suche" className="p-1 text-text-primary">
          <Search size={22} />
        </button>
      </header>

      {/* View switch + period navigation */}
      <div className="flex items-center justify-between gap-2 px-4 pb-3">
        <div className="flex rounded-chip bg-bg-input p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-chip px-4 py-1.5 text-[13px] font-medium transition-colors ${
                view === v.id ? 'bg-accent text-white' : 'text-text-secondary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            aria-label="Zurück"
            className="grid h-8 w-8 place-items-center rounded-chip text-text-secondary hover:bg-white/5"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Weiter"
            className="grid h-8 w-8 place-items-center rounded-chip text-text-secondary hover:bg-white/5"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Active view */}
      {view === 'day' && (
        <DayView date={anchor} events={events} tasks={tasks} now={now} onSelectEvent={setSelectedEvent} />
      )}
      {view === 'week' && (
        <WeekView
          weekMonday={monday}
          events={events}
          tasks={tasks}
          now={now}
          onSelectEvent={setSelectedEvent}
          onSelectDay={selectDay}
        />
      )}
      {view === 'month' && (
        <MonthView
          monthDate={anchor}
          events={events}
          tasks={tasks}
          onSelectDay={selectDay}
          onSelectEvent={setSelectedEvent}
        />
      )}

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
      <EventDetailSheet event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}

// Placeholder search screen — reserves the navigation + layout; the actual
// search is a later milestone.
function SearchOverlay({ onClose }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-base animate-fade-in">
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button onClick={onClose} aria-label="Zurück" className="-ml-1 p-1 text-text-primary">
          <ChevronLeft size={24} />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-input bg-bg-input px-3 py-2">
          <Search size={16} className="text-text-muted" />
          <input
            autoFocus
            placeholder="Termine durchsuchen"
            className="flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-muted outline-none"
          />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-card bg-bg-card text-text-secondary">
          <Search size={26} />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-text-primary">Terminsuche</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          Die Suche wird bald verfügbar sein.
        </p>
      </div>
    </div>
  )
}
