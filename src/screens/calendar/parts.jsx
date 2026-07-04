import {
  HOUR_HEIGHT,
  HOURS,
  GRID_HEIGHT,
  nowTop,
  eventTimeLabel,
  eventDisplayTitle,
} from '../../lib/calendar'

// Shared presentational primitives for the Tag / Woche grids. Kept dumb and
// pixel-driven so both views compose them the same way.

const p2 = (n) => String(n).padStart(2, '0')

// Left gutter of hour labels, aligned to the grid rows.
export function HourGutter() {
  return (
    <div className="relative w-12 shrink-0" style={{ height: GRID_HEIGHT }}>
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-text-muted"
          style={{ top: h * HOUR_HEIGHT }}
        >
          {h === 0 ? '' : `${p2(h)}:00`}
        </div>
      ))}
    </div>
  )
}

// Horizontal hour lines behind the columns (absolute; parent must be relative).
export function HourLines() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-subtle"
          style={{ top: h * HOUR_HEIGHT }}
        />
      ))}
    </div>
  )
}

// Live red "now" line + left dot; optional time pill (day view).
export function NowLine({ now, showLabel = false }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: nowTop(now) }}
    >
      <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-danger" />
      <div className="border-t border-danger" />
      {showLabel && (
        <span className="absolute -top-[8px] left-1 rounded bg-danger px-1 text-[9px] font-semibold leading-4 text-white tabular-nums">
          {p2(now.getHours())}:{p2(now.getMinutes())}
        </span>
      )}
    </div>
  )
}

// A single timed event, absolutely positioned inside its day column. Column
// packing (colIndex/colCount) lets overlapping events share the width.
export function TimedBlock({ item, onClick, compact = false }) {
  const { ev, top, height, colIndex, colCount } = item
  const widthPct = 100 / colCount
  const showTime = height >= 34 && !compact
  return (
    <button
      onClick={() => onClick?.(ev)}
      className="absolute z-10 overflow-hidden rounded-[10px] border border-subtle border-l-[3px] border-l-accent bg-bg-elevated px-1.5 py-0.5 text-left"
      style={{
        top: top + 1,
        height: Math.max(height - 2, 16),
        left: `calc(${colIndex * widthPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
      }}
    >
      <p className="truncate text-[11px] font-medium leading-tight text-text-primary">
        {eventDisplayTitle(ev)}
      </p>
      {showTime && (
        <p className="truncate text-[10px] leading-tight text-text-secondary">
          {eventTimeLabel(ev)}
        </p>
      )}
    </button>
  )
}

// Multi-day / all-day bar strip. Works for the day view (columns = 1, bars fill
// width and stack) and the week view (columns = 7, bars span their days).
export function BarsArea({ lanes, laneCount, columns, onSelect, laneHeight = 22 }) {
  if (!laneCount) return null
  return (
    <div className="relative" style={{ height: laneCount * laneHeight }}>
      {lanes.map(({ ev, startIndex, endIndex, lane }) => (
        <button
          key={ev.id}
          onClick={() => onSelect?.(ev)}
          className="absolute overflow-hidden rounded-chip bg-accent-dim px-2 text-left"
          style={{
            top: lane * laneHeight,
            height: laneHeight - 4,
            left: `calc(${(startIndex / columns) * 100}% + 2px)`,
            width: `calc(${((endIndex - startIndex + 1) / columns) * 100}% - 4px)`,
          }}
        >
          <span className="block truncate text-[12px] leading-[18px] text-text-primary">
            {eventDisplayTitle(ev)}
          </span>
        </button>
      ))}
    </div>
  )
}
