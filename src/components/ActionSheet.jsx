import { ChevronRight } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { useUI } from '../context/UIContext'
import { actionSheetItems } from '../config/navigation'

// The Plus-button action sheet. Maps each config item's `action` to a handler;
// the rows themselves come from `actionSheetItems`, so adding a creation flow
// is a config entry plus the one line that opens its form.
export default function ActionSheet() {
  const {
    actionSheetOpen,
    openActionSheet,
    closeActionSheet,
    openTaskForm,
    openEventForm,
    openListForm,
  } = useUI()

  const handle = (action) => {
    closeActionSheet()
    if (action === 'task') openTaskForm({ mode: 'create' })
    else if (action === 'event') openEventForm({ mode: 'create' })
    else if (action === 'list') openListForm({ mode: 'create' })
  }

  return (
    <BottomSheet
      open={actionSheetOpen}
      onClose={closeActionSheet}
      onReopen={openActionSheet}
      title="Erstellen"
    >
      <div className="px-3 pb-6">
        {actionSheetItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => handle(item.action)}
              className="press-tint flex w-full items-center gap-3 rounded-btn px-3 py-3.5 text-left"
            >
              <span className="grid h-10 w-10 place-items-center rounded-btn bg-accent/15 text-accent">
                <Icon size={20} />
              </span>
              <span className="flex-1 text-[15px] font-medium text-text-primary">
                {item.label}
              </span>
              <ChevronRight size={18} className="text-text-muted" />
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
