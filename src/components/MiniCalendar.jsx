import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import IconButton from './IconButton'
import {
  MONTHS_DE,
  WEEKDAYS_DE,
  buildMonthGrid,
  parseISODate,
  isSameDay,
} from '../lib/date'

// Compact single-day picker for the event form's Start/Ende date pills. Plain
// 'YYYY-MM-DD' in and out — no week/month granularity or KW column (that's the
// task-specific InlineCalendar). Styled to match the app's calendar surfaces so
// it reveals inline under a date pill without introducing a new look.
export default function MiniCalendar({ value, onChange }) {
  const initial = value ? parseISODate(value) : new Date()
  const [view, setView] = useState({
    year: initial.getFullYear(),
    month: initial.getMonth(),
  })

  const today = new Date()
  const weeks = buildMonthGrid(view.year, view.month)
  const selected = value ? parseISODate(value) : null

  const prevMonth = () =>
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }
    )
  const nextMonth = () =>
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }
    )

  return (
    <div className="mt-2 rounded-input bg-bg-input p-3">
      {/* Month header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-body font-bold text-text-primary">
          {MONTHS_DE[view.month]} {view.year}
        </span>
        <div className="flex items-center gap-1">
          <IconButton small onClick={prevMonth} aria-label="Vorheriger Monat" className="text-text-secondary">
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton small onClick={nextMonth} aria-label="Nächster Monat" className="text-text-secondary">
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5 pb-1">
        {WEEKDAYS_DE.map((d) => (
          <div key={d} className="text-center text-caption font-medium text-text-muted">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="space-y-0.5">
        {weeks.map((week) => (
          <div key={week.days[0].iso} className="grid grid-cols-7 gap-0.5">
            {week.days.map((day) => {
              const isSel = selected && isSameDay(day.date, selected)
              const isTod = isSameDay(day.date, today)
              let cls = 'press-tint grid h-9 place-items-center rounded-full text-body-sm '
              if (isSel) cls += 'bg-accent text-white font-semibold'
              else if (isTod) cls += 'text-accent font-bold'
              else cls += day.inMonth ? 'text-text-primary' : 'text-text-muted'
              return (
                <button
                  type="button"
                  key={day.iso}
                  onClick={() => onChange(day.iso)}
                  className={cls}
                >
                  {day.date.getDate()}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
