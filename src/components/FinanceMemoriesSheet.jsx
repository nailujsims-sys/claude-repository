import { X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { useFinance } from '../context/FinanceContext'
import { useToast } from '../context/ToastContext'
import { memoryGroups } from '../lib/finance/ai/memories'

// „Gelerntes Wissen" — was die App beim nächsten KI-Import mitschickt.
//
// WARUM ES DIESE LISTE GIBT: weil das Gedächtnis sonst unsichtbar wäre. Eine
// Regel, die man nicht nachlesen kann, ist für den Nutzer nicht von einer
// Eigenmächtigkeit des Modells zu unterscheiden — und genau das soll dieses
// Modul nie sein. Hier steht in seinen Worten, was ChatGPT gleich gesagt
// bekommt.
//
// WAS SIE NICHT IST: eine Verwaltungsoberfläche. Man kann eine Erinnerung
// abschalten, und man kann das rückgängig machen — mehr nicht. Eine Regel zu
// bearbeiten hieße, sie vom Fall zu lösen, aus dem sie stammt; die bessere
// Regel entsteht bei der nächsten Korrektur und ERSETZT die alte (0012).
//
// ABSCHALTEN STATT LÖSCHEN, Toast mit „Rückgängig" statt Rückfrage (§18/§19):
// dieselbe Zusage wie überall sonst in der App, und der Grund, warum eine
// falsch gemerkte Regel kein Schaden ist, sondern ein Handgriff.
export default function FinanceMemoriesSheet({ open, onClose }) {
  const { aiMemories, categories, setAiMemoryActive } = useFinance()
  const { showToast } = useToast()

  const groups = memoryGroups(aiMemories, categories)

  const forget = async (entry) => {
    try {
      await setAiMemoryActive(entry.memory.id, false)
      showToast(`„${entry.title}" wird nicht mehr mitgeschickt`, {
        actionLabel: 'Rückgängig',
        onAction: async () => {
          try {
            await setAiMemoryActive(entry.memory.id, true)
          } catch {
            // Der eindeutige Index aus 0012 lässt nur eine aktive Regel je
            // Händler zu. Inzwischen eine neue gemerkt? Dann bleibt die neue.
            showToast('Dafür gilt inzwischen eine neuere Regel')
          }
        },
      })
    } catch {
      showToast('Das hat nicht geklappt')
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Gelerntes Wissen" z="z-[60]">
      <MemoryList groups={groups} onForget={forget} />
    </BottomSheet>
  )
}

// Der Inhalt des Sheets, ohne das Sheet — exportiert, damit ein echter Browser
// ihn vermessen kann (tools/financeLearningLayout.mjs).
export function MemoryList({ groups = [], onForget }) {
  return (
    <div className="px-5 pb-6">
      <p className="pt-1 text-caption text-text-secondary">
        Das schickt die App beim nächsten „KI-Kontext kopieren" mit. Feste Regeln gehen
        allgemeinen Annahmen vor, Beispiele sind Hinweise.
      </p>

      {groups.length === 0 && (
        <p className="py-4 text-ui text-text-secondary">
          Noch nichts gemerkt. Wenn du im Preview eine Buchung korrigierst, kannst du dort
          entscheiden, ob es beim nächsten Mal schon bekannt sein soll.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.kind} className="mt-4">
          <p className="px-1 pb-1 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
            {group.title}
          </p>
          <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
            {group.items.map((entry, i) => (
              <div
                key={entry.memory.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i < group.items.length - 1 ? 'border-b border-subtle' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium text-text-primary">{entry.title}</p>
                  <p className="truncate text-caption text-text-secondary">{entry.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onForget?.(entry)}
                  aria-label={`„${entry.title}" nicht mehr merken`}
                  className="press-tint -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-text-muted"
                >
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
