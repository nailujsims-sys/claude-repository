import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import TopBar from '../components/TopBar'
import CurrencySwitch from '../components/CurrencySwitch'
import ExpenseRow from '../components/ExpenseRow'
import { SkeletonExpenseList } from '../components/Skeleton'
import { useExpenses } from '../context/ExpensesContext'
import { useUI } from '../context/UIContext'
import {
  DEFAULT_CURRENCY,
  expenseCountLabel,
  formatMoney,
  formatRate,
  rateSourceLabel,
  sortExpenses,
  totalIn,
} from '../lib/expenses'

// Der Ausgabentracker fürs Auslandssemester: the total at the top, the switch
// that decides which currency everything is read in, and every expense under
// it, newest first.
//
// Deliberately one screen and nothing else — no categories, no budgets, no
// charts. What it has to be is fast: the total is the first thing on the page,
// "Neue Ausgabe" is directly under it (an expense is added while looking at
// what has been spent, not after scrolling past a semester of rows), and a tap
// on any row opens the same sheet again to correct it.
export default function Ausgaben() {
  const { expenses, loading, error, rate, rateSource, ensureRate } = useExpenses()
  const { openExpenseForm } = useUI()

  // The currency the whole screen is read in. Component state on purpose: it is
  // a way of looking at the same data, not a setting — it costs one tap to
  // change and there is nothing to remember or to sync between devices.
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)

  // "Beim Öffnen des Trackers … möglichst aktuellen Kurs verwenden". Cheap: a
  // rate loaded a moment ago is reused rather than re-fetched, and a failure
  // falls back instead of surfacing (see ExpensesContext → ensureRate).
  useEffect(() => {
    ensureRate()
  }, [ensureRate])

  const rows = useMemo(() => sortExpenses(expenses), [expenses])
  const total = useMemo(() => totalIn(expenses, currency), [expenses, currency])

  const isEmpty = !loading && rows.length === 0

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Ausgaben" />

      <div className="px-5">
        {/* The summary. One card, one number, and the switch on the label row
            next to it — the two things the brief puts "oben". */}
        <section className="mt-1 rounded-card border border-subtle bg-bg-card px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            {/* The switch keeps its size at 320px; the label is the half that
                gives way, as everywhere else in the app. */}
            <h2 className="min-w-0 truncate text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
              Gesamtausgaben
            </h2>
            <div className="shrink-0">
              <CurrencySwitch
                value={currency}
                onChange={setCurrency}
                label="Anzeigewährung"
              />
            </div>
          </div>

          <p className="mt-2 text-page font-bold tabular-nums leading-tight text-text-primary">
            {formatMoney(total, currency)}
          </p>

          <p className="mt-1 text-caption text-text-secondary">
            {expenseCountLabel(rows.length)}
          </p>

          {/* The rate, dezent: what is being used and how current it is, in the
              app's quietest text — never a badge and never a warning, because a
              fallback rate is a working state, not an error. */}
          <p className="mt-2 text-caption text-text-muted" data-rate-line="">
            {formatRate(rate)} · {rateSourceLabel(rateSource)}
          </p>
        </section>

        {/* The primary action of the screen, in the app's accent, directly
            under the total it adds to. The Plus sheet reaches the same form
            from anywhere; this is the one that is where the user is looking. */}
        <button
          onClick={() => openExpenseForm({ mode: 'create' })}
          className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
        >
          <Plus size={18} /> Neue Ausgabe
        </button>

        {loading ? (
          <div className="pt-4">
            <SkeletonExpenseList />
          </div>
        ) : isEmpty ? (
          <EmptyState failed={Boolean(error)} />
        ) : (
          <div className="mt-1">
            <p className="px-1 pb-2 pt-4 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
              Alle Ausgaben
            </p>
            <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
              {rows.map((expense, i) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  currency={currency}
                  onOpen={(e) => openExpenseForm({ mode: 'edit', expenseId: e.id })}
                  showBorder={i < rows.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// An empty screen means two very different things — "nothing here yet" is fine,
// "we could not reach the database" is not, and the banner above is already
// saying so. Same layout, honest words (the wording the other modules use).
function EmptyState({ failed = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-section font-semibold text-text-secondary">
        {failed ? 'Keine Daten geladen' : 'Noch keine Ausgaben'}
      </p>
      <p className="mt-1 text-ui text-text-secondary">
        {failed
          ? 'Sobald die Verbindung wieder steht, sind deine Ausgaben da.'
          : 'Kaffee, Miete, Bus — trag die erste Ausgabe ein.'}
      </p>
    </div>
  )
}
