import { useCallback, useMemo, useState } from 'react'
import { Menu, CalendarDays, Search, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { useEvents } from '../context/EventsContext'
import { useTasks } from '../context/TasksContext'
import {
  MONTHS_DE,
  WEEKDAYS_DE,
  WEEKDAYS_DE_LONG,
  weekdayMon,
  startOfDay,
  addDays,
  startOfISOWeek,
  getISOWeek,
  toISODate,
  isToday,
  isInCurrentWeek,
  isSameDay,
  formatLongDate,
  formatWeekRangeWithYear,
} from '../lib/date'
import { eventStart, eventEnd, eventRangeLabel, eventDisplayTitle } from '../lib/calendar'
import { searchEvents } from '../lib/eventSearch'
import DayView from './calendar/DayView'
import WeekView from './calendar/WeekView'
import MonthView from './calendar/MonthView'
import EventDetailSheet from '../components/EventDetailSheet'
import { useSwipe } from './calendar/useSwipe'

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

  const [view, setView] = useState('day')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [dir, setDir] = useState(0) // -1 / +1: direction of the last period change (for the slide)
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

  // Move one period back (-1) or forward (+1); works for every view. Used by both
  // the arrows and the swipe gesture, and records the direction for the anim.
  const go = useCallback(
    (d) => {
      setDir(d)
      setAnchor((cur) => {
        if (view === 'day') return addDays(cur, d)
        if (view === 'week') return addDays(cur, d * 7)
        return new Date(cur.getFullYear(), cur.getMonth() + d, 1)
      })
    },
    [view]
  )

  const goToday = useCallback(() => {
    setDir(0)
    setAnchor(startOfDay(new Date()))
  }, [])

  const switchView = useCallback((id) => {
    setDir(0)
    setView(id)
  }, [])

  const selectDay = useCallback((day) => {
    setDir(0)
    setAnchor(startOfDay(day))
    setView('day')
  }, [])

  const selectEvent = useCallback((ev) => setSelectedEvent(ev), [])

  const swipe = useSwipe(go)

  // Is the current anchor showing the real "today" period? Drives the Heute
  // button accent (it lights up only when tapping it would actually move you).
  const now = new Date()
  const viewingToday =
    view === 'day'
      ? isToday(toISODate(anchor))
      : view === 'week'
        ? isInCurrentWeek(toISODate(anchor))
        : anchor.getFullYear() === now.getFullYear() && anchor.getMonth() === now.getMonth()

  // Key changes whenever the shown period changes → the wrapper remounts and
  // replays the directional slide.
  const periodKey =
    view === 'day'
      ? toISODate(anchor)
      : view === 'week'
        ? toISODate(monday)
        : `${anchor.getFullYear()}-${anchor.getMonth()}`
  const animClass = dir > 0 ? 'cal-enter-next' : dir < 0 ? 'cal-enter-prev' : ''

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
        <button
          onClick={goToday}
          aria-label="Heute"
          className={`p-1 ${viewingToday ? 'text-text-secondary' : 'text-accent'}`}
        >
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
              onClick={() => switchView(v.id)}
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
            onClick={() => go(-1)}
            aria-label="Zurück"
            className="grid h-8 w-8 place-items-center rounded-chip text-text-secondary hover:bg-white/5"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Weiter"
            className="grid h-8 w-8 place-items-center rounded-chip text-text-secondary hover:bg-white/5"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Active view — wrapped so a period change slides in from its direction.
          Swipe left/right anywhere here navigates periods too. */}
      <div
        key={`${view}:${periodKey}`}
        className={`flex min-h-0 flex-1 flex-col ${animClass}`}
        onTouchStart={swipe.onTouchStart}
        onTouchEnd={swipe.onTouchEnd}
      >
        {view === 'day' && (
          <DayView date={anchor} events={events} tasks={tasks} onSelectEvent={selectEvent} />
        )}
        {view === 'week' && (
          <WeekView
            weekMonday={monday}
            events={events}
            tasks={tasks}
            onSelectEvent={selectEvent}
            onSelectDay={selectDay}
          />
        )}
        {view === 'month' && (
          <MonthView
            monthDate={anchor}
            events={events}
            tasks={tasks}
            onSelectDay={selectDay}
            onSelectEvent={selectEvent}
          />
        )}
      </div>

      {searchOpen && (
        <SearchOverlay
          events={events}
          onClose={() => setSearchOpen(false)}
          onOpenEvent={(ev) => {
            setSearchOpen(false)
            setSelectedEvent(ev)
          }}
        />
      )}
      <EventDetailSheet event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}

// Compact date + time labels for a search hit.
function hitDate(ev) {
  const s = eventStart(ev)
  if (!s) return ''
  return `${WEEKDAYS_DE[weekdayMon(s)]}, ${formatLongDate(s)}`
}
function hitTime(ev) {
  if (ev.is_birthday || ev.all_day) return 'Ganztägig'
  const s = eventStart(ev)
  const e = eventEnd(ev)
  if (s && e && !isSameDay(s, e)) return 'Mehrtägig'
  return eventRangeLabel(ev)
}

// Full-screen calendar search. Searches Titel / Ort / Notizen and reacts on every
// keystroke; each hit shows title, date and time and opens the event on tap.
function SearchOverlay({ events, onClose, onOpenEvent }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchEvents(events, query), [events, query])
  const trimmed = query.trim()

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Termine durchsuchen"
            className="flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-muted outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Suche leeren">
              <X size={16} className="text-text-muted" />
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!trimmed ? (
          <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-card bg-bg-card text-text-secondary">
              <Search size={26} />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-text-primary">Terminsuche</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Suche in Titel, Ort und Notizen.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
            <p className="text-[15px] font-semibold text-text-secondary">Keine Termine gefunden</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Für „{trimmed}“ gibt es keinen Treffer.
            </p>
          </div>
        ) : (
          <div className="mt-2 divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-bg-card">
            {results.map((ev) => (
              <button
                key={ev.id}
                onClick={() => onOpenEvent(ev)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-text-primary">
                    {eventDisplayTitle(ev)}
                  </p>
                  <p className="truncate text-[12px] text-text-secondary">{hitDate(ev)}</p>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-text-secondary">
                  {hitTime(ev)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
