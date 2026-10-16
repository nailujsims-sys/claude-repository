import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useFinance } from './FinanceContext'
import { DEFAULT_TREND_RANGE, financeScope, resolveAnalyticsEntries } from '../lib/finance/analytics'
import { todayISO } from '../lib/date'

const FinanceViewContext = createContext(null)

// Worüber die Finanz-Bildschirme gerade reden: Zeitraum, Konto, Verlaufsspanne
// — und die einmal aufgelösten Buchungen darunter (v1.27).
//
// WARUM EIN KONTEXT UND KEINE SUCHPARAMETER. Bis v1.26.2 lagen Zeitraum und
// Konto als `useState` in Finanzen.jsx. Mit vier Drilldown-Bildschirmen muss
// derselbe Zustand über Routenwechsel hinweg stehen bleiben: „Letzte 30 Tage ·
// DKB" → Lebensmittel → zurück ist wieder „Letzte 30 Tage · DKB". Zwei Fakten
// der bestehenden Router-Struktur entscheiden das:
//
//   • App.jsx rendert `<main key={location.pathname}>` — jeder Routenwechsel
//     baut den Bildschirm neu. Ein Layout-Route-Zustand INNERHALB von <main>
//     wäre bei jedem Tipp verloren. Er muss darüber liegen.
//   • Jeder andere modulweite Zustand dieser App liegt genau dort, in einem
//     Provider im angemeldeten Zweig (UIContext, FinanceContext). Das ist das
//     bestehende Muster; Suchparameter benutzt die App nirgends.
//
// Suchparameter hätten einen Vorteil — ein Neuladen auf einer Detailseite
// behielte den Zeitraum —, aber jeden Link, jedes „Zurück" und jedes Sheet
// gezwungen, einen serialisierten Zeitraum mitzuschleppen. Ein Neuladen setzt
// heute auf der Übersicht ebenso auf den laufenden Monat zurück; daran ändert
// sich nichts.
//
// `period = null` HEISST „DER LAUFENDE MONAT", nicht „der Monat, in dem die App
// gestartet wurde". `normalizePeriod` macht aus null den Monat von `today` —
// eine über Nacht offene App springt am Ersten also mit, statt still einen
// abgeschlossenen Monat als „aktuell" zu zeigen. Erst eine Wahl im Sheet legt
// einen festen Zeitraum fest.
//
// DIE EINORDNUNG LÄUFT EINMAL, NICHT PRO BILDSCHIRM. `resolveAnalyticsEntries`
// ist die teure Operation (Muster, Regeln, Overrides je Buchung). Weil jeder
// Routenwechsel den Bildschirm neu baut, hätte jeder Drilldown sie neu
// gestartet. Hier liegt sie hinter einem faulen Getter: sie läuft beim ersten
// Finanz-Bildschirm, der fragt — nicht beim App-Start auf der Startseite —, und
// danach erst wieder, wenn sich Buchungen oder Regeln wirklich geändert haben.
//
// Und noch eine kleine Sache, die zur Navigation gehört: die Scrollposition
// je Verlaufseintrag. Zurück landet dort, wo man war, statt oben.
export function FinanceViewProvider({ children }) {
  const {
    transactions, accounts, patterns, merchants, categories, categoryRules, overrides, aiSuggestions,
  } = useFinance()

  const today = todayISO()
  const [period, setPeriod] = useState(null)
  // `null` heißt „Alle Konten", archivierte eingeschlossen.
  const [accountId, setAccountId] = useState(null)
  const [trendRange, setTrendRange] = useState(DEFAULT_TREND_RANGE)
  const scrollMemory = useRef(new Map())

  // Der faule Getter: eine neue Funktion je Datenstand, und darin höchstens
  // eine Auflösung. Ein `useMemo` in einem Bildschirm, das `resolveEntries` in
  // seinen Abhängigkeiten hat, rechnet damit genau dann neu, wenn es etwas
  // Neues gibt.
  const resolveEntries = useMemo(() => {
    let cache = null
    return () => {
      if (!cache) {
        cache = resolveAnalyticsEntries({
          transactions, patterns, merchants, rules: categoryRules, overrides, aiSuggestions, categories,
        })
      }
      return cache
    }
  }, [transactions, patterns, merchants, categoryRules, overrides, aiSuggestions, categories])

  // Der Ausschnitt, wie ihn jeder Drilldown braucht. Ebenfalls faul — die
  // Übersicht baut ihn über `buildFinanceDashboard` selbst.
  const scopeFor = useCallback(
    () => financeScope({ entries: resolveEntries(), accounts, accountId, period, today }),
    [resolveEntries, accounts, accountId, period, today]
  )

  const value = useMemo(
    () => ({
      today,
      period,
      setPeriod,
      accountId,
      setAccountId,
      trendRange,
      setTrendRange,
      resolveEntries,
      scopeFor,
      scrollMemory,
    }),
    [today, period, accountId, trendRange, resolveEntries, scopeFor]
  )

  return <FinanceViewContext.Provider value={value}>{children}</FinanceViewContext.Provider>
}

export function useFinanceView() {
  const ctx = useContext(FinanceViewContext)
  if (!ctx) throw new Error('useFinanceView must be used within FinanceViewProvider')
  return ctx
}
