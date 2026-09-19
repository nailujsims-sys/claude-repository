import { useEffect, useState } from 'react'
import { Calendar, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
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

  // Ein Monat oder ein Jahr ist nicht „der aktuelle" — er ist einer von vielen.
  // Ohne Schritte zurück wäre „Monat" nur ein anderes Wort für „dieser Monat",
  // und der August ließe sich gar nicht ansehen.
  //
  // NACH VORN NUR BIS HEUTE: ein Monat, der noch nicht angefangen hat, hat
  // keine Ausgaben, und ein Dashboard, das auf den Dezember blättert, zeigt
  // eine leere Auswertung statt einer Antwort. Der Pfeil ist dann deaktiviert
  // und sagt das auch dem Screenreader.
  const stepMonth = (delta) => {
    const total = draft.year * 12 + (draft.month - 1) + delta
    setDraft({ kind: 'month', year: Math.floor(total / 12), month: (total % 12) + 1 })
  }
  const stepYear = (delta) => setDraft({ kind: 'year', year: draft.year + delta })

  const thisYear = yearOf(today)
  const thisMonth = monthOf(today).month
  const monthAtEnd =
    draft.kind === 'month' && (draft.year > thisYear || (draft.year === thisYear && draft.month >= thisMonth))
  const yearAtEnd = draft.kind === 'year' && draft.year >= thisYear

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

        {draft.kind === 'month' && (
          <Stepper
            label={describePeriod(draft, today)}
            previousLabel="Vorheriger Monat"
            nextLabel="Nächster Monat"
            onPrevious={() => stepMonth(-1)}
            onNext={() => stepMonth(1)}
            atEnd={monthAtEnd}
          />
        )}

        {draft.kind === 'year' && (
          <Stepper
            label={String(draft.year)}
            previousLabel="Vorheriges Jahr"
            nextLabel="Nächstes Jahr"
            onPrevious={() => stepYear(-1)}
            onNext={() => stepYear(1)}
            atEnd={yearAtEnd}
          />
        )}

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

// ‹  September 2026  › — die Beschriftung in der Mitte, zwei Pfeile daneben.
//
// Beide Pfeile sind 44px groß (§22) und heißen im Screenreader, was sie tun —
// „Vorheriger Monat", nicht „Zurück". Der deaktivierte Pfeil bleibt stehen
// statt zu verschwinden: eine Leiste, die ihre Breite ändert, sobald man am
// Rand ankommt, springt.
// Exportiert, damit tools/financeDashboardLayout.mjs die beiden Pfeile in einem
// echten Browser messen kann — sie sind die kleinsten Trefferflächen, die v1.26
// hinzufügt (§22).
export function Stepper({ label, previousLabel, nextLabel, onPrevious, onNext, atEnd }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-card bg-bg-card px-2 py-2">
      <button
        type="button"
        onClick={onPrevious}
        aria-label={previousLabel}
        className="press-tint grid h-11 w-11 shrink-0 place-items-center rounded-btn text-text-secondary"
      >
        <ChevronLeft size={20} />
      </button>
      <span
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-center text-body font-semibold text-text-primary"
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={atEnd}
        aria-label={nextLabel}
        className="press-tint grid h-11 w-11 shrink-0 place-items-center rounded-btn text-text-secondary disabled:opacity-30"
      >
        <ChevronRight size={20} />
      </button>
    </div>
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
    // Für Monat und Jahr steht die Auswahl im Schalter darunter; hier stünde
    // sie ein zweites Mal und würde beim Blättern doppelt wandern. Stattdessen
    // die Tage, die tatsächlich gezählt werden — beim laufenden Monat ist das
    // ausdrücklich nicht der ganze.
    if (kind === 'month' || kind === 'year') return describeRange(periodRange(draft, today))
    return describeRange(periodRange(draft, today))
  }
  if (kind === 'month') return `Ganzer Monat (z. B. ${describePeriod(monthDraft(today), today)})`
  if (kind === 'year') return `Ganzes Jahr (z. B. ${yearOf(today)})`
  if (kind === 'last30') return describeRange(periodRange({ kind: 'last30' }, today))
  return 'Individuellen Zeitraum auswählen'
}

const monthDraft = (today) => ({ kind: 'month', ...monthOf(today) })
