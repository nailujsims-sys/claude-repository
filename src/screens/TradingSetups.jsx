import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Star, X } from 'lucide-react'
import TopBar from '../components/TopBar'
import Segmented from '../components/Segmented'
import TradingSetupCard from '../components/trading/TradingSetupCard'
import { SkeletonSetupGallery } from '../components/Skeleton'
import useScreenshotCapture from '../lib/useScreenshotCapture'
import { useTrading } from '../context/TradingContext'
import { useUI } from '../context/UIContext'
import {
  DEFAULT_FILTERS,
  SESSIONS,
  filterSetups,
  hasActiveFilters,
  setupCountLabel,
  sortAssets,
  sortSetups,
} from '../lib/trading'

// Four segments at 390px leave "New York" just enough room on one line, but
// only if it may not break there — a two-line segment next to one-line ones
// reads as a rendering fault. A non-breaking space here rather than a change
// to the shared Segmented, which other screens use with longer labels.
const SESSION_OPTIONS = [
  { id: 'all', label: 'Alle' },
  ...SESSIONS.map((s) => ({ ...s, label: s.label.replace(' ', ' ') })),
]

// Die Trading-Setup-Bibliothek: a column of screenshot cards, newest first,
// with the three filters and the search the brief asks for above it.
//
// Deliberately a library and nothing more — no trades, no statistics, no
// outcomes. What it has to be is quick in both directions: "Neues Setup" is
// the first thing on the page, and on a desktop a screenshot pasted (Strg+V /
// Cmd+V) or dropped anywhere on this screen opens the form with it already in
// place. Browsing is the other half: the screenshot is the card, and a tap
// opens the whole thing.
//
// The filters are component state, like the currency switch in Ausgaben: a
// way of looking at the library, not a setting to remember or sync.
export default function TradingSetups() {
  const { activate, setups, assets, loading, error, toggleFavorite } = useTrading()
  const { openTradingForm, openTradingDetail, tradingForm, tradingDetail, sidebarOpen, actionSheetOpen } = useUI()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  // The module loads on demand (see TradingContext).
  useEffect(() => {
    activate()
  }, [activate])

  // Paste or drop a screenshot on the library itself → a new setup with it.
  // Off while any overlay is up: the form takes its own pastes, and a paste
  // over the sidebar is not meant for the library.
  useScreenshotCapture({
    enabled: !tradingForm && !tradingDetail && !sidebarOpen && !actionSheetOpen,
    onFile: (file) => openTradingForm({ mode: 'create', file }),
  })

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))

  const sortedAssets = useMemo(() => sortAssets(assets), [assets])
  const assetsById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets])
  const all = useMemo(() => sortSetups(setups), [setups])
  const visible = useMemo(() => filterSetups(all, filters), [all, filters])

  // An asset filter that points at an asset no longer there (deleted on
  // another device) would show an empty library for no visible reason.
  useEffect(() => {
    if (filters.assetId && !assetsById[filters.assetId]) set({ assetId: null })
  }, [filters.assetId, assetsById])

  const filtered = hasActiveFilters(filters)
  const isEmpty = !loading && all.length === 0

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Trading-Setups" />

      <div className="px-5">
        <button
          onClick={() => openTradingForm({ mode: 'create' })}
          className="press-tint mt-1 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
        >
          <Plus size={18} /> Neues Setup
        </button>

        {!isEmpty && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-input bg-bg-input px-3 py-2">
              <Search size={16} className="shrink-0 text-text-muted" />
              <input
                value={filters.query}
                onChange={(e) => set({ query: e.target.value })}
                placeholder="Setups durchsuchen"
                aria-label="Setups durchsuchen"
                type="search"
                className="min-w-0 flex-1 bg-transparent py-1 text-field text-text-primary placeholder:text-text-muted outline-none"
              />
              {filters.query && (
                <button onClick={() => set({ query: '' })} aria-label="Suche leeren" className="press-fade p-1">
                  <X size={16} className="text-text-muted" />
                </button>
              )}
            </div>

            <Segmented
              options={SESSION_OPTIONS}
              value={filters.session}
              onChange={(session) => set({ session })}
              ariaLabel="Session"
            />

            {/* Favourites and assets in one scrolling row. Tapping an active
                asset again shows all assets — the chip is the toggle, there is
                no separate "Alle". The row clips vertically, so its top padding
                leaves room for a chip's focus ring. */}
            <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 pt-1" role="group" aria-label="Filter">
              <Chip
                active={filters.onlyFavorites}
                onClick={() => set({ onlyFavorites: !filters.onlyFavorites })}
              >
                <Star size={14} fill={filters.onlyFavorites ? 'currentColor' : 'none'} /> Favoriten
              </Chip>
              {sortedAssets.length > 0 && <span className="mx-1 my-1.5 w-px shrink-0 bg-white/10" aria-hidden />}
              {sortedAssets.map((asset) => (
                <Chip
                  key={asset.id}
                  active={filters.assetId === asset.id}
                  onClick={() => set({ assetId: filters.assetId === asset.id ? null : asset.id })}
                >
                  {asset.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="pt-4">
            <SkeletonSetupGallery />
          </div>
        ) : isEmpty ? (
          <EmptyState failed={Boolean(error)} />
        ) : (
          <>
            <div className="flex min-h-[44px] items-center justify-between gap-3 px-1 pt-2">
              <p className="text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
                {filtered ? `${visible.length} von ${setupCountLabel(all.length)}` : setupCountLabel(all.length)}
              </p>
              {filtered && (
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="press-fade text-label font-semibold text-accent"
                >
                  Filter zurücksetzen
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-section font-semibold text-text-secondary">Keine passenden Setups</p>
                <p className="mt-1 text-ui text-text-secondary">Lockere die Filter oder ändere die Suche.</p>
              </div>
            ) : (
              <div className="space-y-3" data-setup-gallery="">
                {visible.map((setup) => (
                  <TradingSetupCard
                    key={setup.id}
                    setup={setup}
                    assetsById={assetsById}
                    onOpen={(s) => openTradingDetail(s.id)}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// The chip of the Aufgaben category row, as a toggle.
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press-tint flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-chip px-3 py-1.5 text-ui font-medium transition-colors motion-reduce:transition-none ${
        active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

// Same layout and the same honest words as the other modules: "nothing here
// yet" and "we could not reach the database" are different statements.
function EmptyState({ failed = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-section font-semibold text-text-secondary">
        {failed ? 'Keine Daten geladen' : 'Noch keine Setups'}
      </p>
      <p className="mt-1 text-ui text-text-secondary">
        {failed
          ? 'Sobald die Verbindung wieder steht, sind deine Setups da.'
          : 'Screenshot aus dem Video einfügen, Namen geben, fertig.'}
      </p>
    </div>
  )
}
