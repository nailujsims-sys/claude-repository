import { useEffect, useRef, useState } from 'react'
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
import TaskRow from '../../components/TaskRow'
import { HourGutter, HourLines, NowLine, TimedBlock, BarsArea } from './parts'

export default function DayView({ date, events, tasks, now, onSelectEvent }) {
  const scrollRef = useRef(null)
  const dayISO = toISODate(date)
  const today = isToday(dayISO)

  const { bars, timed } = splitDayEvents(events, date)
  const layout = layoutTimedEvents(timed)
  const { lanes, laneCount } = packBars(bars, date, date)
  const dayTasks = tasksForDay(tasks, dayISO)

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

      {/* Scrollable hour grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: GRID_HEIGHT }}>
          <HourGutter />
          <div className="relative flex-1 border-l border-subtle">
            <HourLines />
            {layout.map((item) => (
              <TimedBlock key={item.ev.id} item={item} onClick={onSelectEvent} />
            ))}
            {today && <NowLine now={now} showLabel />}
          </div>
        </div>
      </div>

      <TasksCollapsible tasks={dayTasks} />
    </div>
  )
}

function TasksCollapsible({ tasks }) {
  const [open, setOpen] = useState(true)
  const navigate = useNavigate()
  const { completeTask, uncompleteTask, toggleFavorite } = useTasks()

  const handlers = {
    onComplete: completeTask,
    onUncomplete: uncompleteTask,
    onToggleFavorite: toggleFavorite,
    onOpen: (t) => navigate(`/aufgaben/${t.id}`),
  }

  return (
    <div className="shrink-0 border-t border-subtle bg-bg-base">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3"
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
