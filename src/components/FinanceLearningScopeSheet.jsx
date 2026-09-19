import { useState } from 'react'
import { Check } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { learningOptions, sanitizeLearningMode } from '../lib/finance/ai/memories'

// „Für die Zukunft merken" — wie weit gilt diese Korrektur?
//
// DIE FRAGE WIRD NUR GESTELLT, WENN ES ETWAS ZU FRAGEN GIBT: der Aufrufer zeigt
// die Zeile erst, wenn der Mensch diese Buchung tatsächlich korrigiert hat. Und
// sie ist nie eine Pflicht — die Voreinstellung ist „Nur diese Buchung", und
// wer nichts antippt, hat damit schon geantwortet. Ein Import darf nicht daran
// hängen, dass jemand eine Meinung über die Zukunft hat.
//
// DREI STUFEN, DIE VERSCHIEDEN WEIT GEHEN:
//
//   Nur diese Buchung    nichts merken
//   Ähnliche Buchungen   dieser Fall als Beispiel — das Modell darf ihn
//                        übertragen, muss aber im Zweifel fragen
//   Immer für [Händler]  eine feste Regel mit Vorrang
//
// Die Dienstleister-Option ist die vierte und steht bewusst nicht gleichwertig
// daneben: für „PayPal" ist sie die richtige Antwort, für „REWE" eine Falle.
// Kennt die App den Namen als Dienstleister, steht sie oben; sonst liegt sie
// unter „Weitere Regel" — erreichbar, aber nicht angeboten.
//
// Dieselbe Reihe wie FinanceAddSheet/ActionSheet: Label, Erklärung, Haken statt
// Chevron, weil hier gewählt und nicht weitergegangen wird.
export default function FinanceLearningScopeSheet({ open, row, onClose, onChoose }) {
  if (!row) return null
  return (
    <BottomSheet open={open} onClose={onClose} title="Für die Zukunft merken" z="z-[60]">
      <ScopeOptions
        options={learningOptions(row)}
        chosen={sanitizeLearningMode(row)}
        onChoose={(mode) => {
          onChoose?.(mode)
          onClose?.()
        }}
      />
    </BottomSheet>
  )
}

// Der Inhalt des Sheets, ohne das Sheet — exportiert, damit ein echter Browser
// ihn vermessen kann (tools/financeLearningLayout.mjs). Was zugeklappt in einem
// Overlay liegt, misst kein statisches Rendering.
export function ScopeOptions({ options = [], chosen, onChoose }) {
  const [showMore, setShowMore] = useState(false)
  const primary = options.filter((option) => !option.secondary)
  const secondary = options.filter((option) => option.secondary)
  const moreOpen = showMore || secondary.some((option) => option.mode === chosen)

  return (
    <div className="px-3 pb-6">
      <p className="px-2 pb-1 pt-1 text-caption text-text-secondary">
        Deine Korrektur gilt auf jeden Fall für diese Buchung. Was davon soll beim nächsten
        KI-Import schon bekannt sein?
      </p>

      {primary.map((option) => (
        <ScopeRow
          key={option.mode}
          option={option}
          selected={option.mode === chosen}
          onClick={() => onChoose?.(option.mode)}
        />
      ))}

      {secondary.length > 0 && !moreOpen && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="press-tint mt-1 flex min-h-[44px] w-full items-center rounded-btn px-3 py-3 text-left text-ui text-text-secondary"
        >
          Weitere Regel …
        </button>
      )}

      {moreOpen &&
        secondary.map((option) => (
          <ScopeRow
            key={option.mode}
            option={option}
            selected={option.mode === chosen}
            onClick={() => onChoose?.(option.mode)}
          />
        ))}
    </div>
  )
}

function ScopeRow({ option, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="press-tint flex min-h-[44px] w-full items-center gap-3 rounded-btn px-3 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-text-primary">{option.label}</span>
        <span className="mt-0.5 block text-caption text-text-secondary">{option.hint}</span>
      </span>
      {selected && <Check size={18} className="shrink-0 text-accent" />}
    </button>
  )
}
