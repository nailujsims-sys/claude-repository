import { MoreHorizontal, RotateCcw } from 'lucide-react'
import { listIcon } from '../config/listIcons'

// One list in the overview or in the archive. Presentational — the screen wires
// the handlers, and the row is built to the measurements every other row in the
// app uses: 60px minimum height, a 16px inset, `gap-3`, a boxed 36×36 icon, and
// a trailing slot carrying the row's own action.
//
// Unlike TaskRow it is two real buttons side by side rather than a clickable
// container with a button inside it. TaskRow can be a container because the
// whole row is also its drag handle; nothing drags here, so the row can be what
// it actually is — "open this list" and "act on this list" — which makes both
// reachable with the keyboard and keeps a focusable control out of the middle
// of another one. The seam is invisible: the leading button fills everything up
// to the trailing icon, so a press anywhere on the name still opens the list.
//
// The icon is monochrome on the app's elevated surface and never coloured per
// list: blue is the only accent (§14), and there is no per-list colour to pick
// or to store. A pinned list carries no badge of its own either — it is in the
// group headed "Angepinnt", which says it once, where a glyph in every row
// would say it again next to the control that toggles it.
//
// `subtitle` is the one line of content a row carries — the archive's date and
// entry count — and is left out entirely in the overview, where the brief asks
// for no counts and no progress at all.
//
// Variants mirror TaskRow's:
//   'active'   — the overview. Trailing: the "…" that opens the actions sheet.
//   'archived' — the archive. Trailing: the way back, the same RotateCcw a
//                deleted task uses (G17), because it is the same operation.
export default function ListRow({
  list,
  variant = 'active',
  subtitle = null,
  onOpen,
  onMenu,
  onRestore,
  showBorder = true,
}) {
  const Icon = listIcon(list.icon, list.template)
  const archived = variant === 'archived'

  return (
    <div className="relative flex items-center" style={{ minHeight: 60 }}>
      <button
        onClick={() => onOpen?.(list)}
        className="press-tint flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left"
      >
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-bg-elevated ${
            archived ? 'text-text-muted' : 'text-text-secondary'
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-body font-medium ${
              archived ? 'text-text-secondary' : 'text-text-primary'
            }`}
          >
            {list.name}
          </span>
          {subtitle && (
            <span className="block truncate text-caption text-text-secondary">{subtitle}</span>
          )}
        </span>
      </button>

      {archived ? (
        <button
          onClick={() => onRestore?.(list)}
          aria-label={`${list.name} wieder aktivieren`}
          className="press-fade mr-3 shrink-0 p-1 text-text-secondary"
        >
          <RotateCcw size={22} />
        </button>
      ) : (
        <button
          onClick={() => onMenu?.(list)}
          aria-label={`Aktionen für ${list.name}`}
          className="press-fade mr-3 shrink-0 p-1 text-text-secondary"
        >
          <MoreHorizontal size={22} />
        </button>
      )}

      {showBorder && (
        <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-subtle" />
      )}
    </div>
  )
}
