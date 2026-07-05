import { CalendarDays } from 'lucide-react'
import {
  HOUR_HEIGHT,
  HOURS,
  GRID_HEIGHT,
  nowTop,
  eventTimeLabel,
  eventRangeLabel,
  eventTopHeight,
  eventDisplayTitle,
} from '../../lib/calendar'
import { useNow } from '../../lib/useNow'

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

// Live red "now" line + left dot; optional time pill (day view). Owns its own
// clock so the ticking (every 30s) only re-renders this tiny line, not the whole
// calendar tree — one of the calendar's key "avoid unnecessary re-renders" wins.
export function NowLine({ showLabel = false }) {
  const now = useNow()
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
//
// When `editing`, the block "lifts" (ring + shadow), pops to full width and
// shows top/bottom drag handles — the pointer layer (useTimedGesture) reads the
// data-ev-id / data-handle attributes to move or resize it. `draft` carries the
// live times while a drag is in flight so the block follows the finger.
export function TimedBlock({ item, compact = false, editing = false, draft = null }) {
  const { ev, colIndex, colCount } = item
  const geom = draft ? eventTopHeight(draft.start_at, draft.end_at) : { top: item.top, height: item.height }
  const widthPct = editing ? 100 : 100 / colCount
  const left = editing ? 0 : colIndex * widthPct
  const showTime = geom.height >= 34 && !compact

  return (
    <button
      type="button"
      data-ev-id={ev.id}
      className={`absolute overflow-visible rounded-[10px] border border-l-[3px] border-l-accent bg-bg-elevated px-1.5 py-0.5 text-left transition-shadow ${
        editing
          ? 'z-30 border-accent ring-2 ring-accent shadow-lg shadow-black/40'
          : 'z-10 border-subtle'
      }`}
      style={{
        top: geom.top + 1,
        height: Math.max(geom.height - 2, 16),
        left: `calc(${left}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
        touchAction: editing ? 'none' : undefined,
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

      {editing && (
        <>
          {/* Time readout while adjusting */}
          {!compact && (
            <span className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
              {eventRangeLabel(draft || ev)}
            </span>
          )}
          {/* Top / bottom resize handles */}
          <span
            data-handle="start"
            className="absolute -top-2 left-1/2 h-4 w-9 -translate-x-1/2 rounded-full border border-white/30 bg-accent"
          />
          <span
            data-handle="end"
            className="absolute -bottom-2 left-1/2 h-4 w-9 -translate-x-1/2 rounded-full border border-white/30 bg-accent"
          />
        </>
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

// Friendly empty state, centered over a grid's visible area (parent must be
// relative). Same visual language as the rest of the app — a rounded-card icon
// tile with a title + hint — so an empty day/week never reads as a dead blank.
export function CalendarEmpty({ title, hint }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-card bg-bg-card text-text-secondary">
        <CalendarDays size={26} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-text-primary">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-text-secondary">{hint}</p>}
    </div>
  )
}
