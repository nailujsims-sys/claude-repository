import { useEffect, useRef, useState } from 'react'
import { formatAmountMinor } from '../lib/finance/importFlow'

// Das Balkendiagramm der Ausgabenentwicklung.
//
// KEINE CHART-BIBLIOTHEK. Was hier gebraucht wird, sind bis zu zwölf Rechtecke
// mit Beschriftung — das sind ein paar `div`s mit einer Höhe in Prozent. Eine
// Bibliothek dafür wären 60 bis 150 kB im Bundle einer Handy-App, ein zweites
// Theme-System neben `tailwind.config.js` und eine fremde Vorstellung von
// Rückmeldung auf Druck. Die Vorgabe sagt es ausdrücklich, und sie hat recht.
//
// ES WIRD HIER NICHTS GERECHNET. Die Eimer kommen fertig aus
// src/lib/finance/analytics/trend.js: Beschriftung, Anfang, Ende, Betrag,
// angeschnitten. Diese Datei entscheidet nur, wie hoch ein Balken gezeichnet
// wird — und selbst das ist eine Division.
//
// DER LAUFENDE BALKEN IST DERSELBE BALKEN, nur mit weniger Deckkraft. Eine
// zweite Farbe würde behaupten, der September sei etwas anderes als der August;
// er ist nur noch nicht fertig.
//
// DAS TOOLTIP IST EIN POPOVER, kein Overlay: es verdunkelt nichts, es blockiert
// nichts, es nimmt keiner darunterliegenden Fläche die Escape-Taste ab. Es
// wächst aus seinem Balken heraus (§11, wie das Menü in TaskDetail) und geht
// wieder weg, wenn woanders hingetippt wird.

/** Die Höhe der Zeichenfläche in Pixeln — eine Zahl, damit die Balken rechnen können. */
const PLOT_HEIGHT = 132
/** Ein Balken mit 0 € bleibt sichtbar: eine leere Spalte sieht aus wie ein Fehler. */
const MIN_BAR = 3

export default function FinanceTrendChart({ series, currency = 'EUR' }) {
  const [openKey, setOpenKey] = useState(null)
  const rootRef = useRef(null)

  // Tippen außerhalb schließt das Tooltip. Kein Overlay, kein Fokus-Trap —
  // ein Popover, das sich wie eines verhält.
  useEffect(() => {
    if (!openKey) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpenKey(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openKey])

  const buckets = series?.buckets ?? []
  if (buckets.length === 0) return null

  // Negative Summen gibt es: ein Monat, in dem mehr zurückerstattet als
  // ausgegeben wurde. Sie bekommen keinen Balken nach unten — die Achse
  // beginnt bei null und der Balken bleibt der kleinste sichtbare —, aber das
  // Tooltip nennt den echten Betrag.
  const max = Math.max(series.max ?? 0, 1)

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex items-end gap-1.5"
        style={{ height: `${PLOT_HEIGHT}px` }}
        // `group`, nicht `list`: `role="listitem"` auf einem Button würde dessen
        // Rolle überschreiben, und ein Screenreader kündigte einen Listenpunkt
        // an, den man drücken kann, statt eine Schaltfläche.
        role="group"
        aria-label="Ausgaben je Zeitraum"
      >
        {buckets.map((bucket) => {
          const ratio = Math.max(0, bucket.amount) / max
          const height = Math.max(MIN_BAR, Math.round(ratio * (PLOT_HEIGHT - 22)))
          const open = openKey === bucket.key
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => setOpenKey(open ? null : bucket.key)}
              aria-expanded={open}
              aria-label={`${bucket.fullLabel}: ${formatAmountMinor(bucket.amount, currency)}${
                bucket.isPartial ? ', laufender Zeitraum' : ''
              }`}
              // Der ganze Streifen ist die Trefferfläche, nicht nur der Balken:
              // ein 3 Pixel hoher Balken wäre sonst unerreichbar (§22).
              className="press-tint flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
            >
              <span
                className={`w-full rounded-t-[4px] bg-accent transition-[height] duration-200 ease-out motion-reduce:transition-none ${
                  bucket.isPartial ? 'opacity-50' : ''
                } ${open ? 'ring-1 ring-inset ring-white/30' : ''}`}
                style={{ height: `${height}px` }}
              />
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        {buckets.map((bucket) => (
          <span
            key={bucket.key}
            className="min-w-0 flex-1 truncate text-center text-meta text-text-muted"
          >
            {bucket.label}
          </span>
        ))}
      </div>

      {openKey && <Tooltip bucket={buckets.find((b) => b.key === openKey)} currency={currency} />}
    </div>
  )
}

function Tooltip({ bucket, currency }) {
  if (!bucket) return null
  return (
    <div
      role="status"
      className="animate-menu-in mt-3 rounded-card bg-bg-input px-4 py-3 motion-reduce:animate-none"
    >
      <p className="text-caption text-text-secondary">
        {bucket.fullLabel}
        {bucket.isPartial ? ' · laufend' : ''}
      </p>
      <p className="mt-0.5 text-section font-bold tabular-nums text-text-primary">
        {formatAmountMinor(bucket.amount, currency)}
      </p>
    </div>
  )
}
