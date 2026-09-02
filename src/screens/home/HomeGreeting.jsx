import { Quote } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNow } from '../../lib/useNow'
import { greetingLabel } from '../../lib/greeting'
import { quoteForDate } from '../../lib/quotes'
import { WEEKDAYS_DE_LONG, weekdayMon, formatLongDate } from '../../lib/date'

// The lead of the Heute screen: who is being greeted, what day it is, and the
// line of the day.
//
// It owns its own clock (the same `useNow` the calendar's now-line uses) rather
// than reading one from the screen, for the reason that hook exists: a ticking
// value re-renders whatever holds it, and there is no sense in re-rendering the
// task rows once a minute so that a greeting can change at 11:00. A minute of
// resolution is plenty for a boundary that moves three times a day — and it is
// what makes the greeting, the date and the quote roll over on their own, with
// no reload and nothing for the user to set.
export default function HomeGreeting() {
  const { displayName } = useAuth()
  const now = useNow(60000)

  return (
    <section className="mb-4 mt-1">
      <h2 className="text-page font-bold leading-tight text-text-primary">
        {greetingLabel(now)}, {displayName}
      </h2>
      <p className="mt-1 text-ui text-text-secondary">
        {WEEKDAYS_DE_LONG[weekdayMon(now)]}, {formatLongDate(now)}
      </p>

      {/* Two lines is the budget, and `line-clamp-2` is what enforces it — the
          list is written to fit, but a longer line later must shorten the
          quote, never the screen. */}
      <div className="mt-3 flex gap-2">
        <Quote
          size={18}
          className="mt-[3px] shrink-0 fill-accent-dim text-accent-dim"
        />
        <p className="line-clamp-2 text-body leading-snug text-text-secondary">
          {quoteForDate(now)}
        </p>
      </div>
    </section>
  )
}
