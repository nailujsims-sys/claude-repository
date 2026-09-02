import { Archive, ArchiveRestore, Pen, Pin, PinOff, Trash2 } from 'lucide-react'
import BottomSheet from './BottomSheet'

// Everything that can be done to a list, in one sheet.
//
// One implementation for both places it is reached from — the "…" on a row in
// the overview and the "…" in the detail header — because the actions are the
// same actions and a second interaction language for them is exactly what the
// design system's Rule 0 forbids. It is the app's existing auto-height
// BottomSheet with the same row shape ActionSheet uses (a boxed icon, a label,
// full-width press target), so it also inherits the grabber, drag-to-dismiss,
// Escape, the focus trap and the scroll lock without a line of its own.
//
// The rows follow the state of the list rather than a fixed menu: an archived
// list offers the way back and the delete, and nothing that would only be
// meaningful in the overview it is currently not in.
export default function ListActionsSheet({
  list,
  open,
  onClose,
  onReopen,
  onEdit,
  onTogglePin,
  onArchive,
  onUnarchive,
  onDelete,
}) {
  const archived = !!list?.is_archived
  const pinned = !!list?.is_pinned

  const rows = archived
    ? [
        {
          id: 'unarchive',
          label: 'Wieder aktivieren',
          icon: ArchiveRestore,
          onClick: onUnarchive,
        },
        { id: 'delete', label: 'Liste löschen', icon: Trash2, onClick: onDelete, danger: true },
      ]
    : [
        { id: 'edit', label: 'Liste bearbeiten', icon: Pen, onClick: onEdit },
        {
          id: 'pin',
          label: pinned ? 'Pin entfernen' : 'Anheften',
          icon: pinned ? PinOff : Pin,
          onClick: onTogglePin,
        },
        { id: 'archive', label: 'Liste abschließen', icon: Archive, onClick: onArchive },
        { id: 'delete', label: 'Liste löschen', icon: Trash2, onClick: onDelete, danger: true },
      ]

  return (
    <BottomSheet open={open} onClose={onClose} onReopen={onReopen} title={list?.name}>
      <div className="px-3 pb-6">
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <button
              key={row.id}
              onClick={row.onClick}
              className="press-tint flex w-full items-center gap-3 rounded-btn px-3 py-3.5 text-left"
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-btn ${
                  row.danger ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent'
                }`}
              >
                <Icon size={20} />
              </span>
              <span
                className={`flex-1 text-body font-medium ${
                  row.danger ? 'text-danger' : 'text-text-primary'
                }`}
              >
                {row.label}
              </span>
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
