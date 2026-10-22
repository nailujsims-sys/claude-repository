import StarButton from '../StarButton'
import TradingScreenshot from './TradingScreenshot'
import { setupFacts } from '../../lib/trading'

// One setup in the library: the screenshot is the card, the words are its
// caption. The picture sits in a fixed 16:10 box — every card the same shape,
// so the gallery reads as a calm column — and is letterboxed, never cropped
// (see TradingScreenshot).
//
// The whole card opens the detail view; the star toggles the favourite
// without opening anything (StarButton stops the event). Press feedback is the
// app's `.press-tint`, on press, like every other tappable surface.
export default function TradingSetupCard({ setup, assetsById, onOpen, onToggleFavorite }) {
  const facts = setupFacts(setup, assetsById)
  return (
    <div className="relative overflow-hidden rounded-card border border-subtle bg-bg-card" data-setup-card={setup.id}>
      <button
        type="button"
        onClick={() => onOpen(setup)}
        className="press-tint block w-full text-left"
        aria-label={`${setup.name} öffnen`}
      >
        <TradingScreenshot setup={setup} aspect="16 / 10" />
        <div className="px-4 pb-3.5 pt-3 pr-14">
          <p className="truncate text-body font-semibold text-text-primary">{setup.name}</p>
          <p className="mt-0.5 truncate text-caption text-text-secondary">
            {facts.length > 0 ? facts.join(' · ') : 'Keine Angaben'}
          </p>
        </div>
      </button>
      {/* Outside the card's button — a button inside a button is invalid and
          swallows the tap on some browsers. Positioned over the caption row. */}
      <div className="absolute bottom-2 right-2">
        <StarButton active={setup.is_favorite} onToggle={() => onToggleFavorite(setup)} className="p-2" />
      </div>
    </div>
  )
}
