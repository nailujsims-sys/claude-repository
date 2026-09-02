// A Realtime server for the smoke test.
//
// Same idea as supabaseStub.mjs: rather than mocking our own subscription code,
// this answers the very frames supabase-js puts on the wire, so the assertions
// are about the real client. It is installed as `window.WebSocket` — that is
// where @supabase/realtime-js picks its transport up.
//
// The Phoenix wire format is an array: [join_ref, ref, topic, event, payload].
//
// One hub can serve several windows, which is what makes a two-device test
// possible: window A writes, the stubbed database reports the change to the
// hub, and the hub pushes it to every other socket that subscribed to it.
//
// It is faithful about the one thing that matters for security: INSERT and
// UPDATE are filtered server-side by `user_id=eq.…` (standing in for the RLS
// check the real server performs), while DELETE is filtered by nothing at all
// and carries only the primary key — exactly the limitation Supabase
// documents, and the reason src/lib/realtimeSync.js guards against it.

const SOCKET_STATES = { connecting: 0, open: 1, closing: 2, closed: 3 }

export function makeRealtimeHub() {
  const sockets = []
  let nextBindingId = 1

  // `user_id=eq.<uuid>` — the only filter shape the app uses.
  function matchesFilter(filter, record) {
    if (!filter) return true
    const [column, rest] = filter.split('=')
    const [op, value] = rest.split('.')
    if (op !== 'eq') throw new Error(`realtimeStub: unsupported filter "${filter}"`)
    return String(record?.[column]) === value
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = SOCKET_STATES.connecting
      this.binaryType = 'arraybuffer'
      this.sent = []
      this.channels = new Map() // topic -> { joinRef, bindings }
      sockets.push(this)
      // Connect on the next tick, like a real socket.
      setTimeout(() => {
        if (this.readyState !== SOCKET_STATES.connecting) return
        this.readyState = SOCKET_STATES.open
        this.onopen?.({})
      }, 0)
    }

    send(raw) {
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw)
      this.sent.push({ topic, event, payload })

      if (event === 'phx_join') {
        const requested = payload?.config?.postgres_changes ?? []
        // The server echoes the bindings back, in order, each with an id. The
        // client compares them one by one and errors on any mismatch.
        const bindings = requested.map((binding) => ({ ...binding, id: nextBindingId++ }))
        this.channels.set(topic, { joinRef, bindings })
        return this.#reply(joinRef, ref, topic, { postgres_changes: bindings })
      }

      if (event === 'phx_leave') {
        this.channels.delete(topic)
        return this.#reply(joinRef, ref, topic, {})
      }

      // Heartbeats, access_token pushes, anything else: acknowledge, so no push
      // is left waiting for a reply that never comes.
      if (ref) this.#reply(joinRef, ref, topic, {})
    }

    close(code = 1000, reason = '') {
      if (this.readyState === SOCKET_STATES.closed) return
      this.readyState = SOCKET_STATES.closed
      this.channels.clear()
      this.onclose?.({ code, reason, wasClean: true })
    }

    #reply(joinRef, ref, topic, response) {
      this.#deliver([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }])
    }

    #deliver(frame) {
      if (this.readyState !== SOCKET_STATES.open) return
      this.onmessage?.({ data: JSON.stringify(frame) })
    }

    // Used by the hub; kept on the instance so `#deliver` stays private.
    push(topic, bindingId, data) {
      this.#deliver([null, null, topic, 'postgres_changes', { ids: [bindingId], data }])
    }
  }

  // One committed row change, announced to every subscriber that asked for it.
  // `change` is { table, type: 'INSERT'|'UPDATE'|'DELETE', record, old_record }.
  function emit(change) {
    const { table, type, record, old_record: oldRecord } = change
    for (const socket of sockets) {
      if (socket.readyState !== SOCKET_STATES.open) continue
      for (const [topic, channel] of socket.channels) {
        for (const binding of channel.bindings) {
          if (binding.table !== table) continue
          if (binding.event !== '*' && binding.event !== type) continue
          // A deleted row has no columns left to filter on, so the real server
          // sends the delete to everyone and strips it to the primary key.
          if (type !== 'DELETE' && !matchesFilter(binding.filter, record)) continue
          socket.push(topic, binding.id, {
            schema: 'public',
            table,
            commit_timestamp: new Date().toISOString(),
            type,
            // Empty `columns` means "already the right types" to the client's
            // converter — the stub deals in JS values, not Postgres text.
            columns: [],
            record: type === 'DELETE' ? {} : record,
            old_record: type === 'DELETE' ? { id: oldRecord?.id ?? record?.id } : (oldRecord ?? {}),
            errors: null,
          })
        }
      }
    }
  }

  return {
    WebSocket: FakeWebSocket,
    emit,
    sockets,
    openSockets: () => sockets.filter((s) => s.readyState === SOCKET_STATES.open),
    // Every channel currently joined across all sockets, as topics.
    joinedTopics: () =>
      sockets
        .filter((s) => s.readyState === SOCKET_STATES.open)
        .flatMap((s) => [...s.channels.keys()]),
    // Every join frame ever sent — a channel created twice shows up twice, even
    // if the second one was closed again.
    joinCount: (topic) =>
      sockets.reduce(
        (n, s) => n + s.sent.filter((m) => m.event === 'phx_join' && m.topic === topic).length,
        0
      ),
  }
}
