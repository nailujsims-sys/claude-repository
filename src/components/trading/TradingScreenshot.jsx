import { useState } from 'react'
import { ImageOff, LineChart } from 'lucide-react'
import { useTrading } from '../../context/TradingContext'

// A setup's screenshot, wherever it is shown — the card and the detail view.
//
// NEVER CROPPED. A chart cut at the edges loses exactly the information it was
// saved for (the level, the candle, the session marker), so the picture is
// always `object-contain`: the whole image, letterboxed on the app's base
// colour. The box keeps a fixed shape in the gallery (`aspect`), so the cards
// form a calm rhythm whatever the screenshots' proportions; the detail view
// passes none and the image takes its own height.
//
// The bucket is private: the URL comes from TradingContext, signed. An image
// that fails to load is most likely a signature that ran out — it asks for a
// fresh one once, then shows a quiet placeholder.
export default function TradingScreenshot({ setup, aspect = null, className = '' }) {
  const { urls, refreshUrl } = useTrading()
  const path = setup?.screenshot_path ?? null
  const url = path ? urls[path] : null
  const [failedUrl, setFailedUrl] = useState(null)

  const box = `relative overflow-hidden bg-bg-base ${className}`
  const style = aspect ? { aspectRatio: aspect } : undefined

  if (!path) {
    return (
      <div className={`${box} grid place-items-center`} style={style ?? { aspectRatio: '16 / 10' }}>
        <LineChart size={28} className="text-text-muted" aria-hidden />
        <span className="sr-only">Kein Screenshot</span>
      </div>
    )
  }

  // Still being signed — the box already has its final size, so nothing jumps
  // when the image arrives.
  if (url === undefined) {
    return <div className={`${box} skeleton-shimmer`} style={style ?? sizeStyle(setup)} aria-hidden />
  }

  if (url === null || failedUrl === url) {
    return (
      <div className={`${box} grid place-items-center`} style={style ?? sizeStyle(setup)}>
        <div className="flex flex-col items-center gap-1 text-text-muted">
          <ImageOff size={22} aria-hidden />
          <span className="text-caption">Bild nicht verfügbar</span>
        </div>
      </div>
    )
  }

  return (
    <div className={box} style={style}>
      <img
        src={url}
        alt={setup.name ? `Screenshot: ${setup.name}` : 'Screenshot'}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          setFailedUrl(url)
          refreshUrl(path)
        }}
        className={aspect ? 'absolute inset-0 h-full w-full object-contain' : 'block h-auto w-full object-contain'}
      />
    </div>
  )
}

// The detail view's placeholder takes the image's own proportions when they
// were stored, so the layout does not move when the picture comes in.
function sizeStyle(setup) {
  const w = setup?.screenshot_width
  const h = setup?.screenshot_height
  return w && h ? { aspectRatio: `${w} / ${h}` } : { aspectRatio: '16 / 10' }
}
