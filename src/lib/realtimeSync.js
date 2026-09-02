// The pure half of the cross-device sync: how a Postgres change turns into the
// next state of a row list. No React and no Supabase in here, so the rules that
// matter can be read in one place and tested without a websocket
// (see tools/realtimeLogic.mjs).
//
// Three properties this file exists to guarantee:
//
//   1. a change that we already have applied changes nothing — the same array
//      comes back, so our own writes never re-render the screen a second time;
//   2. a row belonging to somebody else is never taken in;
//   3. a DELETE for a row we do not hold is ignored. That is not a nicety:
//      Supabase cannot apply RLS to DELETE events (Postgres cannot prove who
//      was allowed to see a row that no longer exists), so a delete arrives at
//      every subscriber of the table carrying nothing but the primary key. The
//      guard below is what keeps a foreign delete from reaching our state.

// One channel per table and user. The user id is part of the name so a sign-out
// followed by a sign-in cannot land on the channel of the previous account.
export function channelTopic(table, userId) {
  return `sync:${table}:${userId}`
}

// The server-side half of "only relevant changes": Realtime evaluates this
// before it ever sends us a row. RLS still decides what may be read — this
// spares the connection the rows that would be rejected anyway.
export function ownRowsFilter(userId) {
  return `user_id=eq.${userId}`
}

// Same fields, same values — the row we already hold. `updated_at` is part of
// the comparison, so a genuine edit is never mistaken for an echo.
export function isSameRow(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

// Fold one Realtime payload into the row list.
//
// Returns the *identical* array when nothing changed. That is what the callers
// rely on: `setRows(prev => applyRealtimeChange(prev, payload, userId))` is then
// a no-op for React, which is how an echo of our own write stays invisible.
//
// Row order is deliberately not maintained here — every screen sorts the rows
// it shows (sort_order for tasks, start time for events), so appending is both
// correct and the cheapest thing that cannot reorder a list under the user.
export function applyRealtimeChange(rows, payload, userId) {
  const type = payload?.eventType
  const list = rows ?? []

  if (type === 'DELETE') {
    // Only the primary key survives a delete under RLS; anything else in
    // `old` would be a row we were never entitled to see.
    const id = payload.old?.id
    if (!id) return list
    if (!list.some((row) => row.id === id)) return list
    return list.filter((row) => row.id !== id)
  }

  if (type !== 'INSERT' && type !== 'UPDATE') return list

  const row = payload.new
  if (!row?.id) return list
  // Defence in depth behind RLS and the channel filter: a row that is not ours
  // never enters the state, whatever the server sent.
  if (userId && row.user_id && row.user_id !== userId) return list

  const index = list.findIndex((r) => r.id === row.id)
  if (index === -1) return [...list, row]
  if (isSameRow(list[index], row)) return list
  const next = [...list]
  next[index] = row
  return next
}

// The resync after a reconnect: the fresh list from the database, but the old
// array when the two say the same thing. A dropped and restored connection is
// then invisible — no re-render, no scroll jump, no flicker.
export function mergeRows(prev, next) {
  const current = prev ?? []
  const fresh = next ?? []
  if (current.length !== fresh.length) return fresh
  const byId = new Map(current.map((row) => [row.id, row]))
  const unchanged = fresh.every((row) => isSameRow(byId.get(row.id), row))
  return unchanged ? current : fresh
}
