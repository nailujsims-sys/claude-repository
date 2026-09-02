import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { channelTopic, ownRowsFilter } from './realtimeSync'

// One Supabase Realtime channel for one table, for as long as the provider is
// mounted and a user is signed in. Everything about *what* a change means lives
// in realtimeSync.js; this file is only about the subscription's life cycle.
//
// The effect depends on `table` and `userId` and on nothing else — the two
// callbacks are read through a ref. Without that, `onChange` would be a new
// function on every render and the channel would be torn down and rebuilt
// several times a second, which is the classic way to end up with a handful of
// live websockets and no idea why.
export function useRealtimeSync({ table, userId, onChange, onResync }) {
  const latest = useRef({ onChange, onResync })

  // Declared before the subscribing effect, so the ref is current by the time
  // the channel can call into it.
  useEffect(() => {
    latest.current = { onChange, onResync }
  }, [onChange, onResync])

  useEffect(() => {
    if (!supabase || !userId) return undefined

    let cancelled = false
    // Set once the channel has been live at least once. A *second* SUBSCRIBED
    // therefore means the connection had dropped and rejoined, and anything
    // that happened in the gap never reached us — that, and only that, is when
    // a resync is owed.
    let wasSubscribed = false

    const channel = supabase
      .channel(channelTopic(table, userId))
      // Inserts and updates carry the whole row, so Realtime can filter them
      // server-side to the rows that are ours.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, filter: ownRowsFilter(userId) },
        (payload) => latest.current.onChange(payload)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: ownRowsFilter(userId) },
        (payload) => latest.current.onChange(payload)
      )
      // Deletes cannot be filtered — a deleted row has no columns left to
      // filter on, so Supabase sends every subscriber the primary key and
      // nothing else. The handler drops any id we do not already hold, which
      // is why a foreign delete cannot touch our state (see realtimeSync.js).
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table },
        (payload) => latest.current.onChange(payload)
      )
      .subscribe((status) => {
        if (cancelled) return
        if (status !== 'SUBSCRIBED') return
        if (wasSubscribed) latest.current.onResync()
        wasSubscribed = true
      })

    return () => {
      cancelled = true
      // Leaves the channel and drops it from the client, so the socket closes
      // once the last channel is gone. Skipping this is how a remounting
      // provider accumulates subscriptions.
      supabase.removeChannel(channel)
    }
  }, [table, userId])
}
