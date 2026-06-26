import { addDays, startOfDay, startOfISOWeek, toISODate } from './date'

// Demo tasks used the first time the app runs in LOCAL mode, so the UI looks
// alive and matches the design. Dates are computed relative to "today" so the
// sections (HEUTE / MORGEN / …) always populate sensibly. Never used when
// Supabase is configured.
export function seedTasks() {
  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)
  const weekEnd = addDays(startOfISOWeek(today), 6) // Sunday of this week
  const thisMonth = addDays(today, 9)

  const t = toISODate(today)
  const tm = toISODate(tomorrow)
  const we = toISODate(weekEnd)
  const mo = toISODate(thisMonth)
  const past = toISODate(addDays(today, -2)) // 2 days ago → overdue, rolls to HEUTE

  const rows = [
    // HEUTE
    { title: 'Milch einkaufen', category: 'Privat', due_date: t },
    { title: 'Max wegen Abendessen schreiben', category: 'Privat', due_date: t },
    {
      title: 'Statistik lernen',
      category: 'Uni',
      subcategory: 'Statistik 1',
      due_date: t,
      is_favorite: true,
    },
    {
      title: 'Literatur für Hausarbeit lesen',
      category: 'Uni',
      subcategory: 'Hausarbeit',
      details:
        'Relevante Literatur für Kapitel 3 und 4 suchen und zusammenfassen. Besonders aktuelle Quellen bevorzugen.',
      due_date: t,
      is_favorite: true,
    },
    { title: 'Sport machen', category: 'Privat', due_date: t },

    // ÜBERFÄLLIG (Demo) — vor 2 Tagen fällig, erscheint automatisch unter HEUTE
    { title: 'Rechnung bezahlen', category: 'Arbeit', due_date: past },

    // MORGEN
    { title: 'Wäsche waschen', category: 'Privat', due_date: tm },
    {
      title: 'Kapitel 2 überarbeiten',
      category: 'Uni',
      subcategory: 'Hausarbeit',
      due_date: tm,
      is_favorite: true,
    },

    // DIESE WOCHE
    {
      title: 'Präsentation vorbereiten',
      category: 'Uni',
      subcategory: 'Marketingprojekt',
      due_date: we,
    },

    // DIESEN MONAT
    {
      title: 'Fahrrad zur Inspektion bringen',
      category: 'Privat',
      due_date: mo,
    },

    // SPÄTER
    { title: 'Steuerunterlagen sortieren', category: 'Privat', due_date: null },
  ]

  return rows.map((r, i) => ({ ...r, sort_order: i }))
}
