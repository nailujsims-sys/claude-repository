import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import IconButton from './IconButton'
import {
  MONTHS_DE,
  WEEKDAYS_DE,
  buildMonthGrid,
  parseISODate,
  startOfISOWeek,
  startOfMonth,
  toISODate,
  isSameDay,
} from '../lib/date'

// Inline month calendar supporting three selection granularities:
//   - tap a day        -> { due_type:'day',   due_date: that day }
//   - tap a KW number  -> { due_type:'week',  due_date: Monday of that week }
//   - tap the month    -> { due_type:'month', due_date: first of the month }
//
// value: { due_type, due_date(ISO string|null) }; onChange(nextValue)
export default function InlineCalendar({ value, onChange }) {
  const initial = value?.due_date ? parseISODate(value.due_date) : new Date()
  const [view, setView] = useState({
    year: initial.getFullYear(),
    month: initial.getMonth(),
  })

  const today = new Date()
  const weeks = buildMonthGrid(view.year, view.month)
  const selectedDate = value?.due_date ? parseISODate(value.due_date) : null
  const selMonday = selectedDate ? startOfISOWeek(selectedDate) : null

  const prevMonth = () =>
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }
    )
  const nextMonth = () =>
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }
    )

  const selectMonth = () =>
    onChange({
      due_type: 'month',
      due_date: toISODate(new Date(view.year, view.month, 1)),
    })
  const selectWeek = (anyDayInRow) =>
    onChange({ due_type: 'week', due_date: toISODate(startOfISOWeek(anyDayInRow)) })
  const selectDay = (iso) => onChange({ due_type: 'day', due_date: iso })

  // What kind of highlight does this day cell get?
  const dayState = (day) => {
    if (!selectedDate) return 'none'
    if (value.due_type === 'day') {
      return isSameDay(day.date, selectedDate) ? 'day' : 'none'
    }
    if (value.due_type === 'week') {
      return startOfISOWeek(day.date).getTime() === selMonday.getTime()
        ? 'week'
        : 'none'
    }
    if (value.due_type === 'month') {
      return day.date.getMonth() === selectedDate.getMonth() &&
        day.date.getFullYear() === selectedDate.getFullYear()
        ? 'month'
        : 'none'
    }
    return 'none'
  }

  const monthSelected =
    value?.due_type === 'month' &&
    selectedDate?.getMonth() === view.month &&
    selectedDate?.getFullYear() === view.year

  return (
    <div className="rounded-card bg-bg-input p-3">
      {/* Month header */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={selectMonth}
          className={`press-tint rounded-chip px-2 py-1 text-[16px] font-bold ${
            monthSelected ? 'bg-accent text-white' : 'text-text-primary'
          }`}
        >
          {MONTHS_DE[view.month]} {view.year}
        </button>
        <div className="flex items-center gap-1">
          <IconButton small onClick={prevMonth} aria-label="Vorheriger Monat" className="text-text-secondary">
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton small onClick={nextMonth} aria-label="Nächster Monat" className="text-text-secondary">
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      {/* Weekday + KW header */}
      <div className="grid grid-cols-8 gap-0.5 pb-1">
        {WEEKDAYS_DE.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-text-muted">
            {d}
          </div>
        ))}
        <div className="text-center text-[11px] font-semibold text-section-label">
          KW
        </div>
      </div>

      {/* Weeks */}
      <div className="space-y-0.5">
        {weeks.map((week) => {
          const weekSelected =
            value?.due_type === 'week' &&
            selMonday &&
            startOfISOWeek(week.days[0].date).getTime() === selMonday.getTime()
          return (
            <div key={week.weekNumber + '-' + week.days[0].iso} className="grid grid-cols-8 gap-0.5">
              {week.days.map((day) => {
                const state = dayState(day)
                const isToday = isSameDay(day.date, today)
                let cls =
                  'press-tint relative grid h-9 place-items-center rounded-full text-[14px] '
                if (state === 'day') cls += 'bg-accent text-white font-semibold'
                else if (state === 'week') cls += 'bg-accent/30 text-white'
                else if (state === 'month') cls += 'bg-accent/20 text-white'
                // Today: blue, bold number (no background). A selection above
                // overrides it — so picking today replaces this highlight.
                else if (isToday) cls += 'text-accent font-bold'
                else cls += day.inMonth ? 'text-text-primary' : 'text-text-muted'

                return (
                  <button key={day.iso} onClick={() => selectDay(day.iso)} className={cls}>
                    {day.date.getDate()}
                  </button>
                )
              })}
              {/* KW cell */}
              <button
                onClick={() => selectWeek(week.days[0].date)}
                aria-label={`Kalenderwoche ${week.weekNumber} auswählen`}
                className={`press-tint grid h-9 place-items-center rounded-full text-[13px] font-semibold ${
                  weekSelected ? 'bg-accent text-white' : 'text-section-label'
                }`}
              >
                {week.weekNumber}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
