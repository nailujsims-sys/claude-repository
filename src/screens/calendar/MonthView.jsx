import { memo, useMemo, useRef } from 'react'
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
import { useElementWidth } from './useElementWidth'

const NUMBER_BLOCK_H = 38 // px reserved for the day number + task dot
const BAR_H = 16 // px per multi-day lane
const MAX_TIMED = 2 // single-day chips shown before "+X weitere"
const CELL_MIN_H = 100 // px minimum height of a day cell
const CHIP_LINE = 13 // px line height of an event chip
const CHIP_PAD = 2 // px vertical padding inside a chip
const CHIP_GAP = 2 // px between chips

// How many lines a day's event chips may use: the month view is the compact
// overview, so one line is the norm — but when a day has room to spare a chip
// wraps instead of cutting the title off ("Familientreffen", not "Familientre…").
function chipLines(visibleCount, hasMore, barsZone) {
  const free = CELL_MIN_H - NUMBER_BLOCK_H - barsZone - 4
  const rows = visibleCount + (hasMore ? 1 : 0)
  const used = rows * (CHIP_LINE + CHIP_PAD) + Math.max(0, rows - 1) * CHIP_GAP
  return free - used >= CHIP_LINE * visibleCount ? 2 : 1
}

function MonthView({ monthDate, events, tasks, onSelectDay, onSelectEvent }) {
  const gridRef = useRef(null)
  const gridWidth = useElementWidth(gridRef)
  const cellWidth = gridWidth ? gridWidth / 7 : 0

  // The grid only depends on which month is shown — memoize so scrolling / clock
  // ticks / unrelated state never rebuild six weeks of cells.
  const weeks = useMemo(
    () => buildMonthGrid(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate]
  )

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
      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto border-r border-subtle">
        {weeks.map((week) => (
          <WeekRow
            key={week.weekNumber + '-' + week.days[0].iso}
            week={week}
            events={events}
            tasks={tasks}
            cellWidth={cellWidth}
            onSelectDay={onSelectDay}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(MonthView)

const WeekRow = memo(function WeekRow({
  week,
  events,
  tasks,
  cellWidth,
  onSelectDay,
  onSelectEvent,
}) {
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
        const lines = chipLines(visible.length, hidden > 0, barsZone)

        return (
          <div
            key={day.iso}
            onClick={() => onSelectDay?.(day.date)}
            className="press-tint relative cursor-pointer overflow-hidden border-l border-t border-subtle px-0.5 pb-1"
            style={{ minHeight: CELL_MIN_H }}
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
                  title={eventDisplayTitle(ev)}
                  className="press-tint block w-full rounded bg-accent-dim text-left text-text-primary"
                  style={{
                    paddingInline: 3,
                    fontSize: 10,
                    lineHeight: `${CHIP_LINE}px`,
                    paddingBlock: CHIP_PAD / 2,
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: lines,
                    overflow: 'hidden',
                    overflowWrap: 'break-word',
                    hyphens: 'auto',
                  }}
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
                  className="press-fade block w-full truncate text-left font-medium text-text-secondary"
                  style={{ paddingInline: 2, fontSize: 10, lineHeight: `${CHIP_LINE}px` }}
                >
                  {/* "weitere" only while the cell is wide enough for it —
                      a truncated "+7 weit…" would say less than a plain "+7". */}
                  {cellWidth && cellWidth < 54 ? `+${hidden}` : `+${hidden} weitere`}
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
              containerWidth={cellWidth * 7}
            />
          </div>
        </div>
      )}
    </div>
  )
})
