import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, MoreHorizontal, Plus, RotateCcw } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import IconButton from '../components/IconButton'
import ListItemRow from '../components/ListItemRow'
import ListItemSheet from '../components/ListItemSheet'
import ListActionsSheet from '../components/ListActionsSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import { useLists } from '../context/ListsContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import { listTemplate } from '../config/listTemplates'
import { parseQuickAdd } from '../lib/listParsing'
import {
  formatAmount,
  groupByCategory,
  itemsOfList,
  openAmountTotal,
  partitionItems,
} from '../lib/listSelectors'

// How long the arrival animation of a row that changed section runs. Mirrors
// `list-settle-*` in src/index.css: the mark is dropped when it has played, so
// a later re-render never replays it.
const SETTLE_MS = 200

// A list is a stack of rows, so the drag is locked to the Y axis — the same
// modifier and the same sensors the Aufgaben list uses, which is what makes
// press-and-hold-to-reorder mean the same thing in both places.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 })

export default function ListeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    getList,
    items,
    loading,
    createItem,
    updateItem,
    setItemDone,
    deleteItem,
    reorderItems,
    togglePin,
    archiveList,
    unarchiveList,
    deleteList,
  } = useLists()
  const { openListForm } = useUI()
  const { showToast } = useToast()

  const list = getList(id)
  const template = list?.template ?? 'standard'
  const config = listTemplate(template)

  const [draft, setDraft] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The row that just changed section, and which way it went. Cleared on a
  // timer so the animation plays once and never again.
  const [settle, setSettle] = useState(null)
  const settleTimer = useRef(null)
  const [activeId, setActiveId] = useState(null)

  useEffect(() => () => clearTimeout(settleTimer.current), [])

  const mine = useMemo(() => itemsOfList(items, id), [items, id])
  const { open, done } = useMemo(() => partitionItems(mine), [mine])
  // One code path for every template: a list nobody has categorised is a single
  // unlabelled group, i.e. exactly the flat list with no headers drawn.
  const groups = useMemo(
    () => (config.fields.includes('category') ? groupByCategory(open) : [{ key: '', label: '', items: open }]),
    [open, config]
  )
  const total = useMemo(
    () => (config.fields.includes('amount') ? openAmountTotal(mine) : null),
    [mine, config]
  )
  const itemById = useMemo(() => {
    const map = {}
    for (const item of mine) map[item.id] = item
    return map
  }, [mine])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  )

  const markSettled = (itemId, direction) => {
    clearTimeout(settleTimer.current)
    setSettle({ id: itemId, direction })
    settleTimer.current = setTimeout(() => setSettle(null), SETTLE_MS)
  }

  if (!list) {
    return (
      <div className="px-5 pt-5 pb-28">
        <IconButton onClick={() => navigate('/listen')} className="-ml-1 text-text-primary" aria-label="Zurück">
          <ArrowLeft size={24} />
        </IconButton>
        <p className="mt-20 text-center text-body text-text-secondary">
          {loading ? 'Lädt…' : 'Liste nicht gefunden.'}
        </p>
      </div>
    )
  }

  const archived = !!list.is_archived

  // ── Entries ──────────────────────────────────────────────────────────────

  const handleAdd = () => {
    const parsed = parseQuickAdd(template, draft)
    if (!parsed) return
    setDraft('')
    createItem(list.id, parsed).catch(() => {})
  }

  // Ticking commits on the tap (§5/§7, G7): the entry moves into "Erledigt",
  // and the way back is the row's own circle, one section further down — so
  // there is nothing a toast could add that the screen is not already showing.
  const handleToggle = (item, next) => {
    markSettled(item.id, next ? 'down' : 'up')
    setItemDone(item, next).catch(() => {})
  }

  // One entry is small, and the delete is the kind of step §18/§19 asks to make
  // reversible rather than to guard with a dialog. The undo re-creates the row
  // with every field it had — a new id, which nothing on this screen or in the
  // database refers to, and to the user it is the entry coming back.
  const handleDeleteItem = (item) => {
    setEditingItem(null)
    deleteItem(item).catch(() => {})
    showToast('Eintrag gelöscht', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        createItem(list.id, {
          title: item.title,
          is_done: item.is_done,
          done_at: item.done_at,
          sort_order: item.sort_order,
          quantity: item.quantity,
          unit: item.unit,
          amount: item.amount,
          category: item.category,
        }).catch(() => {})
      },
    })
  }

  // ── Reordering ───────────────────────────────────────────────────────────
  // Within a group only. Dragging an entry into another category would be a
  // second, invisible way to set a category — the sheet is the one way, and a
  // drop across a boundary is simply ignored.
  const groupOf = (itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const from = groupOf(active.id)
    const to = groupOf(over.id)
    if (!from || !to || from.key !== to.key) return

    const ids = from.items.map((i) => i.id)
    const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id))
    // Renumber every open entry in the order it will now render, so the groups
    // keep their places and no two open entries share a sort_order.
    const order = groups.flatMap((g) => (g.key === from.key ? moved : g.items.map((i) => i.id)))
    const updates = order
      .map((itemId, index) => ({ id: itemId, sort_order: index }))
      .filter((u) => itemById[u.id]?.sort_order !== u.sort_order)
    if (updates.length) reorderItems(updates)
  }

  // ── The list itself ──────────────────────────────────────────────────────

  const handleArchive = () => {
    setMenuOpen(false)
    archiveList(list).catch(() => {})
    showToast('Liste abgeschlossen', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        unarchiveList(list).catch(() => {})
        showToast('Liste wieder aktiv')
      },
    })
    navigate('/listen')
  }

  const handleUnarchive = () => {
    setMenuOpen(false)
    unarchiveList(list).catch(() => {})
    showToast('Liste wieder aktiv')
  }

  const handleConfirmDelete = () => {
    setConfirmDelete(false)
    deleteList(list).catch(() => {})
    showToast('Liste gelöscht')
    navigate('/listen')
  }

  const activeItem = activeId ? itemById[activeId] : null
  const isEmpty = mine.length === 0

  return (
    <div className="min-h-screen pb-28">
      <div className="px-5 pt-5">
        <header className="flex items-center justify-between">
          <IconButton
            onClick={() => navigate('/listen')}
            aria-label="Zurück"
            className="-ml-1 text-text-primary"
          >
            <ArrowLeft size={24} />
          </IconButton>
          <IconButton
            onClick={() => setMenuOpen(true)}
            aria-label="Aktionen"
            className="-mr-1 text-text-primary"
          >
            <MoreHorizontal size={24} />
          </IconButton>
        </header>

        <h1 className="mt-4 text-[24px] font-bold leading-tight text-text-primary">
          {list.name}
        </h1>
        {/* Why this screen looks and behaves differently (§21) — the same muted
            12px line a task in the Papierkorb carries. */}
        {archived && (
          <p className="mt-1 flex items-center gap-1.5 text-caption text-text-muted">
            <Archive size={13} /> Archiviert
          </p>
        )}
      </div>

      {/* The add field stays reachable while the list scrolls under it: an
          entry is added while looking at the entries, not after scrolling back
          to the top. The head above it scrolls away normally. */}
      {!archived && (
        <div className="sticky top-0 z-20 bg-bg-base px-5 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder={config.itemPlaceholder}
              maxLength={200}
              aria-label={config.itemPlaceholder}
              className="min-w-0 flex-1 rounded-input bg-bg-input px-4 py-3 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
            />
            <button
              onClick={handleAdd}
              disabled={!draft.trim()}
              aria-label="Hinzufügen"
              className={`press-tint grid h-11 w-11 shrink-0 place-items-center rounded-btn transition-colors ${
                draft.trim() ? 'bg-accent text-white' : 'bg-bg-input text-text-muted'
              }`}
            >
              <Plus size={22} />
            </button>
          </div>

          {/* The open total of a Geld list: one quiet line, in the same muted
              caption every secondary line on this screen uses, and gone
              entirely when there is nothing open to add up. */}
          {total !== null && (
            <p className="mt-2 px-1 text-caption text-text-secondary">
              Offen gesamt{' '}
              <span className="font-semibold tabular-nums text-text-primary">
                {formatAmount(total)}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="px-5 pt-1">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-section font-semibold text-text-secondary">{config.emptyLabel}</p>
            <p className="mt-1 text-ui text-text-secondary">
              {archived ? 'Diese Liste wurde ohne Einträge abgeschlossen.' : config.emptyHint}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragStart={({ active }) => setActiveId(active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.key || 'ungrouped'} className="mb-1">
                  {group.label && <SectionLabel>{group.label}</SectionLabel>}
                  <Card className={group.label ? '' : 'mt-4'}>
                    <SortableContext
                      items={group.items.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {group.items.map((item, i) => (
                        <SortableItemRow
                          key={item.id}
                          item={item}
                          template={template}
                          onToggle={handleToggle}
                          onOpen={archived ? undefined : setEditingItem}
                          showBorder={i < group.items.length - 1}
                          settle={settle?.id === item.id ? settle.direction : null}
                        />
                      ))}
                    </SortableContext>
                  </Card>
                </div>
              )
            )}

            <DragOverlay>
              {activeItem ? (
                <div
                  className="rounded-card bg-bg-elevated shadow-xl shadow-black/50"
                  style={{ transform: 'scale(1.03)' }}
                >
                  <ListItemRow item={activeItem} template={template} showBorder={false} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {done.length > 0 && (
          <div className="mb-1">
            <SectionLabel>Erledigt</SectionLabel>
            <Card>
              {done.map((item, i) => (
                <ListItemRow
                  key={item.id}
                  item={item}
                  template={template}
                  onToggle={handleToggle}
                  onOpen={archived ? undefined : setEditingItem}
                  showBorder={i < done.length - 1}
                  settle={settle?.id === item.id ? settle.direction : null}
                />
              ))}
            </Card>
          </div>
        )}

        {/* An archived list has one thing worth doing to it, in the app's
            existing constructive style — the accent outline "Bearbeiten" uses.
            Reactivating is not destructive, so it must not wear the danger
            tint. */}
        {archived && (
          <button
            onClick={handleUnarchive}
            className="press-tint mt-6 flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-3.5 text-body font-semibold text-accent"
          >
            <RotateCcw size={18} /> Wieder aktivieren
          </button>
        )}
      </div>

      <ListItemSheet
        item={editingItem}
        template={template}
        onClose={() => setEditingItem(null)}
        onReopen={() => setEditingItem(editingItem)}
        onSave={(item, patch) => updateItem(item.id, patch)}
        onDelete={handleDeleteItem}
      />

      <ListActionsSheet
        list={list}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onReopen={() => setMenuOpen(true)}
        onEdit={() => {
          setMenuOpen(false)
          openListForm({ mode: 'edit', listId: list.id })
        }}
        onTogglePin={() => {
          setMenuOpen(false)
          togglePin(list).catch(() => {})
        }}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onDelete={() => {
          setMenuOpen(false)
          setConfirmDelete(true)
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Liste löschen?"
        message={`„${list.name}“ und alle Einträge werden endgültig gelöscht.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="px-1 pb-2 pt-4 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
      {children}
    </p>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-card border border-subtle bg-bg-card ${className}`}>
      {children}
    </div>
  )
}

function SortableItemRow({ item, ...rest }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <ListItemRow
        item={item}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        {...rest}
      />
    </div>
  )
}
