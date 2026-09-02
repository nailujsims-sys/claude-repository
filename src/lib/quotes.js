// ---------------------------------------------------------------------------
// The daily motivation line on the Heute screen.
//
// Ten fixed lines that rotate by calendar day: the same day always yields the
// same line, so reloading the page — or navigating away and back — never
// swaps it, and the next day always yields a different one. No randomness is
// involved anywhere; the day *is* the index.
//
// Each line is written to fit two lines at `text-body` on a 390px screen, which
// is the budget the screen gives it.
//
// A later milestone may replace this list with a generated line of the day.
// That change has to keep exactly this contract — one line per calendar day,
// stable within the day — so it can slot in behind `quoteForDate` without the
// screen noticing.
// ---------------------------------------------------------------------------

export const MOTIVATION_QUOTES = [
  'Disziplin ist die Brücke zwischen Zielen und Ergebnissen.',
  'Fortschritt entsteht aus Wiederholung, nicht aus Motivation.',
  'Konzentriere dich auf das Wesentliche — der Rest kann warten.',
  'Kleine Schritte, jeden Tag, schlagen große Vorsätze.',
  'Klarheit über das Ziel macht den nächsten Schritt einfach.',
  'Was du heute beginnst, musst du morgen nicht mehr aufholen.',
  'Konsequenz schlägt Intensität — auf lange Sicht immer.',
  'Beginne mit der Aufgabe, die du am liebsten verschieben würdest.',
  'Zeit ist keine Frage des Habens, sondern des Entscheidens.',
  'Ruhe entsteht durch Ordnung, nicht durch weniger Arbeit.',
]

const DAY_MS = 24 * 60 * 60 * 1000

// Whole calendar days since the epoch, counted in LOCAL time.
//
// The date's own y/m/d go through `Date.UTC`, so the number changes exactly at
// local midnight and at no other moment: a timestamp-based division would move
// the boundary with the timezone and would jump an hour on every DST change,
// which is precisely the kind of "the quote changed at 2am" bug this function
// exists to rule out.
export function dayIndex(ref = new Date()) {
  return Math.floor(
    Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()) / DAY_MS
  )
}

// The line for a given calendar day. Rotates through the list; the double
// modulo keeps it correct for dates before 1970 as well.
export function quoteForDate(ref = new Date()) {
  const n = MOTIVATION_QUOTES.length
  return MOTIVATION_QUOTES[((dayIndex(ref) % n) + n) % n]
}
