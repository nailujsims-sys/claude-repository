import { ChevronRight, PenLine, Sparkles } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { useUI } from '../context/UIContext'

// „Hinzufügen" — der eine Einstieg in alles, was im Finanzmodul Geld anlegt.
//
// Zwei Optionen, und das ist keine Zwischenstufe: eine Buchung tippt man, oder
// man lässt einen Auszug lesen. Alles andere — welche Bank, welches Format,
// welche Datei — ist eine Frage, die danach kommt oder gar nicht mehr gestellt
// wird.
//
// Dieselbe Reihe wie ActionSheet.jsx, bewusst bis aufs Detail: Icon in der
// accent-getönten Kachel, Label, Chevron. Wer den Plus-Knopf der App kennt,
// kennt diesen Zettel schon (Rule 0 — wiederverwenden statt variieren).
export default function FinanceAddSheet() {
  const {
    financeAdd,
    openFinanceAdd,
    closeFinanceAdd,
    openFinanceManual,
    openFinanceAiImport,
  } = useUI()

  const open = (next) => {
    closeFinanceAdd()
    next()
  }

  return (
    <BottomSheet
      open={Boolean(financeAdd)}
      onClose={closeFinanceAdd}
      onReopen={openFinanceAdd}
      title="Hinzufügen"
    >
      <div className="px-3 pb-6">
        <Row
          icon={PenLine}
          label="Buchung manuell hinzufügen"
          hint="Eine einzelne Ausgabe oder Einnahme"
          onClick={() => open(openFinanceManual)}
        />
        <Row
          icon={Sparkles}
          label="KI-Import"
          hint="Kontoauszug über ChatGPT einlesen"
          onClick={() => open(openFinanceAiImport)}
        />
      </div>
    </BottomSheet>
  )
}

function Row({ icon: Icon, label, hint, onClick }) {
  return (
    <button
      onClick={onClick}
      className="press-tint flex w-full items-center gap-3 rounded-btn px-3 py-3.5 text-left"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-accent/15 text-accent">
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-text-primary">{label}</span>
        <span className="mt-0.5 block text-caption text-text-secondary">{hint}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}
