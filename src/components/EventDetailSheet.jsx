import { useState } from 'react'
import {
  CalendarDays,
  Clock,
  MapPin,
  Repeat,
  Bell,
  Pencil,
  Trash2,
} from 'lucide-react'
import BottomSheet from './BottomSheet'
import ConfirmDialog from './ConfirmDialog'
import { useUI } from '../context/UIContext'
import { useEvents } from '../context/EventsContext'
import { useToast } from '../context/ToastContext'
import {
  WEEKDAYS_DE_LONG,
  weekdayMon,
  formatLongDate,
  MONTHS_DE,
  isSameDay,
} from '../lib/date'
import { eventStart, eventEnd, eventDisplayTitle } from '../lib/calendar'
import { recurrenceLabel, reminderLabel } from '../lib/eventOptions'

const p2 = (n) => String(n).padStart(2, '0')
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

function dateLabel(ev) {
  const s = eventStart(ev)
  const e = eventEnd(ev)
  if (!s) return ''
  if (e && !isSameDay(s, e)) {
    const sameYear = s.getFullYear() === e.getFullYear()
    const left = sameYear ? `${s.getDate()}. ${MONTHS_DE[s.getMonth()]}` : formatLongDate(s)
    return `${left} – ${formatLongDate(e)}`
  }
  return `${WEEKDAYS_DE_LONG[weekdayMon(s)]}, ${formatLongDate(s)}`
}

function timeLabel(ev) {
  const s = eventStart(ev)
  const e = eventEnd(ev)
  if (!s) return ''
  return e && isSameDay(s, e) ? `${hm(s)} – ${hm(e)}` : hm(s)
}

// Read-only detail view for a calendar event. Opened by tapping an event in any
// of the three views. The bottom actions (Bearbeiten / Löschen) mirror the task
// detail exactly — same buttons, colors, animation and confirm dialog.
export default function EventDetailSheet({ event, onClose }) {
  const ev = event
  const { openEventForm } = useUI()
  const { deleteEvent } = useEvents()
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleEdit = () => {
    onClose()
    openEventForm({ mode: 'edit', eventId: ev.id })
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    try {
      await deleteEvent(ev.id)
      showToast('Termin gelöscht')
      onClose()
    } catch {
      // Error surfaces via the global banner.
    }
  }

  return (
    <BottomSheet open={!!ev} onClose={onClose} title="Termin">
      {ev && (
        <div className="px-5 pb-6 pt-1">
          <h3 className="text-[22px] font-bold leading-tight text-text-primary">
            {eventDisplayTitle(ev)}
          </h3>

          {/* When / where */}
          <div className="mt-4 divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-bg-card">
            <InfoRow icon={CalendarDays} label="Datum" value={dateLabel(ev)} />
            {!ev.is_birthday && (
              <InfoRow
                icon={Clock}
                label="Uhrzeit"
                value={ev.all_day ? 'Ganztägig' : timeLabel(ev)}
              />
            )}
            {ev.location && <InfoRow icon={MapPin} label="Ort" value={ev.location} />}
          </div>

          {/* Recurrence / reminder */}
          <div className="mt-3 divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-bg-card">
            <InfoRow
              icon={Repeat}
              label="Wiederholung"
              value={recurrenceLabel(ev.recurrence)}
              muted={!ev.recurrence}
            />
            <InfoRow
              icon={Bell}
              label="Erinnerung"
              value={reminderLabel(ev.reminder)}
              muted={ev.reminder == null}
            />
          </div>

          {/* Notes */}
          {ev.description && (
            <section className="mt-5">
              <h4 className="mb-2 text-[15px] font-bold text-text-primary">Notizen</h4>
              <p className="whitespace-pre-wrap rounded-card border border-subtle bg-bg-card p-4 text-[15px] leading-relaxed text-text-secondary">
                {ev.description}
              </p>
            </section>
          )}

          {/* Actions — identical to the task detail */}
          <div className="mt-6 space-y-3">
            <button
              onClick={handleEdit}
              className="press-tint flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-3.5 text-[15px] font-semibold text-accent"
            >
              <Pencil size={18} /> Bearbeiten
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              className="press-tint flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-[15px] font-semibold text-danger"
              style={{ background: 'rgba(239, 68, 68, 0.12)' }}
            >
              <Trash2 size={18} /> Löschen
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Termin löschen?"
          message="Dieser Termin wird dauerhaft gelöscht."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleDelete}
        />
      )}
    </BottomSheet>
  )
}

function InfoRow({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5">
      <Icon size={18} className="shrink-0 text-text-secondary" />
      <span className="text-[15px] text-text-primary">{label}</span>
      <span
        className={`ml-auto pl-3 text-right text-[15px] ${
          muted ? 'text-text-muted' : 'text-text-secondary'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
