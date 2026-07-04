import { useEffect, useRef } from 'react'
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
import { HourGutter, HourLines, NowLine, TimedBlock, BarsArea } from './parts'

export default function WeekView({ weekMonday, events, tasks, now, onSelectEvent, onSelectDay }) {
  const scrollRef = useRef(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i))
  const weekEnd = days[6]
  const weekISO = toISODate(weekMonday)

  const bars = eventsInRange(events, weekMonday, weekEnd).filter(isBarEvent)
  const packed = packBars(bars, weekMonday, weekEnd)

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

      {/* Scrollable grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: GRID_HEIGHT }}>
          <HourGutter />
          <div className="relative flex flex-1">
            <HourLines />
            {days.map((day) => {
              const iso = toISODate(day)
              const t = isToday(iso)
              const layout = layoutTimedEvents(splitDayEvents(events, day).timed)
              return (
                <div
                  key={iso}
                  className={`relative flex-1 border-l border-subtle ${t ? 'bg-white/[0.03]' : ''}`}
                >
                  {layout.map((item) => (
                    <TimedBlock key={item.ev.id} item={item} onClick={onSelectEvent} compact />
                  ))}
                  {t && <NowLine now={now} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
