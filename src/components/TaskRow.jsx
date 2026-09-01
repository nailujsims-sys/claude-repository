import { Check, RotateCcw } from 'lucide-react'
import StarButton from './StarButton'
import { formatTime } from '../lib/date'

// A single task row inside a section card. Presentational — the list wires up
// the handlers and (optionally) drag listeners. Variants:
//   'active'    — normal, completable
//   'completed' — strikethrough, green check, tap circle to un-complete
//   'deleted'   — muted, non-interactive circle, restore action instead of
//                 the star (G17): in the Papierkorb the favourite toggle has
//                 nothing to act on, while getting the task back does.
export default function TaskRow({
  task,
  variant = 'active',
  onComplete,
  onUncomplete,
  onToggleFavorite,
  onRestore,
  onOpen,
  showBorder = true,
  dragHandleProps,
  isDragging = false,
  isOverdue = false,
}) {
  const completed = variant === 'completed'
  const deleted = variant === 'deleted'
  // Overdue styling only applies to open tasks (not completed/deleted).
  const overdue = isOverdue && variant === 'active'

  const handleCircle = (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (deleted) return
    if (completed) {
      onUncomplete?.(task)
      return
    }
    // Completion commits on the tap itself — there is no timer to sit out and
    // therefore no window in which the action is already running but can no
    // longer be stopped (§5/§7, G7). What follows is the screen's ordinary
    // re-render; the way back afterwards is the screen's business too (the
    // completed row's own circle, or an undo toast where that row is gone).
    onComplete?.(task)
  }

  // Restoring commits on the tap, like completing does (§5/§7, G7): the patch
  // is the exact inverse of the delete, so there is nothing to sit out and
  // nothing to protect the user from. The row's own re-render is the result.
  const handleRestore = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onRestore?.(task)
  }

  const subtitle = [task.category, task.subcategory].filter(Boolean).join(' · ')

  return (
    <div
      className={`press-tint relative flex items-center gap-3 px-4 ${
        isDragging ? 'opacity-90' : ''
      }`}
      style={{ minHeight: 60 }}
      onClick={() => onOpen?.(task)}
      {...dragHandleProps}
    >
      {/* Thin red accent on the card's left edge for overdue tasks */}
      {overdue && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-danger" />
      )}

      {/* Complete circle */}
      <button
        onClick={handleCircle}
        aria-label={completed ? 'Als offen markieren' : 'Als erledigt markieren'}
        className="press-fade shrink-0"
      >
        <span
          className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition-colors ${
            completed
              ? 'border-success bg-success'
              : deleted
                ? 'border-text-muted/50'
                : overdue
                  ? 'border-danger'
                  : 'border-text-muted'
          }`}
        >
          {completed && <Check size={14} className="text-bg-base" strokeWidth={3} />}
        </span>
      </button>

      {/* Title + subtitle */}
      <div className="min-w-0 flex-1 py-2">
        <p
          className={`truncate text-[15px] font-medium ${
            deleted
              ? 'text-text-muted line-through'
              : completed
                ? 'text-text-secondary line-through'
                : 'text-text-primary'
          }`}
        >
          {task.title}
        </p>
        {(subtitle || overdue) && (
          <p
            className={`truncate text-[12px] ${
              overdue ? 'text-danger' : 'text-text-secondary'
            }`}
          >
            {overdue
              ? subtitle
                ? `Überfällig · ${subtitle}`
                : 'Überfällig'
              : subtitle}
          </p>
        )}
      </div>

      {/* Right: due time (if any) then the row's own trailing action.
          A deleted row's star had nothing to toggle — the list never handed
          one down — so the slot carries the way back instead (G17). Same
          place, same press feedback, same focus ring; only the glyph and the
          meaning differ. */}
      {task.due_time && variant === 'active' && (
        <span className="shrink-0 text-[12px] text-text-secondary">
          {formatTime(task.due_time)}
        </span>
      )}
      {deleted ? (
        <button
          onClick={handleRestore}
          aria-label="Aufgabe wiederherstellen"
          className="press-fade shrink-0 p-1 text-text-secondary"
        >
          <RotateCcw size={22} />
        </button>
      ) : (
        <StarButton
          active={task.is_favorite}
          onToggle={() => onToggleFavorite?.(task)}
        />
      )}

      {showBorder && (
        <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-subtle" />
      )}
    </div>
  )
}
