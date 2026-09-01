import { memo, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { isToday, toISODate, isOverdue } from '../../lib/date'
import {
  splitDayEvents,
  layoutTimedEvents,
  packBars,
  HOUR_HEIGHT,
  GRID_HEIGHT,
  nowTop,
} from '../../lib/calendar'
import { tasksForDay } from '../../lib/taskSelectors'
import { useTasks } from '../../context/TasksContext'
import { useEvents } from '../../context/EventsContext'
import { useToast } from '../../context/ToastContext'
import TaskRow from '../../components/TaskRow'
import {
  HourGutter,
  HourLines,
  NowLine,
  TimedBlock,
  MoreEventsChip,
  BarsArea,
  CalendarEmpty,
} from './parts'
import { useTimedGesture } from './useTimedGesture'
import { useElementWidth } from './useElementWidth'

// The Tag view is the detailed one: an event card may stay this wide before the
// extras collapse into "+X weitere" (tapping that chip expands them anyway).
const MIN_EVENT_WIDTH = 96

function DayView({ date, events, tasks, onSelectEvent }) {
  const scrollRef = useRef(null)
  const gridRef = useRef(null)
  const gridWidth = useElementWidth(gridRef)
  const [expanded, setExpanded] = useState(false)
  const dayISO = toISODate(date)
  const today = isToday(dayISO)
  const { updateEvent } = useEvents()
  const { showToast } = useToast()

  const { bars, timed } = splitDayEvents(events, date)
  const { items, overflows } = layoutTimedEvents(timed, {
    columnWidth: gridWidth || Infinity,
    minEventWidth: expanded ? 0 : MIN_EVENT_WIDTH,
  })
  const { lanes, laneCount } = packBars(bars, date, date)
  const dayTasks = tasksForDay(tasks, dayISO)
  const isEmpty = bars.length === 0 && timed.length === 0

  const { editId, draft, clearEdit, handlers } = useTimedGesture({
    gridRef,
    columns: 1,
    resolveEvent: (id) => timed.find((e) => e.id === id) || null,
    onOpen: onSelectEvent,
    onBackgroundTap: () => setExpanded(false),
    onCommit: async (id, patch, mode) => {
      try {
        await updateEvent(id, patch)
        showToast(mode === 'move' ? 'Termin verschoben' : 'Dauer geändert')
      } catch {
        /* error surfaces via the global banner */
      }
    },
  })

  // Collapse an expanded overlap cluster when the day changes.
  useEffect(() => setExpanded(false), [dayISO])

  // Jump to roughly "now" on today, else to the morning — when the day changes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = today ? nowTop(new Date()) - 3 * HOUR_HEIGHT : 7 * HOUR_HEIGHT
    el.scrollTop = Math.max(0, target)
  }, [dayISO, today])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Multi-day / all-day bars, pinned above the scrolling grid */}
      {laneCount > 0 && (
        <div className="shrink-0 border-b border-subtle px-3 py-2">
          <BarsArea lanes={lanes} laneCount={laneCount} columns={1} onSelect={onSelectEvent} />
        </div>
      )}

      {/* Scrollable hour grid (+ empty state centered over its viewport) */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={clearEdit} className="absolute inset-0 overflow-y-auto">
          <div className="relative flex" style={{ height: GRID_HEIGHT }}>
            <HourGutter />
            <div ref={gridRef} className="relative flex-1 border-l border-subtle" {...handlers}>
              <HourLines />
              {items.map((item) => (
                <TimedBlock
                  key={item.ev.id}
                  item={item}
                  columnWidth={gridWidth}
                  editing={editId === item.ev.id}
                  draft={draft && draft.id === item.ev.id ? draft : null}
                />
              ))}
              {overflows.map((item) => (
                <MoreEventsChip
                  key={item.id}
                  item={item}
                  columnWidth={gridWidth}
                  onSelect={() => setExpanded(true)}
                />
              ))}
              {today && <NowLine showLabel />}
            </div>
          </div>
        </div>
        {isEmpty && (
          <CalendarEmpty
            title="Keine Termine an diesem Tag"
            hint="Tippe auf + für einen neuen Termin"
          />
        )}
      </div>

      <TasksCollapsible tasks={dayTasks} />
    </div>
  )
}

export default memo(DayView)

function TasksCollapsible({ tasks }) {
  const [open, setOpen] = useState(true)
  const navigate = useNavigate()
  const { completeTask, uncompleteTask, toggleFavorite } = useTasks()
  const { showToast } = useToast()

  // This list is built from `tasksForDay`, which only ever returns active
  // tasks — so completing one always takes the row off screen and the toast is
  // the only way back (G7, §19). The Aufgaben list makes the same call from its
  // own filter state; here the answer is constant.
  const handleComplete = (task) => {
    completeTask(task).catch(() => {})
    showToast('Aufgabe erledigt', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        uncompleteTask(task).catch(() => {})
        showToast('Aufgabe wieder offen')
      },
    })
  }

  const handlers = {
    onComplete: handleComplete,
    onUncomplete: uncompleteTask,
    onToggleFavorite: toggleFavorite,
    onOpen: (t) => navigate(`/aufgaben/${t.id}`),
  }

  return (
    <div className="shrink-0 border-t border-subtle bg-bg-base">
      <button
        onClick={() => setOpen((o) => !o)}
        className="press-tint flex w-full items-center justify-between px-5 py-3"
        aria-expanded={open}
      >
        <span className="text-[15px] font-bold text-text-primary">
          Aufgaben ({tasks.length})
        </span>
        <ChevronDown
          size={20}
          className={`text-text-secondary transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div className="max-h-[34vh] overflow-y-auto px-3 pb-3">
          {tasks.length === 0 ? (
            <p className="px-2 py-2 text-[14px] text-text-secondary">
              Keine Aufgaben an diesem Tag.
            </p>
          ) : (
            <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
              {tasks.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  isOverdue={isOverdue(t)}
                  showBorder={i < tasks.length - 1}
                  {...handlers}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
