import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { tradingRepository } from '../data/tradingRepository'
import { applyRealtimeChange, mergeRows } from '../lib/realtimeSync'
import { useRealtimeSync } from '../lib/useRealtimeSync'
import { TOAST_ACTION_MS, TOAST_EXIT_MS } from './ToastContext'
import { findAssetByName, normalizeAssetName, orphanedScreenshots } from '../lib/trading'
import { useAuth } from './AuthContext'

const TradingContext = createContext(null)

// How long a deleted setup's screenshot outlives its row: the undo toast, its
// exit, and a margin. Removing the file any earlier would leave "Rückgängig"
// restoring a setup whose picture is gone.
const SCREENSHOT_GRACE_MS = TOAST_ACTION_MS + TOAST_EXIT_MS + 1000

// Setups, assets and the signed URLs of their screenshots, plus every mutation.
// Built on the same three pieces as ExpensesContext: local state, a Supabase
// write, and a resync from the database when a write fails.
//
// ONE DIFFERENCE: IT LOADS ON DEMAND. Every other module is opened many times a
// day; this one is a library visited now and then. So nothing is fetched and no
// channel is opened until a screen of the module asks (`activate`) — an app
// start costs the user nothing for a module they did not open. Once active it
// stays active for the session, so going back and forth costs nothing either.
export function TradingProvider({ children }) {
  const { user } = useAuth()
  const repo = tradingRepository

  const [active, setActive] = useState(false)
  const [setups, setSetups] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // { [screenshot_path]: signedUrl }
  const [urls, setUrls] = useState({})

  // Paths whose file is waiting out the undo window: path → timeout id.
  const pendingRemovals = useRef(new Map())
  const swept = useRef(false)
  const refreshedAt = useRef(new Map())

  const activate = useCallback(() => setActive(true), [])

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const [setupRows, assetRows] = await Promise.all([
          repo.listSetups(user.id),
          repo.listAssets(user.id),
        ])
        setSetups((prev) => (silent ? mergeRows(prev, setupRows) : setupRows))
        setAssets((prev) => (silent ? mergeRows(prev, assetRows) : assetRows))
        setError(null)
        return setupRows
      } catch (err) {
        console.error(err)
        setError(err)
        return null
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [user, repo]
  )

  useEffect(() => {
    if (!active) return
    let cancelled = false
    load().then((rows) => {
      if (cancelled || !rows || swept.current) return
      swept.current = true
      sweepOrphans(rows)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, load])

  // Once per session, after the first successful load: files in the user's
  // folder that no setup needs any more are removed (see orphanedScreenshots
  // for why only old ones). Best effort and silent — a file that stays is a
  // few kilobytes, not a problem the user has to hear about.
  const sweepOrphans = async (rows) => {
    try {
      const objects = await repo.listScreenshotFiles(user.id)
      const orphans = orphanedScreenshots({ userId: user.id, objects, setups: rows })
        .filter((p) => !pendingRemovals.current.has(p))
      if (orphans.length) await repo.removeScreenshots(user.id, orphans)
    } catch (err) {
      console.warn('Screenshot-Aufräumen übersprungen:', err?.message ?? err)
    }
  }

  const resync = useCallback(() => load({ silent: true }), [load])
  const applySetupChange = useCallback(
    (payload) => setSetups((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )
  const applyAssetChange = useCallback(
    (payload) => setAssets((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )

  useRealtimeSync({
    table: 'trading_setups',
    userId: active ? user?.id ?? null : null,
    onChange: applySetupChange,
    onResync: resync,
  })
  useRealtimeSync({
    table: 'trading_assets',
    userId: active ? user?.id ?? null : null,
    onChange: applyAssetChange,
    onResync: resync,
  })

  // ── Signed URLs ──────────────────────────────────────────────────────────
  // Every screenshot path the library holds and has no URL for yet is signed
  // in one request. The bucket is private, so this is the only way an image
  // reaches the screen.
  useEffect(() => {
    const missing = setups.map((s) => s.screenshot_path).filter((p) => p && !(p in urls))
    if (missing.length === 0) return
    let cancelled = false
    repo
      .signScreenshots([...new Set(missing)])
      .then((signed) => {
        if (cancelled) return
        // A path the bucket could not sign is remembered as null, so it is not
        // asked for again on every render; the card shows its placeholder.
        setUrls((prev) => {
          const next = { ...prev }
          for (const p of missing) next[p] = signed[p] ?? null
          return next
        })
      })
      .catch((err) => console.warn('Screenshots konnten nicht geladen werden:', err?.message ?? err))
    return () => {
      cancelled = true
    }
  }, [setups, urls, repo])

  // An <img> that failed — most likely an expired signature. Re-signed at most
  // once a minute per path, so a file that is really gone does not turn into a
  // request loop.
  const refreshUrl = useCallback(
    async (path) => {
      if (!path) return
      const last = refreshedAt.current.get(path) ?? 0
      if (Date.now() - last < 60_000) return
      refreshedAt.current.set(path, Date.now())
      try {
        const signed = await repo.signScreenshots([path])
        setUrls((prev) => ({ ...prev, [path]: signed[path] ?? null }))
      } catch {
        // The placeholder stays; nothing else to do.
      }
    },
    [repo]
  )

  // ── Assets ───────────────────────────────────────────────────────────────

  // Returns the asset to select: an existing one when the name is already
  // there in any spelling, otherwise the newly stored one.
  const createAsset = useCallback(
    async (name) => {
      const clean = normalizeAssetName(name)
      if (!clean) throw new Error('Das Asset braucht einen Namen.')
      const existing = findAssetByName(assets, clean)
      if (existing) return existing
      try {
        const row = await repo.createAsset(user.id, { name: clean })
        setAssets((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row]))
        return row
      } catch (err) {
        // Created a moment ago on another device: the unique index says so.
        if (err?.code === '23505') {
          const rows = await repo.listAssets(user.id)
          setAssets(rows)
          const found = findAssetByName(rows, clean)
          if (found) return found
        }
        throw err
      }
    },
    [repo, user, assets]
  )

  // ── Setups ───────────────────────────────────────────────────────────────

  const upsert = (row) =>
    setSetups((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx === -1) return [row, ...prev]
      const next = [...prev]
      next[idx] = row
      return next
    })

  const removeLater = useCallback(
    (path) => {
      if (!path || pendingRemovals.current.has(path)) return
      const timer = setTimeout(() => {
        pendingRemovals.current.delete(path)
        repo.removeScreenshots(user.id, [path]).catch((err) =>
          console.warn('Screenshot konnte nicht gelöscht werden:', err?.message ?? err)
        )
      }, SCREENSHOT_GRACE_MS)
      pendingRemovals.current.set(path, timer)
    },
    [repo, user]
  )

  const keepFile = (path) => {
    const timer = pendingRemovals.current.get(path)
    if (timer) clearTimeout(timer)
    pendingRemovals.current.delete(path)
  }

  // Create or edit, screenshot included. `screenshot` says what happens to the
  // picture: { kind: 'keep' } · { kind: 'remove' } · { kind: 'new', file, type,
  // width, height }.
  //
  // THE ORDER IS WHAT KEEPS DATA SAFE
  //   1. a new file is uploaded under a fresh name — the old one is untouched;
  //   2. the row is written;
  //   3. only then is the file the row no longer needs removed.
  // A failure at 1 changes nothing. A failure at 2 removes the file uploaded at
  // 1 and leaves the row exactly as it was. Nothing the user had is ever lost
  // to a failed save.
  const saveSetup = useCallback(
    async ({ id = null, fields, screenshot = { kind: 'keep' } }) => {
      const previous = id ? setups.find((s) => s.id === id) ?? null : null
      if (id && !previous) throw new Error('Dieses Setup gibt es nicht mehr.')

      let uploaded = null
      const patch = { ...fields }
      if (screenshot.kind === 'new') {
        uploaded = await repo.uploadScreenshot(user.id, screenshot.file, screenshot.type)
        patch.screenshot_path = uploaded
        patch.screenshot_width = screenshot.width ?? null
        patch.screenshot_height = screenshot.height ?? null
      } else if (screenshot.kind === 'remove') {
        patch.screenshot_path = null
        patch.screenshot_width = null
        patch.screenshot_height = null
      }

      let row
      try {
        row = id ? await repo.updateSetup(user.id, id, patch) : await repo.createSetup(user.id, patch)
      } catch (err) {
        console.error(err)
        if (uploaded) repo.removeScreenshots(user.id, [uploaded]).catch(() => {})
        throw err
      }
      upsert(row)

      const oldPath = previous?.screenshot_path ?? null
      if (oldPath && oldPath !== row.screenshot_path) {
        repo.removeScreenshots(user.id, [oldPath]).catch((err) =>
          console.warn('Alter Screenshot konnte nicht gelöscht werden:', err?.message ?? err)
        )
      }
      return row
    },
    [repo, user, setups]
  )

  const toggleFavorite = useCallback(
    async (setup) => {
      const next = !setup.is_favorite
      setSetups((prev) => prev.map((s) => (s.id === setup.id ? { ...s, is_favorite: next } : s)))
      try {
        upsert(await repo.updateSetup(user.id, setup.id, { is_favorite: next }))
      } catch (err) {
        console.error(err)
        setError(err)
        load()
      }
    },
    [repo, user, load]
  )

  // The row goes now; the file waits out the undo window (removeLater).
  const deleteSetup = useCallback(
    async (setup) => {
      const previous = setups
      setSetups((prev) => prev.filter((s) => s.id !== setup.id))
      try {
        await repo.deleteSetup(user.id, setup.id)
        removeLater(setup.screenshot_path)
      } catch (err) {
        console.error(err)
        setError(err)
        setSetups(previous)
        load()
        throw err
      }
    },
    [repo, user, setups, load, removeLater]
  )

  // "Rückgängig": the same setup comes back with the same screenshot, because
  // its file has not been removed yet. It keeps its place in the library too —
  // `created_at` is not writable, so the order follows the restored row's own
  // timestamp, which puts it first; that is where the user is looking.
  const restoreSetup = useCallback(
    async (snapshot) => {
      keepFile(snapshot.screenshot_path)
      try {
        const row = await repo.createSetup(user.id, snapshot)
        upsert(row)
        return row
      } catch (err) {
        console.error(err)
        setError(err)
        removeLater(snapshot.screenshot_path)
        throw err
      }
    },
    [repo, user, removeLater]
  )

  const getSetup = useCallback((id) => setups.find((s) => s.id === id) ?? null, [setups])

  const value = useMemo(
    () => ({
      activate,
      setups,
      assets,
      loading,
      error,
      urls,
      refreshUrl,
      getSetup,
      createAsset,
      saveSetup,
      toggleFavorite,
      deleteSetup,
      restoreSetup,
    }),
    [activate, setups, assets, loading, error, urls, refreshUrl, getSetup, createAsset, saveSetup,
     toggleFavorite, deleteSetup, restoreSetup]
  )

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
}

export function useTrading() {
  const ctx = useContext(TradingContext)
  if (!ctx) throw new Error('useTrading must be used within TradingProvider')
  return ctx
}
