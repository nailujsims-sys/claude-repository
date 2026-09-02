// Who wins when both sides changed: the most recent change, whichever side it
// happened on. No "Google always wins", no "the app always wins".
//
// Each side carries its own version stamp:
//   • the app  — `events.updated_at`, written by the `set_updated_at` trigger
//   • Google   — `event.updated`, which Google sets on every change
//
// They come from different clocks, so a comparison is only ever made when it
// has to be: when the local row is `pending`, meaning it holds a change that
// Google has not seen. In every other case one side simply has news and the
// other does not, and no arbitration is needed.

export const GOOGLE = 'google'
export const LOCAL = 'local'
export const NONE = 'none'

const ms = (value) => {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

// What to do with an incoming Google version of an event.
//
//   'google' — take Google's version
//   'local'  — keep ours; it is newer and still owed to Google
//   'none'   — nothing to do (we already hold exactly this version)
export function resolveIncoming({ local, incoming }) {
  if (!local) return GOOGLE // we have never seen it: it is new

  const incomingUpdated = incoming?.google_updated_at ?? incoming?.updated ?? null

  // The echo of a write we just made: same version, nothing changed.
  if (
    incomingUpdated &&
    local.google_updated_at &&
    ms(incomingUpdated) !== null &&
    ms(incomingUpdated) === ms(local.google_updated_at)
  ) {
    return NONE
  }

  // A local change is waiting to be pushed — this is the only real conflict.
  if (local.sync_state === 'pending') {
    const localAt = ms(local.updated_at)
    const googleAt = ms(incomingUpdated)
    if (googleAt === null) return LOCAL
    if (localAt === null) return GOOGLE
    // Ties go to Google: it is the side that already committed the change,
    // and the local one will simply be pushed again if it really differs.
    return googleAt >= localAt ? GOOGLE : LOCAL
  }

  return GOOGLE
}

// The same question on the way out, asked by the push when Google answers a
// PATCH with 412 (the etag no longer matches — somebody changed it meanwhile).
// `remote` is the version Google now holds.
export function resolveOutgoing({ local, remote }) {
  const localAt = ms(local?.updated_at)
  const remoteAt = ms(remote?.updated)
  if (remoteAt === null) return LOCAL
  if (localAt === null) return GOOGLE
  return remoteAt > localAt ? GOOGLE : LOCAL
}
