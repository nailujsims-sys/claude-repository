// The app's switch. Extracted from EventForm, where it was the only one, so the
// Zuordnung sheet uses that switch rather than a second one that looks almost
// like it (Rule 0: reuse before you invent).
//
// Unchanged in behaviour and markup: 44 px of reachable row is the caller's
// job — the track itself is the 24×44 control every platform draws.
export default function Toggle({ checked, onChange, disabled = false, label = undefined }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press-tint relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${
        checked ? 'bg-accent' : 'bg-bg-input'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all motion-reduce:transition-none ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
