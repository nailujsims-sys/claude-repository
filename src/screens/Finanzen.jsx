import { useMemo } from 'react'
import { Upload } from 'lucide-react'
import TopBar from '../components/TopBar'
import { SkeletonExpenseList } from '../components/Skeleton'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { formatBookingDate, plural } from '../lib/finance/importFlow'

// Finanzen, at its first stage: a way in, and the one action that fills it.
//
// Deliberately not a dashboard. There is nothing to summarise yet that the user
// did not just tell the app — a chart over an empty account is decoration, and a
// full transaction list is the next module, not this one. What this screen owes
// the user is that importing a statement is never more than one tap away, which
// is why the button sits directly under the only number on the page.
export default function Finanzen() {
  const { transactions, account, loading, error } = useFinance()
  const { openFinanceImport } = useUI()

  const latest = useMemo(() => {
    let newest = null
    for (const t of transactions) {
      if (!newest || t.booking_date > newest) newest = t.booking_date
    }
    return newest
  }, [transactions])

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
              {plural(transactions.length, 'importierter Umsatz', 'importierte Umsätze')}
              {latest ? ` · zuletzt ${formatBookingDate(latest)}` : ''}
            </p>
          </section>
        )}

        {!loading && (
          <button
            onClick={openFinanceImport}
            className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
          >
            <Upload size={18} /> DKB-Umsätze importieren
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
          : 'Importiere deinen DKB-Umsatzexport — die Datei wird nur auf diesem Gerät gelesen.'}
      </p>
    </div>
  )
}
