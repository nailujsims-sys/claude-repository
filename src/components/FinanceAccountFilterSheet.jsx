import { Check } from 'lucide-react'
import BottomSheet from './BottomSheet'

// Welches Konto ist gemeint?
//
// „ALLE KONTEN" IST DER STANDARD UND SCHLIESST ARCHIVIERTE EIN. Das ist die
// Zusage aus v1.25, hier zu Ende gedacht: ein archiviertes Konto verschwindet
// aus der Auswahl für NEUE Buchungen, nicht aus der eigenen Geschichte. Wer ein
// altes Konto einzeln anschauen will, findet es deshalb auch hier — mit einem
// leisen „Archiviert" daneben, damit klar ist, warum in diesem Monat nichts
// mehr dazukommt.
//
// WAS DIESES SHEET AUSDRÜCKLICH NICHT ÄNDERT: die Picker, in die geschrieben
// wird. `FinanceAccountPicker` filtert archivierte Konten weiterhin heraus, und
// das bleibt so — Lesen und Schreiben sind hier zwei verschiedene Fragen.
export default function FinanceAccountFilterSheet({
  open,
  onClose,
  accounts = [],
  archivedIds = [],
  value = null,
  onChange,
}) {
  const archived = new Set(archivedIds)
  const pick = (accountId) => {
    onChange?.(accountId)
    onClose?.()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Konto auswählen">
      <div className="overflow-y-auto px-5 pb-5">
        <div className="rounded-card bg-bg-card">
          <Row label="Alle Konten" hint={hintForAll(accounts.length)} active={value === null} onClick={() => pick(null)} />
          {accounts.map((account) => (
            <Row
              key={account.id}
              label={account.name}
              hint={[account.provider, archived.has(account.id) ? 'Archiviert' : null]
                .filter(Boolean)
                .join(' · ')}
              active={value === account.id}
              onClick={() => pick(account.id)}
              bordered
            />
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}

const hintForAll = (count) =>
  count === 1 ? '1 Konto' : `${count} Konten, auch archivierte`

function Row({ label, hint, active, onClick, bordered = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press-tint flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left ${
        bordered ? 'border-t border-subtle' : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-body ${
            active ? 'font-semibold text-text-primary' : 'text-text-primary'
          }`}
        >
          {label}
        </span>
        {hint ? (
          <span className="block truncate text-caption text-text-secondary">{hint}</span>
        ) : null}
      </span>
      {active && <Check size={18} className="shrink-0 text-accent" />}
    </button>
  )
}
