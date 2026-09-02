import { useEffect, useMemo, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import HomeCard from './HomeCard'
import { SkeletonLine } from '../../components/Skeleton'
import { useNow } from '../../lib/useNow'
import { parseISODate, toISODate } from '../../lib/date'
import {
  dayAgenda,
  eventDisplayTitle,
  eventDurationLabel,
  eventIsNow,
  eventIsPast,
  eventSlotLabel,
  isBarEvent,
} from '../../lib/calendar'

// ── Termine heute ───────────────────────────────────────────────────────────
//
// The same events the calendar shows, read as a list instead of a grid: on the
// Heute screen the question is "what is on today", not "where in the day does
// it sit", and a list answers that in a quarter of the height an hour grid
// needs.
//
// Nothing is filtered and nothing is capped — the whole day is in the list and
// the card's height budget decides how much of it is visible at once.
//
// Tapping a row opens the app's existing `EventDetailSheet`, i.e. exactly what
// tapping the same event in Tag, Woche, Monat or the calendar search does. The
// screen owns the sheet (one per screen, like Kalender), so this card only
// reports the tap.
export default function AgendaCard({ events, loading, onSelect }) {
  // Own clock, own reason: the list has to know which events are already over
  // and which one is running, and that is the only thing on this screen that
  // changes without the user doing anything. A minute of resolution is enough
  // for a boundary the eye reads as "now".
  const now = useNow(60000)
  const dayISO = toISODate(now)
  const listRef = useRef(null)

  const agenda = useMemo(
    () => dayAgenda(events, parseISODate(dayISO)),
    [events, dayISO]
  )

  // The first event that is not over yet — the row the day currently stands on.
  const nextIndex = agenda.findIndex((ev) => !eventIsPast(ev, now))

  // Bring that row to the top of the box, the way the calendar's Tag view opens
  // near "now" rather than at 00:00: at 18:00 a list that starts with the 09:00
  // lecture is not an overview of what is left of the day. The earlier events
  // are one scroll up and the top fade says so.
  //
  // Deliberately not tied to the clock — only to the day and to the list
  // itself. A minute tick that re-scrolled the box would pull it out from under
  // whoever is reading it.
  useEffect(() => {
    const el = listRef.current
    if (!el || nextIndex <= 0) return
    const row = el.querySelector('[data-agenda-next]')
    if (!row) return
    el.scrollTop = Math.min(row.offsetTop, el.scrollHeight - el.clientHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayISO, agenda.length])

  return (
    <HomeCard
      id="agenda"
      icon={CalendarDays}
      title="Termine heute"
      caption={loading ? 'Lädt…' : countLabel(agenda.length)}
      listRef={listRef}
    >
      {loading ? (
        <AgendaSkeleton />
      ) : agenda.length === 0 ? (
        <p className="px-4 pb-4 text-ui text-text-secondary">
          Keine Termine heute. Tippe auf + für einen neuen Termin.
        </p>
      ) : (
        <div className="divide-y divide-subtle">
          {agenda.map((ev, i) => (
            <AgendaRow
              key={ev.id}
              event={ev}
              now={now}
              isNext={i === nextIndex}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </HomeCard>
  )
}

function countLabel(n) {
  if (n === 0) return 'Nichts geplant'
  return n === 1 ? '1 Termin' : `${n} Termine`
}

// One event. Leading time column, title, and a meta line with the length and
// the place — the three things that decide whether the entry needs attention
// right now. The end time is deliberately not repeated: "09:00" plus "60 Min"
// says the same as "09:00 – 10:00" with one number to read instead of two.
function AgendaRow({ event, now, isNext, onSelect }) {
  const bar = isBarEvent(event)
  const past = eventIsPast(event, now)
  // Only timed events light up. A bar covers the whole day, so accenting it
  // would mark it "now" from midnight to midnight and drown the one entry that
  // really is running.
  const running = !bar && eventIsNow(event, now)
  const meta = [bar ? '' : eventDurationLabel(event), event.location]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={() => onSelect?.(event)}
      data-agenda-row=""
      data-agenda-next={isNext ? '' : undefined}
      className="press-tint flex w-full items-start gap-3 px-4 py-3 text-left"
    >
      <span
        className={`w-14 shrink-0 leading-[20px] tabular-nums ${
          bar ? 'text-meta' : 'text-ui'
        } ${
          running
            ? 'font-semibold text-accent'
            : past
              ? 'text-text-muted'
              : 'text-text-secondary'
        }`}
      >
        {eventSlotLabel(event)}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-body font-medium leading-[20px] ${
            past ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {eventDisplayTitle(event)}
        </span>
        {meta && (
          <span className="mt-0.5 block truncate text-caption leading-[16px] text-text-muted">
            {meta}
          </span>
        )}
      </span>
    </button>
  )
}

function AgendaSkeleton() {
  return (
    <div className="divide-y divide-subtle" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-3 px-4 py-3">
          <SkeletonLine className="h-3.5 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-3.5 w-2/3" />
            <SkeletonLine className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
