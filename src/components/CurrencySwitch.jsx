import { CURRENCIES } from '../lib/expenses'

// AUD / EUR, in the app's existing segmented control — the same chip group the
// calendar switches Tag / Woche / Monat with, down to the track, the radius and
// the accent on the selected chip. Deliberately not a new control: the module
// needs the switch twice (the overview's display currency and the form's input
// currency) and both must mean the same thing at a glance.
//
// It commits on the press like every other chip in the app, and there is
// nothing to cancel: switching is instant, free and reversible by switching
// back, so §19 asks for no confirmation and no undo here.
export default function CurrencySwitch({ value, onChange, label = 'Währung' }) {
  return (
    <div className="flex rounded-chip bg-bg-input p-1" role="group" aria-label={label}>
      {CURRENCIES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange?.(code)}
          aria-pressed={value === code}
          className={`press-tint rounded-chip px-4 py-1.5 text-label font-medium transition-colors ${
            value === code ? 'bg-accent text-white' : 'text-text-secondary'
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  )
}
