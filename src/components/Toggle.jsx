// The app's switch. Extracted from EventForm, where it was the only one, so the
// Zuordnung sheet uses that switch rather than a second one that looks almost
// like it (Rule 0: reuse before you invent).
//
// THE TRACK IS 44×24. THE TARGET IS 44×44.
//
// A 24 px tall button is the size of the drawing, not the size of a thumb — and
// §22 asks for targets a thumb actually hits. So the button is 44×44 and the
// track sits centred inside it, invisible padding around a control that looks
// exactly as it did.
//
// The negative margin is what keeps that free: `-my-2.5` gives the ten pixels
// back on each side, so the element still occupies 24 px of layout and no
// existing row moves. The extra ten pixels above and below are hit area,
// overlapping the row's own padding rather than growing it.
export default function Toggle({ checked, onChange, disabled = false, label = undefined }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press-tint relative -my-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span
        className={`relative block h-6 w-11 rounded-full transition-colors motion-reduce:transition-none ${
          checked ? 'bg-accent' : 'bg-bg-input'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all motion-reduce:transition-none ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}
