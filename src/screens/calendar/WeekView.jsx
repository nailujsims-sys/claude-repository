import { memo, useEffect, useRef } from 'react'
import { addDays, isToday, toISODate, WEEKDAYS_DE } from '../../lib/date'
import {
  eventsInRange,
  isBarEvent,
  splitDayEvents,
  layoutTimedEvents,
  packBars,
  HOUR_HEIGHT,
  GRID_HEIGHT,
  nowTop,
} from '../../lib/calendar'
import { tasksForDay } from '../../lib/taskSelectors'
import { useEvents } from '../../context/EventsContext'
import { useToast } from '../../context/ToastContext'
import { HourGutter, HourLines, NowLine, TimedBlock, BarsArea, CalendarEmpty } from './parts'
import { useTimedGesture } from './useTimedGesture'

function WeekView({ weekMonday, events, tasks, onSelectEvent, onSelectDay }) {
  const scrollRef = useRef(null)
  const gridRef = useRef(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i))
  const weekEnd = days[6]
  const weekISO = toISODate(weekMonday)
  const { updateEvent } = useEvents()
  const { showToast } = useToast()

  const bars = eventsInRange(events, weekMonday, weekEnd).filter(isBarEvent)
  const packed = packBars(bars, weekMonday, weekEnd)
  const timedByDay = days.map((day) => splitDayEvents(events, day).timed)
  const isEmpty = bars.length === 0 && timedByDay.every((t) => t.length === 0)

  const { editId, draft, clearEdit, handlers } = useTimedGesture({
    gridRef,
    columns: 7,
    resolveEvent: (id) => events.find((e) => e.id === id) || null,
    onOpen: onSelectEvent,
    onCommit: async (id, patch, mode) => {
      try {
        await updateEvent(id, patch)
        showToast(mode === 'move' ? 'Termin verschoben' : 'Dauer geändert')
      } catch {
        /* error surfaces via the global banner */
      }
    },
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const hasToday = days.some((d) => isToday(toISODate(d)))
    el.scrollTop = Math.max(0, hasToday ? nowTop(new Date()) - 3 * HOUR_HEIGHT : 7 * HOUR_HEIGHT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekISO])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Weekday header + per-day task counts */}
      <div className="shrink-0 border-b border-subtle">
        <div className="flex">
          <div className="w-12 shrink-0" />
          <div className="flex flex-1">
            {days.map((day, i) => {
              const iso = toISODate(day)
              const t = isToday(iso)
              const count = tasksForDay(tasks, iso).length
              return (
                <button
                  key={iso}
                  onClick={() => onSelectDay?.(day)}
                  className={`flex flex-1 flex-col items-center gap-1 py-2 ${
                    t ? 'bg-white/[0.03]' : ''
                  }`}
                >
                  <span className="text-[11px] font-medium text-text-secondary">
                    {WEEKDAYS_DE[i]}
                  </span>
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full text-[14px] font-semibold ${
                      t ? 'bg-accent text-white' : 'text-text-primary'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <span
                    className={`min-w-[18px] rounded-chip px-1 text-center text-[10px] font-medium tabular-nums ${
                      count === 0
                        ? 'text-text-muted'
                        : t
                          ? 'bg-accent/20 text-accent'
                          : 'text-text-secondary'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Multi-day bars aligned to the 7 columns */}
        {packed.laneCount > 0 && (
          <div className="flex px-0 pb-1">
            <div className="w-12 shrink-0" />
            <div className="flex-1 px-1">
              <BarsArea
                lanes={packed.lanes}
                laneCount={packed.laneCount}
                columns={7}
                onSelect={onSelectEvent}
                laneHeight={20}
              />
            </div>
          </div>
        )}
      </div>

      {/* Scrollable grid (+ empty state centered over its viewport) */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={clearEdit} className="absolute inset-0 overflow-y-auto">
          <div className="relative flex" style={{ height: GRID_HEIGHT }}>
            <HourGutter />
            <div ref={gridRef} className="relative flex flex-1" {...handlers}>
              <HourLines />
              {days.map((day, i) => {
                const iso = toISODate(day)
                const t = isToday(iso)
                const layout = layoutTimedEvents(timedByDay[i])
                return (
                  <div
                    key={iso}
                    className={`relative flex-1 border-l border-subtle ${t ? 'bg-white/[0.03]' : ''}`}
                  >
                    {layout.map((item) => (
                      <TimedBlock
                        key={item.ev.id}
                        item={item}
                        compact
                        editing={editId === item.ev.id}
                        draft={draft && draft.id === item.ev.id ? draft : null}
                      />
                    ))}
                    {t && <NowLine />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {isEmpty && <CalendarEmpty title="Keine Termine in dieser Woche" />}
      </div>
    </div>
  )
}

export default memo(WeekView)
