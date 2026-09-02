import { Check } from 'lucide-react'
import { itemTrailingLabel } from '../lib/listSelectors'

// One entry inside a list. The same row TaskRow is, deliberately: 60px minimum
// height, `px-4`, `gap-3`, a 22px circle on the left that commits on the tap,
// the whole row opening the thing it names, and the reorder drag riding on the
// row itself (press-and-hold) exactly as it does in the Aufgaben list.
//
// `settle` is the one thing this row has that TaskRow does not, and it is what
// makes the move into "Erledigt" readable: the row that just changed section
// arrives with a short 8px slide from the side it came from — down from above
// when it was ticked off, up from below when it was put back (§11, spatially
// coherent). It is a one-shot animation on arrival, never a transition on the
// list, so nothing about scrolling or dragging is affected, and under reduced
// motion it is the same fade with no travel (see src/index.css).
export default function ListItemRow({
  item,
  template,
  onToggle,
  onOpen,
  showBorder = true,
  dragHandleProps,
  isDragging = false,
  settle = null,
}) {
  const done = !!item.is_done
  const trailing = itemTrailingLabel(item, template)

  const handleCircle = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onToggle?.(item, !done)
  }

  return (
    <div
      className={`press-tint relative flex items-center gap-3 px-4 ${
        isDragging ? 'opacity-90' : ''
      } ${settle === 'down' ? 'list-settle-down' : settle === 'up' ? 'list-settle-up' : ''}`}
      style={{ minHeight: 52 }}
      onClick={() => onOpen?.(item)}
      {...dragHandleProps}
    >
      <button
        onClick={handleCircle}
        aria-label={done ? 'Als offen markieren' : 'Als erledigt markieren'}
        className="press-fade shrink-0"
      >
        <span
          className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition-colors ${
            done ? 'border-success bg-success' : 'border-text-muted'
          }`}
        >
          {/* The same green circle a completed task wears. "Erledigt" is a
              semantic state, which is the one thing success green is for
              (§14), and it already means exactly this everywhere else in the
              app — a second colour for the same meaning is how a module stops
              looking like part of the product. */}
          {done && <Check size={14} className="text-bg-base" strokeWidth={3} />}
        </span>
      </button>

      <div className="min-w-0 flex-1 py-2">
        <p
          className={`truncate text-body font-medium ${
            done ? 'text-text-secondary line-through' : 'text-text-primary'
          }`}
        >
          {item.title}
        </p>
      </div>

      {trailing && (
        <span
          className={`shrink-0 text-caption tabular-nums ${
            done ? 'text-text-muted line-through' : 'text-text-secondary'
          }`}
        >
          {trailing}
        </span>
      )}

      {showBorder && (
        <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-subtle" />
      )}
    </div>
  )
}
