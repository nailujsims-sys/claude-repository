import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import FinancePeriodSheet from './FinancePeriodSheet'
import FinanceAccountFilterSheet from './FinanceAccountFilterSheet'
import { useFinance } from '../context/FinanceContext'
import { useFinanceView } from '../context/FinanceViewContext'

// „September 2026 · DKB Girokonto" — die Zeile, die sagt, worüber geredet wird.
//
// Bis v1.26.2 stand sie als zwei `FilterButton` und zwei Sheets in
// Finanzen.jsx. Seit v1.27 steht sie auf jedem Finanz-Bildschirm, und sie ist
// überall dieselbe Zeile mit demselben Zustand dahinter (FinanceViewContext):
// wer auf der Seite „Lebensmittel" den Zeitraum ändert, findet ihn auf der
// Übersicht wieder — es gibt nur einen.

function FilterButton({ label, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="press-tint flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 rounded-btn bg-bg-input px-3.5 py-2 text-left"
    >
      <span className="min-w-0 flex-1 truncate text-ui text-text-primary">{label}</span>
      <ChevronDown size={16} className="shrink-0 text-text-secondary" />
    </button>
  )
}

/** Die beiden Filterknöpfe, nebeneinander. Rein darstellend. */
export function FinanceScopeBar({ periodLabel, accountLabel, onPeriod, onAccount, className = 'mt-3' }) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <FilterButton label={periodLabel} onClick={onPeriod} ariaLabel="Zeitraum ändern" />
      <FilterButton label={accountLabel} onClick={onAccount} ariaLabel="Konto ändern" />
    </div>
  )
}

/** „Alle Konten" oder der Name des gewählten Kontos. */
export function useFinanceAccountLabel() {
  const { accounts } = useFinance()
  const { accountId } = useFinanceView()
  if (!accountId) return 'Alle Konten'
  return accounts.find((a) => a.id === accountId)?.name ?? 'Konto'
}

/**
 * Die beiden Sheets hinter der Filterzeile, verdrahtet mit dem gemeinsamen
 * Zustand. `sheet` ist 'period' | 'account' | null und gehört dem Bildschirm —
 * auch ein anderer Knopf („Konto wählen" bei zwei Währungen) darf es öffnen.
 */
export function FinanceScopeSheets({ sheet, onClose }) {
  const { accounts, archivedAccounts } = useFinance()
  const { today, period, setPeriod, accountId, setAccountId } = useFinanceView()
  const archivedIds = useMemo(() => archivedAccounts.map((a) => a.id), [archivedAccounts])
  return (
    <>
      <FinancePeriodSheet
        open={sheet === 'period'}
        onClose={onClose}
        value={period}
        today={today}
        onApply={setPeriod}
      />
      <FinanceAccountFilterSheet
        open={sheet === 'account'}
        onClose={onClose}
        accounts={accounts}
        archivedIds={archivedIds}
        value={accountId}
        onChange={setAccountId}
      />
    </>
  )
}

/**
 * Zwei Währungen, und deshalb keine Zahl — die Karte, die statt einer Summe
 * steht. Dieselbe auf der Übersicht und auf jeder Detailseite.
 *
 * WARUM HIER NICHTS STEHT, WAS WIE EINE SUMME AUSSIEHT: die Beträge liegen in
 * Minor Units ohne Kurs. 24,83 € und 24,83 AU$ zusammenzuzählen ergibt 49,66
 * von nichts — und das Schlimme daran ist nicht der Fehler, sondern dass er
 * aussieht wie ein Ergebnis.
 */
export function FinanceMixedNotice({ currencies = [], onPickAccount }) {
  return (
    <section className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
      <h2 className="text-section font-semibold text-text-primary">Mehrere Währungen</h2>
      <p className="mt-1.5 text-body text-text-secondary">
        Wähle ein einzelnes Konto, um Beträge korrekt auszuwerten.
      </p>
      <p className="mt-2 text-caption text-text-muted">
        In dieser Auswahl liegen {currencies.join(' und ')}. Umgerechnet wird nicht —
        eine Summe über zwei Währungen wäre keine.
      </p>
      <button
        onClick={onPickAccount}
        className="press-tint mt-4 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Konto wählen
      </button>
    </section>
  )
}
