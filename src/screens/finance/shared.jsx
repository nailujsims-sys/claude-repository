import { useCallback, useLayoutEffect } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import IconButton from '../../components/IconButton'
import { FinanceChangeLine } from '../../components/FinanceRows'
import { useFinanceView } from '../../context/FinanceViewContext'
import { formatAmountMinor } from '../../lib/finance/importFlow'

// Was die Finanz-Detailseiten gemeinsam haben: Kopfzeile, Zurück, Scroll-
// position und die eine ruhige Zusammenfassung oben.

/**
 * Zurück — dorthin, wo man herkam.
 *
 * DAS BESTEHENDE MUSTER, EINE STUFE WEITER. Listen und Aufgaben springen mit
 * „Zurück" auf eine feste Elternroute; das passt, weil ihre Detailseiten genau
 * einen Elternteil haben. Ein Drilldown hat mehrere: ein Händler wird von der
 * Übersicht, von der Händlerliste und von einer Kategorie aus geöffnet, und
 * „Zurück" muss in alle drei zurückführen, nicht in eine davon. Also geht es
 * einen Schritt im Verlauf zurück — und nur, wenn es keinen gibt (die Seite
 * wurde direkt geöffnet), auf die feste Elternroute.
 */
export function useFinanceBack(fallback) {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => {
    if (location.key !== 'default') navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, location.key, fallback])
}

/**
 * Die Scrollposition je Verlaufseintrag.
 *
 * Eine neue Seite beginnt oben — ohne das öffnete sich ein Händler, den man
 * weit unten auf der Übersicht angetippt hat, mitten in seiner eigenen Seite.
 * „Zurück" landet wieder dort, wo man war, statt oben auf der Übersicht.
 */
export function useFinanceScrollMemory() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const { scrollMemory } = useFinanceView()

  useLayoutEffect(() => {
    const key = location.key
    const saved = scrollMemory.current.get(key)
    window.scrollTo(0, navigationType === 'POP' && saved != null ? saved : 0)
    const onScroll = () => scrollMemory.current.set(key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
    // Nur je Verlaufseintrag — nicht bei jedem neuen Datenstand.
  }, [location.key])
}

/**
 * Die Kopfzeile einer Detailseite: Zurück, optional ein Bild, der Titel.
 *
 * Dieselbe Geometrie wie die TopBar — 16 px Rand, 12 px plus Safe-Area oben,
 * eine 40 px hohe Zeile, ein einzeiliger, abgeschnittener Titel in
 * `text-heading` — und ebenso `sticky`: auf einer Seite mit hundert Buchungen
 * bleibt der Weg zurück, wo der Daumen ihn erwartet. Wo die TopBar das Menü
 * trägt, steht hier der Pfeil, wie auf jeder anderen Detailseite dieser App.
 */
export function FinanceDetailHeader({ title, onBack, leading = null }) {
  return (
    <header
      data-detail-header=""
      className="sticky top-0 z-30 shrink-0 bg-bg-base px-4 pb-2"
      style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
    >
      <div className="flex h-10 items-center gap-2">
        <IconButton onClick={onBack} aria-label="Zurück" className="text-text-primary">
          <ArrowLeft size={24} />
        </IconButton>
        {leading}
        <h1 className="min-w-0 flex-1 truncate text-heading font-bold leading-[22px] text-text-primary">
          {title}
        </h1>
      </div>
    </header>
  )
}

/**
 * Die eine Karte oben auf einer Detailseite: Betrag, eine Zeile darunter, der
 * Vergleich. Dieselbe Form wie die Kennzahl des Dashboards — keine Wand aus
 * kleinen KPI-Kacheln, sondern eine Zahl, die man liest.
 */
export function FinanceSummaryCard({ amount, currency, caption, change, comparisonLabel }) {
  return (
    <section className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
      <h2 className="text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Ausgaben
      </h2>
      <p className="mt-1.5 truncate text-page font-bold tabular-nums leading-tight text-text-primary">
        {formatAmountMinor(amount, currency)}
      </p>
      {caption && <p className="mt-1 text-caption text-text-secondary">{caption}</p>}
      <FinanceChangeLine change={change} comparisonLabel={comparisonLabel} className="mt-0.5" />
    </section>
  )
}

/** Eine leise Zeile, die woanders hinführt — „Teil von …", „Buchungen prüfen". */
export function FinanceLinkRow({ label, onClick, className = 'mt-3', children = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press-tint flex min-h-[44px] w-full items-center gap-3 rounded-card bg-bg-card px-4 py-2 text-left ${className}`}
    >
      <span className="min-w-0 flex-1 truncate text-body text-text-primary">{label}</span>
      {children}
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

/** Was auf einer Detailseite steht, solange die Finanzdaten noch laden. */
export function FinanceDetailLoading() {
  return <p className="py-20 text-center text-body text-text-secondary">Lädt…</p>
}
