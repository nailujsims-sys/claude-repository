// Ein Segment-Schalter: mehrere Optionen, eine davon aktiv.
//
// DIE FORM IST NICHT NEU. Sie ist genau die, die der Kalender seit jeher für
// Tag/Woche/Monat benutzt — `rounded-chip bg-bg-input p-1`, das aktive Segment
// in `bg-accent text-white`. Ausgelagert ist sie, weil v1.26 zwei weitere
// Stellen braucht (die Tabs des Dashboards und den Verlaufsschalter) und drei
// Kopien derselben zehn Klassen genau die Variantenbildung wären, die Regel 2
// ausschließt.
//
// WAS AUSDRÜCKLICH NICHT PASSIERT: der Kalender wird nicht umgebaut. Sein
// Schalter sieht identisch aus und funktioniert; ihn anzufassen, nur damit er
// durch diese Datei läuft, wäre ein Refactor, den niemand bestellt hat (Regel
// 0). Er kommt hierher, wenn er aus eigenem Anlass bearbeitet wird —
// festgehalten in known-gaps.md.
//
// Rückmeldung auf dem Druck, nicht erst auf dem Loslassen: `.press-tint` macht
// genau das, und `transition-colors` ist unter `prefers-reduced-motion` aus,
// ohne dass die Rückmeldung verschwindet (§22).
export default function Segmented({ options = [], value, onChange, ariaLabel, className = '' }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex rounded-chip bg-bg-input p-1 ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange?.(option.id)}
            aria-pressed={active}
            className={`press-tint min-h-[36px] flex-1 rounded-chip px-3 py-1.5 text-label font-medium transition-colors motion-reduce:transition-none ${
              active ? 'bg-accent text-white' : 'text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
