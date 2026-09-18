import { useMemo } from 'react'
import { Check, ChevronRight, Plus, Tag } from 'lucide-react'
import TopBar from '../components/TopBar'
import { SkeletonExpenseList } from '../components/Skeleton'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { buildClassificationQueue } from '../lib/finance/classificationQueue'
import { excludedMerchants } from '../lib/finance/analytics'
import { formatBookingDate, plural } from '../lib/finance/importFlow'

// Finanzen, at its first stage: a way in, and the one action that fills it.
//
// Deliberately not a dashboard. There is nothing to summarise yet that the user
// did not just tell the app — a chart over an empty account is decoration, and a
// full transaction list is the next module, not this one. What this screen owes
// the user is that adding money is never more than one tap away, which is why
// the button sits directly under the only number on the page.
//
// Since v1.23 that button is „Hinzufügen" and leads to a sheet with two ways —
// a booking by hand, and a statement of any bank read through ChatGPT. The DKB
// PDF import is still in the code and still works; it is simply no longer a
// path this screen offers.
export default function Finanzen() {
  const { transactions, account, patterns, merchants, categoryRules, overrides, aiSuggestions,
    loading, error } = useFinance()
  const { openFinanceAdd, openFinanceClassify, openFinanceExclusions } = useUI()

  // Which bookings still need a human is the engine's answer, asked fresh on
  // every render from rows the user can see — never a counter somebody wrote
  // into a column at import time.
  const { summary } = useMemo(
    () => buildClassificationQueue({
      transactions, patterns, merchants, rules: categoryRules, overrides, aiSuggestions,
    }),
    [transactions, patterns, merchants, categoryRules, overrides, aiSuggestions]
  )

  const latest = useMemo(() => {
    let newest = null
    for (const t of transactions) {
      if (!newest || t.booking_date > newest) newest = t.booking_date
    }
    return newest
  }, [transactions])

  // Only while something is excluded: an account with nothing switched off gets
  // no permanent row for a state it is not in.
  const excluded = useMemo(() => excludedMerchants(merchants), [merchants])

  const isEmpty = !loading && transactions.length === 0

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Finanzen" />

      <div className="px-5">
        {!loading && !isEmpty && (
          <section className="mt-1 rounded-card border border-subtle bg-bg-card px-4 py-4">
            <h2 className="text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
              {account?.name ?? 'Konto'}
            </h2>
            <p className="mt-2 text-page font-bold tabular-nums leading-tight text-text-primary">
              {transactions.length}
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              {plural(transactions.length, 'Umsatz', 'Umsätze')}
              {latest ? ` · zuletzt ${formatBookingDate(latest)}` : ''}
            </p>
          </section>
        )}

        {/* Ein Knopf, zwei Wege dahinter — was danach passiert, entscheidet der
            Zettel, nicht dieser Screen. Der direkte PDF-Import ist seit v1.23
            kein sichtbarer Weg mehr (siehe README → Legacy); der Code dafür ist
            unangetastet. */}
        {!loading && (
          <button
            onClick={openFinanceAdd}
            className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
          >
            <Plus size={18} /> Hinzufügen
          </button>
        )}

        {!loading && !isEmpty && <ClassifyCard summary={summary} onOpen={openFinanceClassify} />}

        {!loading && excluded.length > 0 && (
          <button
            onClick={openFinanceExclusions}
            className="press-tint mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-card bg-bg-card px-4 py-2 text-left"
          >
            <span className="min-w-0 flex-1 text-body text-text-primary">
              Aus Auswertung ausgeschlossen
            </span>
            <span className="shrink-0 tabular-nums text-body text-text-secondary">
              {excluded.length}
            </span>
            <ChevronRight size={18} className="shrink-0 text-text-muted" />
          </button>
        )}

        {loading ? (
          <div className="pt-4">
            <SkeletonExpenseList />
          </div>
        ) : isEmpty ? (
          <EmptyState failed={Boolean(error)} />
        ) : null}
      </div>
    </div>
  )
}

// The second thing this screen owes the user, after importing: knowing how much
// is still unsorted, and getting at it in one tap. Deliberately a small card
// with one number — an unsorted booking is a task, not a statistic, and a
// finished queue should feel finished rather than leave an empty block behind.
function ClassifyCard({ summary, onOpen }) {
  if (summary.offen === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 px-1 py-2">
        <Check size={16} className="shrink-0 text-success" />
        {/* Not „alle zugeordnet": a booking the user locked or decided by hand
            is out of the queue whether or not it carries both ids. */}
        <p className="text-caption text-text-secondary">Keine offenen Zuordnungen.</p>
      </div>
    )
  }

  const detail = [
    summary.konflikt > 0 ? `${summary.konflikt} mit zwei Händlern` : null,
    summary.pruefung > 0 ? `${summary.pruefung} zur Prüfung` : null,
  ].filter(Boolean)

  return (
    <section className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
      <div className="flex items-start gap-3">
        <Tag size={18} className="mt-0.5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-text-primary">Zuordnung</h2>
          <p className="mt-1 text-caption text-text-secondary">
            {plural(summary.offen, 'Umsatz wartet', 'Umsätze warten')} auf Händler und Kategorie
            {detail.length > 0 ? ` · ${detail.join(' · ')}` : ''}
          </p>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="press-tint mt-4 w-full rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary"
      >
        Jetzt zuordnen
      </button>
    </section>
  )
}

// Same two meanings as everywhere else in the app: "nothing here yet" is a
// normal state with an invitation, "we could not reach the database" is not and
// says so honestly.
function EmptyState({ failed = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-section font-semibold text-text-secondary">
        {failed ? 'Keine Daten geladen' : 'Noch keine Umsätze'}
      </p>
      <p className="mt-1 max-w-[280px] text-ui text-text-secondary">
        {failed
          ? 'Sobald die Verbindung wieder steht, sind deine Umsätze da.'
          : 'Trage eine Buchung von Hand ein oder lass deinen Kontoauszug über ChatGPT einlesen.'}
      </p>
    </div>
  )
}
