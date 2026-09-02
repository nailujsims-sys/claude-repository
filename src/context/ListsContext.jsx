import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { listRepository } from '../data/listRepository'
import { applyRealtimeChange, mergeRows } from '../lib/realtimeSync'
import { useRealtimeSync } from '../lib/useRealtimeSync'
import { nextSortOrder } from '../lib/listSelectors'
import { useAuth } from './AuthContext'

const ListsContext = createContext(null)

// Holds every list and every entry (including archived and done — screens
// filter via src/lib/listSelectors.js) plus all mutations. Built on exactly the
// same three pieces TasksContext uses: optimistic local state, a Supabase
// write, and a resync from the database when a write fails, so the screen never
// keeps showing something that was never stored.
//
// Two tables means two Realtime channels. They are independent on purpose: a
// tick in one device's shopping list is one `list_items` UPDATE, and it must not
// make the other device refetch its lists.
export function ListsProvider({ children }) {
  const { user } = useAuth()
  const repo = listRepository

  const [lists, setLists] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // `silent` is what a resync after a dropped connection uses: same rows, but
  // `loading` untouched, so the screen is not replaced by its skeleton for data
  // the user is already looking at. `mergeRows` keeps the previous array when
  // nothing changed — a reconnect that found no news causes no render at all.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const [listRows, itemRows] = await Promise.all([
          repo.listLists(user.id),
          repo.listItems(user.id),
        ])
        setLists((prev) => (silent ? mergeRows(prev, listRows) : listRows))
        setItems((prev) => (silent ? mergeRows(prev, itemRows) : itemRows))
        setError(null)
      } catch (err) {
        console.error(err)
        setError(err)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [user, repo]
  )

  useEffect(() => {
    load()
  }, [load])

  const resync = useCallback(() => load({ silent: true }), [load])
  const applyListChange = useCallback(
    (payload) => setLists((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )
  const applyItemChange = useCallback(
    (payload) => setItems((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )

  useRealtimeSync({
    table: 'lists',
    userId: user?.id ?? null,
    onChange: applyListChange,
    onResync: resync,
  })
  useRealtimeSync({
    table: 'list_items',
    userId: user?.id ?? null,
    onChange: applyItemChange,
    onResync: resync,
  })

  const upsert = (setRows) => (row) =>
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx === -1) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })
  const upsertList = upsert(setLists)
  const upsertItem = upsert(setItems)

  // ── Lists ────────────────────────────────────────────────────────────────

  const createList = useCallback(
    async (data) => {
      const sort_order = nextSortOrder(lists)
      const row = await repo.createList(user.id, { ...data, sort_order })
      upsertList(row)
      return row
    },
    [repo, user, lists]
  )

  const updateList = useCallback(
    async (id, patch) => {
      setLists((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
      try {
        const row = await repo.updateList(user.id, id, patch)
        upsertList(row)
        return row
      } catch (err) {
        console.error(err)
        setError(err)
        load() // resync on failure
        throw err
      }
    },
    [repo, user, load]
  )

  const togglePin = useCallback(
    (list) => updateList(list.id, { is_pinned: !list.is_pinned }),
    [updateList]
  )

  // "Liste abschließen": the list moves into the archive and nothing else
  // happens to it. Deliberately not "and tick every open entry off" — that half
  // would be the one thing reactivating cannot undo, and it is exactly the kind
  // of irreversible side effect the design system asks us to replace with a
  // reversible step plus an undo (§18/§19, Rule 6). So the entries keep their
  // state, "wieder aktivieren" gives the list back exactly as it was, and the
  // screens carry the undo toast the same delete already uses.
  const archiveList = useCallback(
    (list) =>
      updateList(list.id, { is_archived: true, archived_at: new Date().toISOString() }),
    [updateList]
  )

  // The inverse, and the whole of "wieder aktivieren". A patch rather than a
  // restored snapshot, exactly as the task Papierkorb's restore is: the entries
  // keep whatever state they have, so a list reactivated by accident is put
  // back untouched and can simply be archived again.
  const unarchiveList = useCallback(
    (list) => updateList(list.id, { is_archived: false, archived_at: null }),
    [updateList]
  )

  const deleteList = useCallback(
    async (list) => {
      const previousLists = lists
      const previousItems = items
      setLists((prev) => prev.filter((l) => l.id !== list.id))
      setItems((prev) => prev.filter((i) => i.list_id !== list.id))
      try {
        await repo.deleteList(user.id, list.id)
      } catch (err) {
        console.error(err)
        setError(err)
        // Put it back rather than leave the screen claiming a deletion that
        // never happened; `load()` then has the last word.
        setLists(previousLists)
        setItems(previousItems)
        load()
        throw err
      }
    },
    [repo, user, lists, items, load]
  )

  // ── Entries ──────────────────────────────────────────────────────────────

  const createItem = useCallback(
    async (listId, data) => {
      const sort_order = nextSortOrder(items.filter((i) => i.list_id === listId))
      const row = await repo.createItem(user.id, { sort_order, ...data, list_id: listId })
      upsertItem(row)
      return row
    },
    [repo, user, items]
  )

  const updateItem = useCallback(
    async (id, patch) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
      try {
        const row = await repo.updateItem(user.id, id, patch)
        upsertItem(row)
        return row
      } catch (err) {
        console.error(err)
        setError(err)
        load()
        throw err
      }
    },
    [repo, user, load]
  )

  // Ticking an entry off is what moves it into "Erledigt" — the section it
  // lands in follows from `is_done`, so there is one write and no second
  // "move" operation that could disagree with it.
  const setItemDone = useCallback(
    (item, done) =>
      updateItem(item.id, {
        is_done: done,
        done_at: done ? new Date().toISOString() : null,
      }),
    [updateItem]
  )

  const deleteItem = useCallback(
    async (item) => {
      const previous = items
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      try {
        await repo.deleteItem(user.id, item.id)
      } catch (err) {
        console.error(err)
        setError(err)
        setItems(previous)
        load()
        throw err
      }
    },
    [repo, user, items, load]
  )

  const reorderItems = useCallback(
    async (updates) => {
      setItems((prev) =>
        prev.map((i) => {
          const u = updates.find((x) => x.id === i.id)
          return u ? { ...i, ...u } : i
        })
      )
      try {
        await repo.reorderItems(user.id, updates)
      } catch (err) {
        console.error(err)
        setError(err)
        load()
      }
    },
    [repo, user, load]
  )

  const getList = useCallback((id) => lists.find((l) => l.id === id), [lists])

  const value = useMemo(
    () => ({
      lists,
      items,
      loading,
      error,
      reload: load,
      getList,
      createList,
      updateList,
      togglePin,
      archiveList,
      unarchiveList,
      deleteList,
      createItem,
      updateItem,
      setItemDone,
      deleteItem,
      reorderItems,
    }),
    [
      lists,
      items,
      loading,
      error,
      load,
      getList,
      createList,
      updateList,
      togglePin,
      archiveList,
      unarchiveList,
      deleteList,
      createItem,
      updateItem,
      setItemDone,
      deleteItem,
      reorderItems,
    ]
  )

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>
}

export function useLists() {
  const ctx = useContext(ListsContext)
  if (!ctx) throw new Error('useLists must be used within ListsProvider')
  return ctx
}
