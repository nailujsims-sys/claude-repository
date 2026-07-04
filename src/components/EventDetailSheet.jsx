import { MapPin, Clock, Repeat, Bell, Gift, AlignLeft } from 'lucide-react'
import BottomSheet from './BottomSheet'
import {
  WEEKDAYS_DE_LONG,
  weekdayMon,
  formatLongDate,
  isSameDay,
} from '../lib/date'
import { eventStart, eventEnd, isBarEvent } from '../lib/calendar'

const p2 = (n) => String(n).padStart(2, '0')
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

function whenLabel(ev) {
  const s = eventStart(ev)
  const e = eventEnd(ev)
  if (!s) return ''
  const dayLine = (d) => `${WEEKDAYS_DE_LONG[weekdayMon(d)]}, ${formatLongDate(d)}`
  if (isBarEvent(ev)) {
    if (!e || isSameDay(s, e)) return `${dayLine(s)} · Ganztägig`
    return `${formatLongDate(s)} – ${formatLongDate(e)}`
  }
  return `${dayLine(s)} · ${hm(s)}${e ? ` – ${hm(e)}` : ''}`
}

const RECURRENCE_LABELS = {
  'FREQ=DAILY': 'Täglich',
  'FREQ=WEEKLY': 'Wöchentlich',
  'FREQ=MONTHLY': 'Monatlich',
  'FREQ=YEARLY': 'Jährlich',
}

function Row({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-text-secondary" />
      <span className="text-[15px] leading-snug text-text-primary">{children}</span>
    </div>
  )
}

// Read-only detail view for a calendar event, opened from any of the three
// views. Editing/creating events is a later milestone.
export default function EventDetailSheet({ event, onClose }) {
  const ev = event
  return (
    <BottomSheet open={!!ev} onClose={onClose} title="Termin">
      {ev && (
        <div className="pb-6">
          <div className="px-5 pb-1 pt-1">
            <h3 className="text-[20px] font-bold leading-tight text-text-primary">
              {ev.title}
            </h3>
          </div>

          <div className="mt-1 divide-y divide-subtle">
            <Row icon={Clock}>{whenLabel(ev)}</Row>
            {ev.location && <Row icon={MapPin}>{ev.location}</Row>}
            {ev.is_birthday && <Row icon={Gift}>Geburtstag</Row>}
            {ev.recurrence && (
              <Row icon={Repeat}>
                {RECURRENCE_LABELS[ev.recurrence] || 'Wiederholung'}
              </Row>
            )}
            {typeof ev.reminder === 'number' && (
              <Row icon={Bell}>Erinnerung {ev.reminder} Min. vorher</Row>
            )}
            {ev.description && <Row icon={AlignLeft}>{ev.description}</Row>}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
