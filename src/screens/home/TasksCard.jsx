import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckSquare, Plus } from 'lucide-react'
import HomeCard from './HomeCard'
import TaskRow from '../../components/TaskRow'
import { SkeletonLine } from '../../components/Skeleton'
import { useTasks } from '../../context/TasksContext'
import { useToast } from '../../context/ToastContext'
import { useUI } from '../../context/UIContext'
import { homePreview } from '../../lib/taskSelectors'
import { isOverdue, todayISO } from '../../lib/date'

const SCOPES = [
  { id: 'today', label: 'Heute' },
  { id: 'week', label: 'Diese Woche' },
]

// ── Aufgaben ────────────────────────────────────────────────────────────────
//
// The open tasks of today or of the current week, on the same `TaskRow` the
// Aufgaben list and the calendar's day view use — so a task looks the same, and
// behaves the same, wherever it is met: tap the circle to complete it, the star
// to favourite it, the row to open it.
//
// The scope switch is the app's existing segmented control (Tag/Woche/Monat in
// the calendar, the category chips in Aufgaben): same box, same selected state,
// same press feedback. No new control was invented for it.
export default function TasksCard({ tasks, loading }) {
  const [scope, setScope] = useState('today')
  const navigate = useNavigate()
  const { completeTask, uncompleteTask, toggleFavorite } = useTasks()
  const { showToast } = useToast()
  const { openTaskForm } = useUI()

  const list = useMemo(() => homePreview(tasks, scope), [tasks, scope])

  // `homePreview` returns active tasks only, so completing one always takes the
  // row off the screen — the toast is then the only way back, and carries the
  // inverse the context already has. Identical to the calendar's day list,
  // which makes the same call from the same premise (G7, §19).
  const handleComplete = (task) => {
    completeTask(task).catch(() => {})
    showToast('Aufgabe erledigt', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        uncompleteTask(task).catch(() => {})
        showToast('Aufgabe wieder offen')
      },
    })
  }

  const handlers = {
    onComplete: handleComplete,
    onUncomplete: uncompleteTask,
    onToggleFavorite: toggleFavorite,
    onOpen: (t) => navigate(`/aufgaben/${t.id}`),
  }

  return (
    <HomeCard
      id="tasks"
      icon={CheckSquare}
      title="Aufgaben"
      caption={loading ? 'Lädt…' : `${list.length} offen`}
      trailing={
        <div className="flex shrink-0 rounded-chip bg-bg-input p-1">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              aria-pressed={scope === s.id}
              className={`press-tint rounded-chip px-2.5 py-1.5 text-label font-medium transition-colors ${
                scope === s.id ? 'bg-accent text-white' : 'text-text-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      }
      footer={
        // Creating from here means creating for here: the global sheet opens
        // pre-filled with today's date, so the task the user just added is in
        // the list they added it from — under Heute and, since today is part of
        // it, under Diese Woche too.
        <button
          type="button"
          onClick={() =>
            openTaskForm({
              mode: 'create',
              due: { due_type: 'day', due_date: todayISO() },
            })
          }
          className="press-tint flex w-full items-center gap-2 border-t border-subtle px-4 py-3 text-ui font-semibold text-accent"
        >
          <Plus size={18} />
          Aufgabe hinzufügen
        </button>
      }
    >
      {loading ? (
        <TasksSkeleton />
      ) : list.length === 0 ? (
        <p className="px-4 pb-4 text-ui text-text-secondary">
          {scope === 'today'
            ? 'Keine offenen Aufgaben heute.'
            : 'Keine offenen Aufgaben diese Woche.'}
        </p>
      ) : (
        <div>
          {list.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              isOverdue={isOverdue(task)}
              showBorder={i < list.length - 1}
              {...handlers}
            />
          ))}
        </div>
      )}
    </HomeCard>
  )
}

function TasksSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4" style={{ minHeight: 60 }}>
          <div className="skeleton-shimmer h-[22px] w-[22px] shrink-0 rounded-full bg-bg-elevated" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-3.5 w-2/3" />
            <SkeletonLine className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
