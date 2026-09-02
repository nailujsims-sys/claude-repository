// ---------------------------------------------------------------------------
// The time-of-day greeting on the Heute screen.
//
// The split is defined here and nowhere else, so every surface that greets the
// user says the same thing at the same hour — and so a later change (a
// different boundary, a fourth bucket) is one edit rather than a hunt through
// the screens.
//
// Three buckets, chosen along ordinary German usage rather than around the
// clock in equal parts: the morning ends when "Morgen" stops being a plausible
// thing to say (11:00), the evening starts at 18:00 and simply runs through the
// night — someone opening the app at 02:00 is still in *their* evening, and a
// separate "Gute Nacht" would tell them something they already know while
// splitting the greeting into a fourth state nobody asked for.
// ---------------------------------------------------------------------------

// Ordered by `from`, ascending. The last entry owns everything after its start
// AND everything before the first one — the day wraps at midnight inside it.
export const GREETINGS = [
  { id: 'morning', from: 5, label: 'Guten Morgen' },
  { id: 'day', from: 11, label: 'Guten Tag' },
  { id: 'evening', from: 18, label: 'Guten Abend' },
]

// The bucket a local wall-clock time falls into.
export function greetingFor(ref = new Date()) {
  const hour = ref.getHours()
  // Start at the wrapping bucket: an hour before the first boundary (00:00–04:59)
  // belongs to the night half of the evening, and no comparison below will
  // match it.
  let current = GREETINGS[GREETINGS.length - 1]
  for (const g of GREETINGS) {
    if (hour >= g.from) current = g
  }
  return current
}

// "Guten Morgen" / "Guten Tag" / "Guten Abend".
export function greetingLabel(ref = new Date()) {
  return greetingFor(ref).label
}
