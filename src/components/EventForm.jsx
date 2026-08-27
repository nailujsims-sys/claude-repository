import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Clock,
  Repeat,
  Bell,
  MapPin,
  FileText,
  X,
  ChevronRight,
  Check,
} from 'lucide-react'
import BottomSheet from './BottomSheet'
import MiniCalendar from './MiniCalendar'
import { useUI } from '../context/UIContext'
import { useEvents } from '../context/EventsContext'
import { useToast } from '../context/ToastContext'
import { startOfDay, toISODate, formatLongDate } from '../lib/date'
import { parseDateTime } from '../lib/calendar'
import {
  RECURRENCE_OPTIONS,
  REMINDER_OPTIONS,
  recurrenceLabel,
  reminderLabel,
} from '../lib/eventOptions'

const p2 = (n) => String(n).padStart(2, '0')
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

function emptyForm() {
  const today = toISODate(startOfDay(new Date()))
  return {
    title: '',
    kind: 'event', // 'event' | 'birthday'
    all_day: false,
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '10:00',
    recurrence: null,
    reminder: 30,
    location: '',
    description: '',
  }
}

// Read an existing event row into the form's shape.
function formFromEvent(ev) {
  const s = parseDateTime(ev.start_at) || startOfDay(new Date())
  const e = parseDateTime(ev.end_at) || s
  return {
    title: ev.title || '',
    kind: ev.is_birthday ? 'birthday' : 'event',
    all_day: !!ev.all_day,
    startDate: toISODate(s),
    startTime: hm(s),
    endDate: toISODate(e),
    endTime: hm(e),
    recurrence: ev.recurrence ?? null,
    reminder: ev.reminder ?? null,
    location: ev.location || '',
    description: ev.description || '',
  }
}

// Neuer Termin / Termin bearbeiten. A full-screen slide-up sheet controlled by
// the UI context — the exact same shell, spacing and animation as the Aufgaben
// form, so the two modules feel like one product. Editing reuses this screen
// with the values pre-filled (no separate UI).
export default function EventForm() {
  const { eventForm, closeEventForm } = useUI()
  const { getEvent, createEvent, updateEvent } = useEvents()
  const { showToast } = useToast()

  const open = !!eventForm
  const editing = eventForm?.mode === 'edit'

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState(null) // 'startDate'|'endDate'|'recurrence'|'reminder'|null
  const [locOpen, setLocOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  // (Re)initialize whenever the sheet opens.
  useEffect(() => {
    if (!open) return
    const next =
      editing && getEvent(eventForm.eventId)
        ? formFromEvent(getEvent(eventForm.eventId))
        : emptyForm()
    setForm(next)
    setPicker(null)
    setLocOpen(!!next.location)
    setNotesOpen(!!next.description)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventForm?.eventId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggle = (name) => setPicker((p) => (p === name ? null : name))

  const isBirthday = form.kind === 'birthday'
  const allDay = isBirthday || form.all_day
  const showTimes = !allDay
  const effectiveRecurrence = isBirthday ? 'FREQ=YEARLY' : form.recurrence

  // Keep start ≤ end while picking dates (ISO strings compare lexicographically).
  const pickStartDate = (iso) => {
    setForm((f) => ({ ...f, startDate: iso, endDate: f.endDate < iso ? iso : f.endDate }))
    setPicker(null)
  }
  const pickEndDate = (iso) => {
    setForm((f) => ({ ...f, endDate: iso, startDate: iso < f.startDate ? iso : f.startDate }))
    setPicker(null)
  }

  const canSave = form.title.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const startISO = form.startDate
    const endISO = isBirthday ? form.startDate : form.endDate
    let start_at, end_at
    if (allDay) {
      start_at = `${startISO}T00:00`
      end_at = `${endISO}T00:00`
    } else {
      start_at = `${startISO}T${form.startTime}`
      end_at = `${endISO}T${form.endTime}`
    }
    // Never let the end fall before the start.
    if (parseDateTime(end_at) < parseDateTime(start_at)) end_at = start_at

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      location: isBirthday ? null : form.location.trim() || null,
      start_at,
      end_at,
      all_day: allDay,
      recurrence: isBirthday ? 'FREQ=YEARLY' : form.recurrence,
      reminder: form.reminder,
      is_birthday: isBirthday,
    }
    try {
      if (editing) await updateEvent(eventForm.eventId, payload)
      else await createEvent(payload)
      showToast('Termin gespeichert ✓')
      closeEventForm()
    } catch {
      // Error surfaces via the global banner; keep the sheet open.
    } finally {
      setSaving(false)
    }
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={!canSave}
      className={`press-fade text-[15px] font-semibold ${canSave ? 'text-accent' : 'text-text-muted'}`}
    >
      {editing ? 'Speichern' : 'Erstellen'}
    </button>
  )

  return (
    <BottomSheet
      open={open}
      onClose={closeEventForm}
      full
      title={editing ? 'Termin bearbeiten' : 'Neuer Termin'}
      headerRight={saveBtn}
    >
      <div className="space-y-4 px-5 py-5 pb-12">
        {/* Title */}
        <div className="flex items-center gap-3 rounded-input bg-bg-input px-4 py-3.5 ring-1 ring-transparent focus-within:ring-accent">
          <CalendarDays size={18} className="shrink-0 text-text-muted" />
          <input
            autoFocus={!editing}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Titel des Termins"
            className="w-full bg-transparent text-[16px] text-text-primary placeholder:text-text-muted outline-none"
          />
        </div>

        {/* Terminart */}
        <div>
          <label className="mb-2 block text-[13px] font-semibold text-text-secondary">
            Terminart
          </label>
          <div className="flex gap-2">
            {[
              { v: 'event', l: 'Termin' },
              { v: 'birthday', l: 'Geburtstag' },
            ].map((o) => {
              const sel = form.kind === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => set({ kind: o.v })}
                  className={`press-tint flex flex-1 items-center gap-2 rounded-input border px-3 py-2.5 text-[14px] font-medium transition-colors ${
                    sel
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-subtle bg-bg-input text-text-secondary'
                  }`}
                >
                  <span
                    className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border ${
                      sel ? 'border-accent' : 'border-text-muted'
                    }`}
                  >
                    {sel && <span className="h-2 w-2 rounded-full bg-accent" />}
                  </span>
                  {o.l}
                </button>
              )
            })}
          </div>
        </div>

        {/* Zeit — one combined card (Ganztägig, Start/Ende, Wiederholen, Erinnerung) */}
        <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
          {/* Ganztägig */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Clock size={18} className="shrink-0 text-text-secondary" />
            <span className="flex-1 text-[15px] text-text-primary">Ganztägig</span>
            <Toggle
              checked={allDay}
              disabled={isBirthday}
              onChange={(v) => set({ all_day: v })}
            />
          </div>

          <Divider />

          {/* Dates + times */}
          {isBirthday ? (
            <DateTimeRow
              label="Datum"
              dateISO={form.startDate}
              pickerOpen={picker === 'startDate'}
              onToggleDate={() => toggle('startDate')}
              onDateChange={pickStartDate}
              showTime={false}
            />
          ) : (
            <>
              <DateTimeRow
                label="Start"
                dateISO={form.startDate}
                pickerOpen={picker === 'startDate'}
                onToggleDate={() => toggle('startDate')}
                onDateChange={pickStartDate}
                showTime={showTimes}
                time={form.startTime}
                onTimeChange={(t) => set({ startTime: t })}
              />
              <DateTimeRow
                label="Ende"
                dateISO={form.endDate}
                pickerOpen={picker === 'endDate'}
                onToggleDate={() => toggle('endDate')}
                onDateChange={pickEndDate}
                showTime={showTimes}
                time={form.endTime}
                onTimeChange={(t) => set({ endTime: t })}
              />
            </>
          )}

          <Divider />

          {/* Wiederholen */}
          <PickerRow
            icon={Repeat}
            label="Wiederholen"
            value={recurrenceLabel(effectiveRecurrence)}
            open={picker === 'recurrence'}
            disabled={isBirthday}
            onToggle={() => toggle('recurrence')}
          >
            <OptionList
              options={RECURRENCE_OPTIONS}
              value={form.recurrence}
              onSelect={(v) => {
                set({ recurrence: v })
                setPicker(null)
              }}
            />
          </PickerRow>

          {/* Erinnerung */}
          <PickerRow
            icon={Bell}
            label="Erinnerung"
            value={reminderLabel(form.reminder)}
            open={picker === 'reminder'}
            onToggle={() => toggle('reminder')}
          >
            <OptionList
              options={REMINDER_OPTIONS}
              value={form.reminder}
              onSelect={(v) => {
                set({ reminder: v })
                setPicker(null)
              }}
            />
          </PickerRow>
        </div>

        {/* Ort — hidden for birthdays. Compact line that opens an input on tap. */}
        {!isBirthday &&
          (locOpen || form.location ? (
            <div className="flex items-center gap-3 rounded-input bg-bg-input px-4 py-3">
              <MapPin size={18} className="shrink-0 text-text-muted" />
              <input
                autoFocus={locOpen && !form.location}
                value={form.location}
                onChange={(e) => set({ location: e.target.value })}
                placeholder="Ort"
                className="w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-muted outline-none"
              />
              {form.location && (
                <button
                  type="button"
                  onClick={() => set({ location: '' })}
                  aria-label="Ort entfernen"
                  className="press-fade shrink-0 text-text-muted"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ) : (
            <RevealRow icon={MapPin} label="Ort hinzufügen" onClick={() => setLocOpen(true)} />
          ))}

        {/* Notizen — compact line that opens an input on tap. */}
        {notesOpen || form.description ? (
          <div className="flex items-start gap-3 rounded-input bg-bg-input px-4 py-3">
            <FileText size={18} className="mt-0.5 shrink-0 text-text-muted" />
            <textarea
              autoFocus={notesOpen && !form.description}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Notizen"
              className="min-h-[44px] w-full resize-none bg-transparent text-[15px] text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        ) : (
          <RevealRow icon={FileText} label="Notizen hinzufügen" onClick={() => setNotesOpen(true)} />
        )}
      </div>
    </BottomSheet>
  )
}

// ── Small presentational pieces (all match the app's existing controls) ──────

function Divider() {
  return <div className="border-t border-subtle" />
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press-tint relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-input'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function DateTimeRow({
  label,
  dateISO,
  pickerOpen,
  onToggleDate,
  onDateChange,
  showTime,
  time,
  onTimeChange,
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-[15px] text-text-primary">{label}</span>
        <button
          type="button"
          onClick={onToggleDate}
          className={`press-tint flex-1 rounded-input px-3 py-2 text-left text-[14px] transition-colors ${
            pickerOpen ? 'bg-accent/15 text-accent' : 'bg-bg-input text-text-primary'
          }`}
        >
          {formatLongDate(dateISO)}
        </button>
        {showTime && (
          <input
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-[92px] shrink-0 rounded-input bg-bg-input px-2 py-2 text-center text-[14px] text-text-primary outline-none [color-scheme:dark]"
          />
        )}
      </div>
      {pickerOpen && <MiniCalendar value={dateISO} onChange={onDateChange} />}
    </div>
  )
}

function PickerRow({ icon: Icon, label, value, open, onToggle, disabled = false, children }) {
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className="press-tint flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-60"
      >
        <Icon size={18} className="shrink-0 text-text-secondary" />
        <span className="flex-1 text-[15px] text-text-primary">{label}</span>
        <span className="text-[14px] text-text-secondary">{value}</span>
        <ChevronRight
          size={16}
          className={`text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && !disabled && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

function OptionList({ options, value, onSelect }) {
  return (
    <div className="overflow-hidden rounded-input bg-bg-input">
      {options.map((o, i) => {
        const sel = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onSelect(o.value)}
            className={`press-tint flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] ${
              i > 0 ? 'border-t border-subtle' : ''
            } ${sel ? 'font-medium text-accent' : 'text-text-primary'}`}
          >
            <span>{o.label}</span>
            {sel && <Check size={16} className="text-accent" />}
          </button>
        )
      })}
    </div>
  )
}

function RevealRow({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-tint flex w-full items-center gap-3 rounded-input bg-bg-input px-4 py-3 text-left"
    >
      <Icon size={18} className="shrink-0 text-text-muted" />
      <span className="text-[15px] text-text-secondary">{label}</span>
    </button>
  )
}
