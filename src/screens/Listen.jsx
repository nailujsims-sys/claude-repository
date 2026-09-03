import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Plus } from 'lucide-react'
import TopBar from '../components/TopBar'
import ListRow from '../components/ListRow'
import ListActionsSheet from '../components/ListActionsSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import { SkeletonListOverview } from '../components/Skeleton'
import { useLists } from '../context/ListsContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import { archivedLists, splitLists } from '../lib/listSelectors'

// The Listen overview: pinned lists, then the rest, then the way to create one
// and the (deliberately quiet) way into the archive.
//
// No counts and no progress anywhere on this screen — that is the brief's
// point, and it is also what keeps the row identical to every other row in the
// app: an icon, a name, and the row's own trailing action.
export default function Listen() {
  const { lists, loading, error, togglePin, archiveList, unarchiveList, deleteList } = useLists()
  const { openListForm } = useUI()
  const { showToast } = useToast()
  const navigate = useNavigate()

  // The list whose actions sheet is open, and the one waiting on a delete
  // confirmation. Two states rather than one: the sheet closes first, so the
  // dialog is never asked to sit inside a panel that is on its way out.
  const [menuList, setMenuList] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const { pinned, others } = useMemo(() => splitLists(lists), [lists])
  const archived = useMemo(() => archivedLists(lists), [lists])

  const closeMenu = () => setMenuList(null)

  // Archiving is reversible, so it commits on the press and the toast carries
  // the way back — the pattern G8 established for deleting a task, applied to
  // the operation that means the same thing here.
  const handleArchive = (list) => {
    closeMenu()
    archiveList(list).catch(() => {})
    showToast('Liste abgeschlossen', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        unarchiveList(list).catch(() => {})
        showToast('Liste wieder aktiv')
      },
    })
  }

  const handleTogglePin = (list) => {
    closeMenu()
    togglePin(list).catch(() => {})
  }

  // Deleting a list takes its entries with it and there is no Papierkorb for
  // them, so this is the one action here that genuinely cannot be taken back —
  // which is exactly what ConfirmDialog is for in this app (a Termin uses it
  // for the same reason).
  const handleConfirmDelete = () => {
    const list = pendingDelete
    setPendingDelete(null)
    if (!list) return
    deleteList(list).catch(() => {})
    showToast('Liste gelöscht')
  }

  const isEmpty = !loading && pinned.length === 0 && others.length === 0

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Listen" />

      <div className="px-5">
        {loading ? (
          <div className="pt-3">
            <SkeletonListOverview />
          </div>
        ) : isEmpty ? (
          <EmptyState failed={Boolean(error)} />
        ) : (
          <>
            {pinned.length > 0 && (
              <Section label="Angepinnt">
                {pinned.map((list, i) => (
                  <ListRow
                    key={list.id}
                    list={list}
                    onOpen={(l) => navigate(`/listen/${l.id}`)}
                    onMenu={setMenuList}
                    showBorder={i < pinned.length - 1}
                  />
                ))}
              </Section>
            )}

            {others.length > 0 && (
              <Section label={pinned.length > 0 ? 'Weitere Listen' : 'Listen'}>
                {others.map((list, i) => (
                  <ListRow
                    key={list.id}
                    list={list}
                    onOpen={(l) => navigate(`/listen/${l.id}`)}
                    onMenu={setMenuList}
                    showBorder={i < others.length - 1}
                  />
                ))}
              </Section>
            )}
          </>
        )}

        {/* The primary action of the screen, in the app's accent, directly
            under the lists it adds to. The Plus sheet reaches the same form
            from anywhere; this is the one that is where the user is looking. */}
        <button
          onClick={() => openListForm({ mode: 'create' })}
          className="press-tint mt-4 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
        >
          <Plus size={18} /> Neue Liste
        </button>

        {/* The archive: present, findable, and not competing with anything.
            One muted row at the foot of the screen, and only once there is
            something in it — an empty archive is a promise nobody needs. */}
        {archived.length > 0 && (
          <button
            onClick={() => navigate('/listen/archiv')}
            className="press-tint mt-3 flex w-full items-center gap-3 rounded-card border border-subtle bg-bg-card px-4 py-3.5 text-left"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-bg-elevated text-text-muted">
              <Archive size={18} />
            </span>
            <span className="flex-1 text-body font-medium text-text-secondary">
              Archivierte Listen
            </span>
            <span className="text-caption tabular-nums text-text-muted">{archived.length}</span>
            <ChevronRight size={18} className="text-text-muted" />
          </button>
        )}
      </div>

      <ListActionsSheet
        list={menuList}
        open={!!menuList}
        onClose={closeMenu}
        onReopen={() => setMenuList(menuList)}
        onEdit={() => {
          const list = menuList
          closeMenu()
          openListForm({ mode: 'edit', listId: list.id })
        }}
        onTogglePin={() => handleTogglePin(menuList)}
        onArchive={() => handleArchive(menuList)}
        onDelete={() => {
          const list = menuList
          closeMenu()
          setPendingDelete(list)
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Liste löschen?"
        message={`„${pendingDelete?.name ?? ''}“ und alle Einträge werden endgültig gelöscht.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div className="mb-1">
      <p className="px-1 pb-2 pt-4 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        {label}
      </p>
      <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        {children}
      </div>
    </div>
  )
}

// An empty screen means two very different things — "nothing here yet" is fine,
// "we could not reach the database" is not, and the banner above is already
// saying so. Same layout, honest words (the wording the Aufgaben list uses).
function EmptyState({ failed = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-section font-semibold text-text-secondary">
        {failed ? 'Keine Daten geladen' : 'Noch keine Listen'}
      </p>
      <p className="mt-1 text-ui text-text-secondary">
        {failed
          ? 'Sobald die Verbindung wieder steht, sind deine Listen da.'
          : 'Einkauf, Geschenkideen, offene Beträge — leg die erste Liste an.'}
      </p>
    </div>
  )
}
