import { ExternalLink, PlayCircle, Trash2 } from 'lucide-react'
import BottomSheet from '../BottomSheet'
import StarButton from '../StarButton'
import TradingScreenshot from './TradingScreenshot'
import useRetained from '../../lib/useRetained'
import { useUI } from '../../context/UIContext'
import { useTrading } from '../../context/TradingContext'
import { useToast } from '../../context/ToastContext'
import { formatTimestamp, parseYouTubeUrl, setupFacts } from '../../lib/trading'
import { WRITABLE_SETUP_FIELDS } from '../../data/tradingDefaults'

// One setup, in full: the whole screenshot first, then everything written
// about it, then the way back to the video.
//
// The same full-screen sheet the forms use, with "Bearbeiten" where the forms
// have their save action — the edit form then slides up over this sheet and,
// on save, leaves it showing the corrected setup.
//
// The screenshot is shown at its own proportions, uncropped; a tap opens the
// original in a new tab, which is where a phone can pinch-zoom into a chart
// and a desktop can show it at full resolution.
//
// DELETING FOLLOWS THE APP'S RULE: commit on the press, "Rückgängig" in the
// toast for the next few seconds (§18/§19). It is an honest undo — the
// screenshot file is only removed once that window has passed (see
// TradingContext → removeLater), so the setup comes back with its picture.
export default function TradingSetupDetail() {
  const { tradingDetail, closeTradingDetail, openTradingForm } = useUI()
  const { getSetup, assets, urls, toggleFavorite, deleteSetup, restoreSetup } = useTrading()
  const { showToast } = useToast()

  const open = !!tradingDetail
  const retained = useRetained(tradingDetail)
  const live = retained ? getSetup(retained.setupId) : null
  // Kept for the exit animation after a delete, when the live row is gone.
  const setup = useRetained(live)

  // Deleted on another device while open: nothing left to show.
  const missing = open && !live

  const assetsById = Object.fromEntries(assets.map((a) => [a.id, a]))
  const facts = setup ? setupFacts(setup, assetsById) : []
  const link = setup?.youtube_url ? parseYouTubeUrl(setup.youtube_url) : null
  const imageUrl = setup?.screenshot_path ? urls[setup.screenshot_path] : null

  const handleDelete = () => {
    if (!live) return
    const snapshot = Object.fromEntries(
      WRITABLE_SETUP_FIELDS.filter((k) => k !== 'updated_at').map((k) => [k, live[k] ?? null])
    )
    closeTradingDetail()
    deleteSetup(live)
      .then(() =>
        showToast('Setup gelöscht', {
          actionLabel: 'Rückgängig',
          onAction: () => restoreSetup(snapshot).catch(() => {}),
        })
      )
      .catch(() => showToast('Das Setup konnte nicht gelöscht werden.'))
  }

  const editBtn = (
    <button
      onClick={() => live && openTradingForm({ mode: 'edit', setupId: live.id })}
      disabled={!live}
      className={`press-fade text-body font-semibold ${live ? 'text-accent' : 'text-text-muted'}`}
    >
      Bearbeiten
    </button>
  )

  return (
    <BottomSheet open={open} onClose={closeTradingDetail} full title="Setup" headerRight={editBtn}>
      {missing ? (
        <p className="px-5 py-16 text-center text-ui text-text-secondary">Dieses Setup gibt es nicht mehr.</p>
      ) : setup ? (
        <div className="pb-10" data-trading-detail="">
          {setup.screenshot_path && imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Screenshot in voller Größe öffnen">
              <TradingScreenshot setup={setup} />
            </a>
          ) : (
            <TradingScreenshot setup={setup} />
          )}

          <div className="px-5 pt-4">
            <div className="flex items-start gap-3">
              <h3 className="min-w-0 flex-1 break-words text-section font-semibold text-text-primary">
                {setup.name}
              </h3>
              <StarButton active={setup.is_favorite} onToggle={() => live && toggleFavorite(live)} className="-mr-1 -mt-0.5" />
            </div>

            {facts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {facts.map((fact) => (
                  <span key={fact} className="rounded-chip bg-bg-input px-2.5 py-1 text-label font-medium text-text-secondary">
                    {fact}
                  </span>
                ))}
              </div>
            )}

            {setup.description && (
              <p className="mt-4 whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
                {setup.description}
              </p>
            )}

            {setup.creator && (
              <p className="mt-4 text-ui text-text-secondary">
                Von <span className="font-medium text-text-primary">{setup.creator}</span>
              </p>
            )}

            {setup.youtube_url && (
              <a
                href={link?.url ?? setup.youtube_url}
                target="_blank"
                rel="noopener noreferrer"
                className="press-tint mt-5 flex items-center gap-3 rounded-btn bg-bg-card border border-subtle px-4 py-3.5"
              >
                <PlayCircle size={20} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-text-primary">Video ansehen</span>
                  <span className="block truncate text-caption text-text-secondary">
                    {link?.start != null ? `ab ${formatTimestamp(link.start)} · ` : ''}
                    {setup.youtube_url.replace(/^https?:\/\//, '')}
                  </span>
                </span>
                <ExternalLink size={16} className="shrink-0 text-text-muted" />
              </a>
            )}

            <button
              onClick={handleDelete}
              disabled={!live}
              className="press-tint mt-8 flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-body font-semibold text-danger"
              style={{ background: 'rgba(239, 68, 68, 0.12)' }}
            >
              <Trash2 size={18} /> Setup löschen
            </button>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  )
}
