import { addDays, startOfDay, startOfISOWeek, startOfMonth, toISODate } from './date'

// Demo calendar events for local mode, computed relative to "today" so every
// view (day / week / month) always looks alive and exercises the tricky cases:
// overlapping timed events, stacked multi-day bars, an all-day birthday, and a
// day dense enough to trigger the month view's "+X weitere". Never used when
// Supabase is configured.
export function seedEvents() {
  const today = startOfDay(new Date())
  const monday = startOfISOWeek(today)
  const at = (date, time) => `${toISODate(date)}T${time}`
  const day = (date) => `${toISODate(date)}T00:00`
  const d = (n) => addDays(monday, n) // Mon=0 … Sun=6 of the current week
  const mDay = (n) => addDays(startOfMonth(today), n)

  return [
    // Today — timed (Statistik + 1:1 overlap on purpose)
    { title: 'BWL Vorlesung', location: 'Raum A213', description: 'Kapitel 4: Investitionsrechnung.', start_at: at(today, '08:30'), end_at: at(today, '10:00') },
    { title: 'Statistik', location: 'Hörsaal 2', start_at: at(today, '10:15'), end_at: at(today, '11:45') },
    { title: 'Kurzes 1:1', location: 'Online', start_at: at(today, '10:30'), end_at: at(today, '11:15') },
    { title: 'Team Meeting', location: 'Büro', start_at: at(today, '13:00'), end_at: at(today, '14:00') },
    { title: 'Arzttermin', location: 'Praxis Dr. Müller', start_at: at(today, '15:30'), end_at: at(today, '16:30') },
    { title: 'Sport', location: 'Gym', start_at: at(today, '18:00'), end_at: at(today, '19:00') },

    // Elsewhere this week — timed
    { title: 'Marketing', location: 'Raum B1', start_at: at(d(3), '09:00'), end_at: at(d(3), '10:00') },
    { title: 'Kundentermin', location: 'Extern', start_at: at(d(3), '10:00'), end_at: at(d(3), '11:00') },
    { title: 'Lunch', start_at: at(d(3), '12:00'), end_at: at(d(3), '13:00') },
    { title: 'Projekt Update', location: 'Büro', start_at: at(d(3), '13:00'), end_at: at(d(3), '14:00') },
    { title: 'Yoga', location: 'Studio', start_at: at(d(5), '09:30'), end_at: at(d(5), '10:30') },

    // Multi-day / all-day bars (overlap on today → two stacked lanes)
    { title: 'Zuhause', all_day: true, start_at: day(addDays(today, -1)), end_at: day(addDays(today, 1)) },
    { title: 'Familientreffen', all_day: true, start_at: day(today), end_at: day(addDays(today, 2)) },
    { title: 'Workshop', all_day: true, start_at: day(d(8)), end_at: day(d(9)) },

    // All-day birthday (recurs yearly)
    { title: 'Geburtstag Mama', is_birthday: true, all_day: true, recurrence: 'FREQ=YEARLY', start_at: day(mDay(17)), end_at: day(mDay(17)) },

    // A couple more across the month
    { title: 'Präsentation', location: 'Raum C3', start_at: at(d(8), '14:00'), end_at: at(d(8), '15:00') },
    { title: 'Zahnarzt', location: 'Praxis', start_at: at(mDay(22), '11:00'), end_at: at(mDay(22), '11:30') },
  ]
}
