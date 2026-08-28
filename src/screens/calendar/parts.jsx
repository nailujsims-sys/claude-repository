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
          className="absolute right-2 -translate-y-1/2 text-micro tabular-nums text-text-muted"
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
        // 9px: one-off, smaller than the scale's `micro` step on purpose (G10).
        <span className="absolute -top-[8px] left-1 rounded bg-danger px-1 text-[9px] font-semibold leading-4 text-white tabular-nums">
          {p2(now.getHours())}:{p2(now.getMinutes())}
        </span>
      )}
    </div>
  )
}

// ── Text budget of an event card ────────────────────────────────────────────
// A title is only ever cut off when the card really has no room left: the
// number of title lines is derived from the card's height, so "Familientreffen"
// wraps instead of turning into "Familientre…". The type scale follows the
// view's information density (Tag roomier than Woche) and collapses further on
// very short blocks; on a sliver-narrow card the text is dropped entirely
// rather than rendered as a column of single letters.
const SCALES = {
  roomy: { font: 12, line: 15, padY: 3, padX: 6 }, // Tag
  dense: { font: 11, line: 13, padY: 2, padX: 5 }, // Woche
  tiny: { font: 10, line: 11, padY: 1, padX: 4 }, // very short blocks
}
const MIN_TEXT_WIDTH = 42 // px — below this no word fits, so the card stays blank
const MIN_TIME_WIDTH = 62 // px — below this the time label is dropped

// How many lines still read as a title rather than as a column of syllables.
function lineBudget(width) {
  if (width >= 120) return 6
  if (width >= 84) return 4
  if (width >= 56) return 3
  return 2
}

export function blockTypography(height, width, compact) {
  const scale = height < 26 ? SCALES.tiny : compact ? SCALES.dense : SCALES.roomy
  const inner = height - 2 * scale.padY - 2 // minus the 1px border on both ends
  const timeHeight = scale.line - 1
  const withTime = Math.floor((inner - timeHeight) / scale.line)
  const withoutTime = Math.floor(inner / scale.line)
  // The title comes first: the time only stays while it doesn't cost the title
  // a second line (on a card that only ever gets one line it is free).
  const showTime =
    !compact && width >= MIN_TIME_WIDTH && withTime >= 1 && (withTime >= 2 || withoutTime <= 1)
  const lines = showTime ? withTime : withoutTime
  return {
    ...scale,
    showText: width >= MIN_TEXT_WIDTH,
    showTime,
    lines: Math.min(Math.max(lines, 1), lineBudget(width)),
  }
}

// Multi-line-capable text that only gets an ellipsis once it runs out of lines.
function clampStyle(font, line, lines) {
  return {
    fontSize: font,
    lineHeight: `${line}px`,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    overflowWrap: 'break-word',
    hyphens: 'auto',
  }
}

// A single timed event, absolutely positioned inside its day column. The layout
// (lib/calendar.js) hands over left/width as fractions of the column, so
// overlapping events share the width and partial overlaps stay wide.
//
// When `editing`, the block "lifts" (ring + shadow), pops to full width and
// shows top/bottom drag handles — the pointer layer (useTimedGesture) reads the
// data-ev-id / data-handle attributes to move or resize it. `draft` carries the
// live times while a drag is in flight so the block follows the finger.
//
// Press feedback (G2) is the shared `press-tint`, and only outside edit mode:
// while editing, the ring and shadow *are* the state, and a second wash would
// both fight the `shadow-lg` and blur the line between "pressed" and "grabbed".
// The block has no onClick of its own — the grid's gesture layer decides
// between tap-to-open and long-press-to-grab — so the central controller here
// only ever paints, which is exactly why it must not commit anything.
export function TimedBlock({ item, columnWidth = 0, compact = false, editing = false, draft = null }) {
  const { ev } = item
  const geom = draft
    ? eventTopHeight(draft.start_at, draft.end_at)
    : { top: item.top, height: item.height }
  const width = editing ? 1 : item.width
  const left = editing ? 0 : item.left
  const height = Math.max(geom.height - 2, 16)
  const px = columnWidth > 0 ? columnWidth * width : Infinity
  const t = blockTypography(height, px, compact)

  return (
    <button
      type="button"
      data-ev-id={ev.id}
      title={eventDisplayTitle(ev)}
      className={`absolute flex flex-col overflow-visible rounded-[10px] border bg-bg-elevated text-left transition-shadow ${
        editing
          ? 'z-30 border-accent ring-2 ring-accent shadow-lg shadow-black/40'
          : 'press-tint z-10 border-subtle'
      }`}
      style={{
        top: geom.top + 1,
        height,
        left: `calc(${left * 100}% + 1px)`,
        width: `calc(${width * 100}% - 2px)`,
        paddingBlock: t.padY,
        paddingInline: t.padX,
        touchAction: editing ? 'none' : undefined,
      }}
    >
      {t.showText && (
        <>
          <p
            className="font-medium text-text-primary"
            style={clampStyle(t.font, t.line, t.lines)}
          >
            {eventDisplayTitle(ev)}
          </p>
          {t.showTime && (
            <p
              className="truncate tabular-nums text-text-secondary"
              style={{ fontSize: t.font - 2, lineHeight: `${t.line - 1}px` }}
            >
              {eventTimeLabel(ev)}
            </p>
          )}
        </>
      )}

      {editing && (
        <>
          {/* Time readout while adjusting */}
          {!compact && (
            <span className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-micro font-semibold text-white tabular-nums">
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

// "+X weitere": stands in for the events that no longer fit next to each other
// (see layoutTimedEvents). Tapping it leads to the denser view of that day
// instead of squeezing four unreadable slivers into one column.
export function MoreEventsChip({ item, columnWidth = 0, compact = false, onSelect }) {
  const height = Math.max(item.height - 2, 16)
  const px = columnWidth > 0 ? columnWidth * item.width : Infinity
  const long = px >= 76
  const font = compact ? 10 : 11

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      title={`${item.count} weitere Termine`}
      className="press-tint absolute z-10 grid place-items-center rounded-[10px] border border-dashed border-subtle bg-bg-card px-1 text-center text-text-secondary"
      style={{
        top: item.top + 1,
        height,
        left: `calc(${item.left * 100}% + 1px)`,
        width: `calc(${item.width * 100}% - 2px)`,
      }}
    >
      <span
        className="font-medium leading-tight"
        style={{ fontSize: font, overflowWrap: 'break-word' }}
      >
        {long ? `+${item.count} weitere` : `+${item.count}`}
      </span>
    </button>
  )
}

// Multi-day / all-day bar strip. Works for the day view (columns = 1, bars fill
// width and stack) and the week view (columns = 7, bars span their days).
// Type scale follows the lane height so the label never gets clipped in the
// month view's tighter lanes.
export function BarsArea({
  lanes,
  laneCount,
  columns,
  onSelect,
  laneHeight = 22,
  containerWidth = 0,
}) {
  if (!laneCount) return null
  const barHeight = laneHeight - (laneHeight >= 20 ? 4 : 3)
  const roomy = laneHeight >= 20

  return (
    <div className="relative" style={{ height: laneCount * laneHeight }}>
      {lanes.map(({ ev, startIndex, endIndex, lane }) => {
        const span = endIndex - startIndex + 1
        const barWidth = containerWidth ? (containerWidth / columns) * span - 4 : Infinity
        const narrow = barWidth < 90
        const tight = barWidth < 56
        return (
          <button
            key={ev.id}
            onClick={() => onSelect?.(ev)}
            title={eventDisplayTitle(ev)}
            className="press-tint absolute overflow-hidden rounded-chip bg-accent-dim text-left"
            style={{
              top: lane * laneHeight,
              height: barHeight,
              left: `calc(${(startIndex / columns) * 100}% + 2px)`,
              width: `calc(${(span / columns) * 100}% - 4px)`,
              paddingInline: tight ? 3 : narrow ? 4 : 6,
            }}
          >
            <span
              className="block truncate text-text-primary"
              style={{
                fontSize: tight ? 10 : roomy && !narrow ? 12 : roomy ? 11 : 10,
                lineHeight: `${barHeight}px`,
              }}
            >
              {eventDisplayTitle(ev)}
            </span>
          </button>
        )
      })}
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
      <p className="mt-4 text-body font-semibold text-text-primary">{title}</p>
      {hint && <p className="mt-1 text-label text-text-secondary">{hint}</p>}
    </div>
  )
}
