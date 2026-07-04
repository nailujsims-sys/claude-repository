// Recurrence + reminder option lists and label helpers, shared by the event
// form (the pickers) and the detail sheet (read-only display). Keeping them in
// one place means the picker and the label can never drift apart.
//
// Storage shape (see data/eventDefaults.js):
//   recurrence — an RRULE-style string, or null for "Nie". Storing the raw rule
//                keeps the model open to arbitrary custom rules and maps 1:1 to
//                Google Calendar's RRULE for a future sync.
//   reminder   — whole minutes before start (int), or null for "Keine".

export const RECURRENCE_OPTIONS = [
  { value: null, label: 'Nie' },
  { value: 'FREQ=DAILY', label: 'Täglich' },
  { value: 'FREQ=WEEKLY', label: 'Wöchentlich' },
  { value: 'FREQ=MONTHLY', label: 'Monatlich' },
  { value: 'FREQ=YEARLY', label: 'Jährlich' },
]

const RECURRENCE_PRESET_LABELS = {
  'FREQ=DAILY': 'Täglich',
  'FREQ=WEEKLY': 'Wöchentlich',
  'FREQ=MONTHLY': 'Monatlich',
  'FREQ=YEARLY': 'Jährlich',
}

// Any non-null rule we don't recognise is a custom RRULE → "Benutzerdefiniert".
// The model already supports these (they round-trip untouched); a full custom
// rule editor is a later milestone, so the picker only offers the presets.
export function recurrenceLabel(rule) {
  if (!rule) return 'Nie'
  return RECURRENCE_PRESET_LABELS[rule] || 'Benutzerdefiniert'
}

export const REMINDER_OPTIONS = [
  { value: null, label: 'Keine' },
  { value: 0, label: 'Zum Zeitpunkt' },
  { value: 5, label: '5 Minuten vorher' },
  { value: 15, label: '15 Minuten vorher' },
  { value: 30, label: '30 Minuten vorher' },
  { value: 60, label: '1 Stunde vorher' },
  { value: 120, label: '2 Stunden vorher' },
  { value: 1440, label: '1 Tag vorher' },
]

export function reminderLabel(min) {
  if (min == null) return 'Keine'
  const preset = REMINDER_OPTIONS.find((o) => o.value === min)
  if (preset) return preset.label
  // Graceful fallback for any value not in the preset list.
  if (min === 0) return 'Zum Zeitpunkt'
  if (min % 1440 === 0) return `${min / 1440} Tage vorher`
  if (min % 60 === 0) return `${min / 60} Stunden vorher`
  return `${min} Minuten vorher`
}
