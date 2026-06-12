import { useEffect, useState } from 'react'
import { Star, CheckCircle2, Trash2 } from 'lucide-react'
import BottomSheet from './BottomSheet'

const DEFAULTS = { onlyFavorites: false, showCompleted: false, showDeleted: false }

// Bottom-sheet filter panel for the Aufgaben list. Edits a draft and commits on
// "Anwenden"; "Zurücksetzen" restores defaults.
export default function FilterSheet({ open, onClose, value, onApply }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const toggle = (key) => setDraft((d) => ({ ...d, [key]: !d[key] }))

  const rows = [
    { key: 'onlyFavorites', label: 'Nur Favoriten', icon: Star },
    { key: 'showCompleted', label: 'Erledigte Aufgaben anzeigen', icon: CheckCircle2 },
    { key: 'showDeleted', label: 'Gelöschte Aufgaben anzeigen', icon: Trash2 },
  ]

  return (
    <BottomSheet open={open} onClose={onClose} title="Filter">
      <div className="px-5 pb-8">
        <div className="divide-y divide-white/[0.06]">
          {rows.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className="flex w-full items-center gap-3 py-3.5 text-left"
            >
              <Icon size={18} className="text-text-secondary" />
              <span className="flex-1 text-[15px] text-text-primary">{label}</span>
              <Switch on={draft[key]} />
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={() => setDraft(DEFAULTS)}
            className="flex-1 rounded-btn border border-subtle py-3 text-[15px] font-semibold text-text-secondary"
          >
            Zurücksetzen
          </button>
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="flex-1 rounded-btn bg-accent py-3 text-[15px] font-semibold text-white"
          >
            Anwenden
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

function Switch({ on }) {
  return (
    <span
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-bg-input'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </span>
  )
}

export { DEFAULTS as FILTER_DEFAULTS }
