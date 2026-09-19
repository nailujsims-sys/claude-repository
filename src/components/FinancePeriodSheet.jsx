import { useEffect, useState } from 'react'
import { Calendar, CalendarDays, CalendarRange, Check, Clock } from 'lucide-react'
import BottomSheet from './BottomSheet'
import {
  describePeriod,
  describeRange,
  normalizePeriod,
  periodRange,
} from '../lib/finance/analytics'

// „Zeitraum auswählen" — vier Arten, eine Entscheidung.
//
// DIE VIER ZEILEN SIND DAS MODELL, nicht eine Auswahl, die dieses Sheet sich
// ausgedacht hat: `month`, `year`, `last30`, `custom` sind genau die vier Arten
// aus src/lib/finance/analytics/period.js. Jede Zeile sagt unter ihrem Namen,
// welche Tage sie konkret meint — „13. Aug. – 12. Sep." unter „Letzte 30 Tage" —
// weil ein Zeitraum ohne seine Grenzen eine Behauptung ist.
//
// ÜBERNEHMEN STATT SOFORT ANWENDEN. Das ist der eine Ort in diesem Modul, an
// dem eine Bestätigung richtig ist: hinter der Auswahl liegt ein eigener
// Bildschirm, der sich komplett neu aufbaut, und ein Zeitraum, der sich beim
// Durchtippen viermal ändert, lässt vier Dashboards aufblitzen. Abbrechen ist
// dabei immer möglich — das Sheet schließt, ohne etwas geändert zu haben.
const OPTIONS = [
  { kind: 'month', icon: Calendar, label: 'Monat' },
  { kind: 'year', icon: CalendarDays, label: 'Jahr' },
  { kind: 'last30', icon: Clock, label: 'Letzte 30 Tage' },
  { kind: 'custom', icon: CalendarRange, label: 'Benutzerdefiniert' },
]

export default function FinancePeriodSheet({ open, onClose, value, today, onApply }) {
  const [draft, setDraft] = useState(() => normalizePeriod(value, today))

  // Jedes Öffnen beginnt bei dem, was gerade gilt — nicht bei dem, was beim
  // letzten Mal halb ausgewählt und dann verworfen wurde.
  useEffect(() => {
    if (open) setDraft(normalizePeriod(value, today))
  }, [open, value, today])

  const pick = (kind) => {
    if (kind === draft.kind) return
    if (kind === 'month') setDraft(normalizePeriod({ kind: 'month', ...monthOf(today) }, today))
    else if (kind === 'year') setDraft(normalizePeriod({ kind: 'year', year: yearOf(today) }, today))
    else if (kind === 'last30') setDraft({ kind: 'last30' })
    else {
      const range = periodRange(draft, today)
      setDraft({ kind: 'custom', from: range.from, to: range.to })
    }
  }

  const apply = () => {
    onApply?.(draft)
    onClose?.()
  }

  const customRange = draft.kind === 'custom' ? draft : null

  return (
    <BottomSheet open={open} onClose={onClose} title="Zeitraum auswählen">
      <div className="overflow-y-auto px-5 pb-5">
        <div className="rounded-card bg-bg-card">
          {OPTIONS.map((option, index) => {
            const active = draft.kind === option.kind
            const Icon = option.icon
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => pick(option.kind)}
                aria-pressed={active}
                className={`press-tint flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left ${
                  index > 0 ? 'border-t border-subtle' : ''
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-bg-input text-text-secondary">
                  <Icon size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-body ${
                      active ? 'font-semibold text-text-primary' : 'text-text-primary'
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {hintFor(option.kind, draft, today)}
                  </span>
                </span>
                {active && <Check size={18} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>

        {customRange && (
          <div className="mt-3 rounded-card bg-bg-card px-4 py-4">
            <div className="flex gap-3">
              <DateField
                label="Von"
                value={customRange.from}
                max={customRange.to}
                onChange={(from) => setDraft({ ...customRange, from })}
              />
              <DateField
                label="Bis"
                value={customRange.to}
                min={customRange.from}
                onChange={(to) => setDraft({ ...customRange, to })}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={apply}
          className="press-tint mt-4 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
        >
          Übernehmen
        </button>
      </div>
    </BottomSheet>
  )
}

function DateField({ label, value, min, max, onChange }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="block text-label text-text-secondary">{label}</span>
      <input
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-[44px] w-full rounded-input bg-bg-input px-3 text-field text-text-primary"
      />
    </label>
  )
}

const monthOf = (today) => ({
  year: Number(String(today).slice(0, 4)),
  month: Number(String(today).slice(5, 7)),
})
const yearOf = (today) => Number(String(today).slice(0, 4))

// Was diese Zeile konkret bedeutet — für die gewählte Art die echten Grenzen
// des Entwurfs, für die anderen das, was sie ergäben.
function hintFor(kind, draft, today) {
  if (kind === draft.kind) {
    if (kind === 'month' || kind === 'year') {
      return `Ganzer ${kind === 'month' ? 'Monat' : 'Zeitraum'} (${describePeriod(draft, today)})`
    }
    return describeRange(periodRange(draft, today))
  }
  if (kind === 'month') return `Ganzer Monat (z. B. ${describePeriod(monthDraft(today), today)})`
  if (kind === 'year') return `Ganzes Jahr (z. B. ${yearOf(today)})`
  if (kind === 'last30') return describeRange(periodRange({ kind: 'last30' }, today))
  return 'Individuellen Zeitraum auswählen'
}

const monthDraft = (today) => ({ kind: 'month', ...monthOf(today) })
