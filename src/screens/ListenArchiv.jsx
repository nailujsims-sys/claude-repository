import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import IconButton from '../components/IconButton'
import ListRow from '../components/ListRow'
import { useLists } from '../context/ListsContext'
import { useToast } from '../context/ToastContext'
import { archivedLists, itemCountLabel } from '../lib/listSelectors'
import { formatLongDate } from '../lib/date'

// The archive, deliberately as plain as it can be: the finished lists, newest
// first, each with the one line of content that helps find it again and the one
// action worth having here. No versions, no history, no second overview.
//
// A row opens the list — an archived list is still readable — and the trailing
// RotateCcw puts it back, the same glyph in the same slot a deleted task uses
// for the same operation (G17).
export default function ListenArchiv() {
  const { lists, items, loading, unarchiveList } = useLists()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const archived = useMemo(() => archivedLists(lists), [lists])
  const countByList = useMemo(() => {
    const counts = {}
    for (const item of items) counts[item.list_id] = (counts[item.list_id] ?? 0) + 1
    return counts
  }, [items])

  // Commits on the tap, like every other restore in the app: the patch is the
  // exact inverse of the archive, so there is nothing to sit out. The toast
  // confirms it in the wording the overview already uses.
  const handleRestore = (list) => {
    unarchiveList(list).catch(() => {})
    showToast('Liste wieder aktiv')
  }

  return (
    <div className="min-h-screen pb-28">
      <div className="px-5 pt-5">
        <header className="flex items-center gap-2">
          <IconButton
            onClick={() => navigate('/listen')}
            aria-label="Zurück"
            className="-ml-1 text-text-primary"
          >
            <ArrowLeft size={24} />
          </IconButton>
          <h1 className="min-w-0 flex-1 truncate text-heading font-bold text-text-primary">
            Archivierte Listen
          </h1>
        </header>
      </div>

      <div className="px-5 pt-4">
        {loading ? (
          <p className="py-20 text-center text-body text-text-secondary">Lädt…</p>
        ) : archived.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-section font-semibold text-text-secondary">Archiv ist leer</p>
            <p className="mt-1 text-ui text-text-secondary">
              Abgeschlossene Listen landen hier und lassen sich jederzeit wieder aktivieren.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
              {archived.map((list, i) => (
                <ListRow
                  key={list.id}
                  list={list}
                  variant="archived"
                  subtitle={[
                    list.archived_at ? formatLongDate(new Date(list.archived_at)) : null,
                    itemCountLabel(countByList[list.id] ?? 0),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onOpen={(l) => navigate(`/listen/${l.id}`)}
                  onRestore={handleRestore}
                  showBorder={i < archived.length - 1}
                />
              ))}
            </div>
            <p className="mt-4 px-1 text-center text-caption text-text-muted">
              Archivierte Listen können jederzeit wieder aktiviert werden.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
