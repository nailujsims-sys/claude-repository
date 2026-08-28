import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useUI } from '../context/UIContext'
import { useTasks } from '../context/TasksContext'
import { buildSections, CATEGORIES } from '../lib/taskSelectors'
import { addDays, endOfMonth, isOverdue, startOfDay, startOfISOWeek, toISODate } from '../lib/date'
import IconButton from '../components/IconButton'
import TaskRow from '../components/TaskRow'
import FilterSheet, { FILTER_DEFAULTS } from '../components/FilterSheet'
import { SkeletonTaskList } from '../components/Skeleton'

const TABS = ['Alle', ...CATEGORIES]

// The list is a vertical stack of sections — lock dragging to the Y axis so it
// can't drift sideways.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 })

// New due date when a task is dragged into a given section.
function dueForSection(key) {
  const today = startOfDay(new Date())
  if (key === 'TODAY') return { due_date: toISODate(today), due_type: 'day' }
  if (key === 'TOMORROW') return { due_date: toISODate(addDays(today, 1)), due_type: 'day' }
  if (key === 'WEEK') {
    const weekEnd = addDays(startOfISOWeek(today), 6)
    let d = addDays(today, 2)
    if (d > weekEnd) d = weekEnd
    return { due_date: toISODate(d), due_type: 'day' }
  }
  if (key === 'MONTH') {
    const me = endOfMonth(today)
    let d = addDays(today, 5)
    if (d > me) d = me
    return { due_date: toISODate(d), due_type: 'day' }
  }
  return { due_date: null, due_type: 'day' } // LATER
}

export default function TasksList() {
  const { openSidebar } = useUI()
  const { tasks, loading, toggleFavorite, completeTask, uncompleteTask, reorderTasks } =
    useTasks()
  const navigate = useNavigate()

  const [category, setCategory] = useState('Alle')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filters, setFilters] = useState(FILTER_DEFAULTS)
  const [filterOpen, setFilterOpen] = useState(false)

  const sections = useMemo(
    () => buildSections(tasks, { category, search, ...filters }),
    [tasks, category, search, filters]
  )

  const taskById = useMemo(() => {
    const m = {}
    for (const t of tasks) m[t.id] = t
    return m
  }, [tasks])

  // ── Drag and drop state ────────────────────────────────────────────────
  const [activeId, setActiveId] = useState(null)
  // While dragging: { sectionKey: [taskId, ...] } of active rows only.
  const [dndContainers, setDndContainers] = useState(null)
  const startContainers = useRef(null)

  // Mouse: a small drag threshold, so a plain click still opens the task.
  // Touch: a long-press starts the drag — this is the key fix. The old
  // PointerSensor treated any >8px touch move as a drag, so simply scrolling
  // the list hijacked into a drag and flung rows around. With TouchSensor +
  // delay, a normal scroll swipe never starts a drag; you press-and-hold to drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  )

  const findContainer = (id) => {
    if (!dndContainers) return null
    if (id in dndContainers) return id
    return Object.keys(dndContainers).find((k) => dndContainers[k].includes(id))
  }

  const handleDragStart = ({ active }) => {
    const snapshot = {}
    for (const s of sections) snapshot[s.key] = s.active.map((t) => t.id)
    setDndContainers(snapshot)
    startContainers.current = snapshot
    setActiveId(active.id)
  }

  const handleDragOver = ({ active, over }) => {
    if (!over) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to || from === to) return
    setDndContainers((prev) => {
      const fromItems = prev[from]
      const toItems = prev[to]
      const overIndex =
        over.id in prev ? toItems.length : toItems.indexOf(over.id)
      const insertAt = overIndex >= 0 ? overIndex : toItems.length
      return {
        ...prev,
        [from]: fromItems.filter((id) => id !== active.id),
        [to]: [
          ...toItems.slice(0, insertAt),
          active.id,
          ...toItems.slice(insertAt),
        ],
      }
    })
  }

  const handleDragEnd = ({ active, over }) => {
    let final = dndContainers
    if (over && dndContainers) {
      const from = findContainer(active.id)
      const to = findContainer(over.id)
      if (from && to && from === to && !(over.id in dndContainers)) {
        const items = dndContainers[from]
        const oldIndex = items.indexOf(active.id)
        const newIndex = items.indexOf(over.id)
        if (oldIndex !== newIndex && newIndex >= 0) {
          final = { ...dndContainers, [from]: arrayMove(items, oldIndex, newIndex) }
        }
      }
    }
    persist(final)
    setActiveId(null)
    setDndContainers(null)
    startContainers.current = null
  }

  const persist = (containers) => {
    if (!containers) return
    const origin = startContainers.current || {}
    const originOf = (id) =>
      Object.keys(origin).find((k) => origin[k].includes(id))

    const updates = []
    for (const [key, ids] of Object.entries(containers)) {
      ids.forEach((id, index) => {
        const task = taskById[id]
        if (!task) return
        const patch = {}
        if (task.sort_order !== index) patch.sort_order = index
        if (id === activeId && originOf(id) !== key) {
          const due = dueForSection(key)
          patch.due_date = due.due_date
          patch.due_type = due.due_type
        }
        if (Object.keys(patch).length) updates.push({ id, ...patch })
      })
    }
    if (updates.length) reorderTasks(updates)
  }

  // Sections to render: during a drag, reorder active rows from the working map.
  const renderSections = useMemo(() => {
    if (!dndContainers) return sections
    return sections.map((s) => ({
      ...s,
      active: (dndContainers[s.key] || [])
        .map((id) => taskById[id])
        .filter(Boolean),
    }))
  }, [sections, dndContainers, taskById])

  const rowHandlers = {
    onOpen: (t) => navigate(`/aufgaben/${t.id}`),
    onToggleFavorite: toggleFavorite,
    onComplete: completeTask,
    onUncomplete: uncompleteTask,
  }

  const isEmpty = !loading && renderSections.length === 0
  const activeTask = activeId ? taskById[activeId] : null

  return (
    <div className="pb-28">
      {/* Sticky top — header + search + category tabs stay visible while the
          task list scrolls underneath. */}
      <div className="sticky top-0 z-30 border-b border-subtle bg-bg-base">
        {/* Header */}
        <header className="flex items-center gap-2 px-5 pt-5">
          <IconButton onClick={openSidebar} aria-label="Menü öffnen" className="-ml-1 text-text-primary">
            <Menu size={26} />
          </IconButton>
          <h1 className="flex-1 text-title font-bold text-text-primary">Aufgaben</h1>
          <IconButton
            onClick={() => {
              setSearchOpen((v) => !v)
              if (searchOpen) setSearch('')
            }}
            aria-label="Suche"
            className="text-text-primary"
          >
            <Search size={22} />
          </IconButton>
          <IconButton onClick={() => setFilterOpen(true)} aria-label="Filter" className="text-text-primary">
            <SlidersHorizontal size={22} />
          </IconButton>
        </header>

        {/* Search bar */}
        {searchOpen && (
          <div className="px-5 pt-3">
            <div className="flex items-center gap-2 rounded-input bg-bg-input px-3 py-2">
              <Search size={16} className="text-text-muted" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Aufgaben durchsuchen"
                className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Suche leeren" className="press-fade">
                  <X size={16} className="text-text-muted" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Category tabs. The row scrolls horizontally, which also clips it
            vertically — so 4px of the top margin is carried as padding instead,
            leaving room for a chip's focus ring inside the scroll box. Same
            12px above the chips as before. */}
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-5 pb-3 pt-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setCategory(tab)}
              className={`press-tint shrink-0 rounded-chip px-4 py-1.5 text-body-sm font-medium transition-colors ${
                category === tab ? 'bg-accent text-white' : 'text-text-secondary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-5 pt-3">
        {loading ? (
          <SkeletonTaskList />
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setActiveId(null)
              setDndContainers(null)
            }}
          >
            {renderSections.map((section) => (
              <Section key={section.key} section={section} rowHandlers={rowHandlers} />
            ))}
            <DragOverlay>
              {activeTask ? (
                <div
                  className="rounded-card bg-bg-elevated shadow-xl shadow-black/50"
                  style={{ transform: 'scale(1.03)' }}
                >
                  <TaskRow task={activeTask} isOverdue={isOverdue(activeTask)} showBorder={false} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
      />
    </div>
  )
}

// ── A section header + its card of rows ───────────────────────────────────
function Section({ section, rowHandlers }) {
  const { setNodeRef } = useDroppable({ id: section.key })
  const activeIds = section.active.map((t) => t.id)

  return (
    <div className="mb-1">
      <p className="px-1 pb-2 pt-4 text-caption font-semibold uppercase tracking-[0.08em] text-section-label">
        {section.label}
      </p>
      <div ref={setNodeRef} className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        <SortableContext items={activeIds} strategy={verticalListSortingStrategy}>
          {section.active.map((task, i) => (
            <SortableTaskRow
              key={task.id}
              task={task}
              isOverdue={isOverdue(task)}
              showBorder={
                i < section.active.length - 1 ||
                section.completed.length > 0 ||
                section.deleted.length > 0
              }
              {...rowHandlers}
            />
          ))}
        </SortableContext>

        {/* Completed (strikethrough) */}
        {section.completed.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            variant="completed"
            showBorder={i < section.completed.length - 1 || section.deleted.length > 0}
            {...rowHandlers}
          />
        ))}

        {/* Soft-deleted (muted) */}
        {section.deleted.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            variant="deleted"
            showBorder={i < section.deleted.length - 1}
            onOpen={rowHandlers.onOpen}
          />
        ))}
      </div>
    </div>
  )
}

function SortableTaskRow({ task, ...rest }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <TaskRow
        task={task}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        {...rest}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-section-title font-semibold text-text-secondary">Keine Aufgaben 🎉</p>
      <p className="mt-1 text-body-sm text-text-secondary">
        Tippe auf + um eine neue Aufgabe zu erstellen
      </p>
    </div>
  )
}
