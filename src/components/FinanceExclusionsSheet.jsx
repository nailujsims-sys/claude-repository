import BottomSheet from './BottomSheet'
import Toggle from './Toggle'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { excludedMerchants } from '../lib/finance/analytics'

// The way back out of a global exclusion.
//
// A merchant switched off in the Zuordnung flow is recognised automatically from
// then on, so its bookings are resolved and never reach the queue again — which
// is exactly what the user asked for, and exactly why the switch they used would
// otherwise be unreachable. This sheet is that one door back, and deliberately
// nothing more: it is not merchant administration. New exclusions still happen
// where the booking is, with the booking in front of the user.
//
// It only exists while something is excluded; an account with nothing switched
// off gets no permanent UI for a state it is not in.
export default function FinanceExclusionsSheet() {
  const { financeExclusions, closeFinanceExclusions } = useUI()
  return financeExclusions ? <Sheet onClose={closeFinanceExclusions} /> : null
}

function Sheet({ onClose }) {
  const { merchants, setMerchantAnalytics } = useFinance()
  const excluded = excludedMerchants(merchants)

  return (
    <BottomSheet open onClose={onClose} title="Aus Auswertung ausgeschlossen">
      <div className="px-5 pb-6">
        <p className="pt-1 text-caption text-text-secondary">
          Buchungen dieser Händler zählen in keiner Auswertung. Die Buchungen selbst bleiben
          vollständig erhalten.
        </p>

        <div className="mt-3">
          {excluded.map((merchant) => (
            <div
              key={merchant.id}
              className="flex min-h-[44px] items-center justify-between gap-3 border-b border-subtle py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                {merchant.canonical_name}
              </span>
              <Toggle
                checked={false}
                onChange={() => setMerchantAnalytics(merchant.id, true)}
                label={`${merchant.canonical_name} wieder berücksichtigen`}
              />
            </div>
          ))}
          {excluded.length === 0 && (
            <p className="py-2 text-ui text-text-secondary">
              Es ist kein Händler mehr ausgeschlossen.
            </p>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
