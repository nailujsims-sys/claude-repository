import { buildMonthGrid, isToday, toISODate, WEEKDAYS_DE } from '../../lib/date'
import {
  eventsInRange,
  isBarEvent,
  splitDayEvents,
  packBars,
  eventDisplayTitle,
} from '../../lib/calendar'
import { tasksForDay } from '../../lib/taskSelectors'
import { BarsArea } from './parts'

const NUMBER_BLOCK_H = 34 // px reserved for the day number + task dot
const BAR_H = 16 // px per multi-day lane
const MAX_TIMED = 2 // single-day chips shown before "+X weitere"

export default function MonthView({ monthDate, events, tasks, onSelectDay, onSelectEvent }) {
  const weeks = buildMonthGrid(monthDate.getFullYear(), monthDate.getMonth())

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-subtle">
        {WEEKDAYS_DE.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-medium text-text-secondary">
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="min-h-0 flex-1 overflow-y-auto border-r border-subtle">
        {weeks.map((week) => (
          <WeekRow
            key={week.weekNumber + '-' + week.days[0].iso}
            week={week}
            events={events}
            tasks={tasks}
            onSelectDay={onSelectDay}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  )
}

function WeekRow({ week, events, tasks, onSelectDay, onSelectEvent }) {
  const weekStart = week.days[0].date
  const weekEnd = week.days[6].date
  const bars = eventsInRange(events, weekStart, weekEnd).filter(isBarEvent)
  const packed = packBars(bars, weekStart, weekEnd)
  const barsZone = packed.laneCount * BAR_H

  return (
    <div className="relative grid grid-cols-7">
      {week.days.map((day) => {
        const t = isToday(day.iso)
        const count = tasksForDay(tasks, day.iso).length
        const timed = splitDayEvents(events, day.date).timed
        const visible = timed.slice(0, MAX_TIMED)
        const hidden = timed.length - visible.length

        return (
          <div
            key={day.iso}
            onClick={() => onSelectDay?.(day.date)}
            className="relative min-h-[94px] cursor-pointer overflow-hidden border-l border-t border-subtle px-0.5 pb-1"
          >
            <div className="flex flex-col items-center" style={{ height: NUMBER_BLOCK_H, paddingTop: 4 }}>
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold ${
                  t
                    ? 'bg-accent text-white'
                    : day.inMonth
                      ? 'text-text-primary'
                      : 'text-text-muted'
                }`}
              >
                {day.date.getDate()}
              </span>
              <span
                className={`mt-1 h-1.5 w-1.5 rounded-full ${
                  count > 0 ? 'bg-accent' : 'bg-transparent'
                }`}
              />
            </div>

            <div className="space-y-0.5" style={{ marginTop: barsZone }}>
              {visible.map((ev) => (
                <button
                  key={ev.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectEvent?.(ev)
                  }}
                  className="block w-full truncate rounded bg-accent-dim px-1 text-left text-[9px] leading-[14px] text-text-primary"
                >
                  {eventDisplayTitle(ev)}
                </button>
              ))}
              {hidden > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectDay?.(day.date)
                  }}
                  className="block w-full truncate px-1 text-left text-[9px] font-medium text-text-secondary"
                >
                  +{hidden} weitere
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Multi-day bars spanning this week's columns, in the reserved zone */}
      {packed.laneCount > 0 && (
        <div className="pointer-events-none absolute inset-x-0" style={{ top: NUMBER_BLOCK_H }}>
          <div className="pointer-events-auto">
            <BarsArea
              lanes={packed.lanes}
              laneCount={packed.laneCount}
              columns={7}
              onSelect={onSelectEvent}
              laneHeight={BAR_H}
            />
          </div>
        </div>
      )}
    </div>
  )
}
