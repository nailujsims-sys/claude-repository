// Supabase connection details, read from Vite env at build time.
//
// Both values are PUBLIC by design: the URL identifies the project and the anon
// key is the browser's identity before login. Every row they can reach is
// guarded by Row Level Security in Postgres — see supabase/migrations/. The
// service-role key and the database password have no business in this bundle
// and must never appear here.
//
// When either value is missing the app does NOT fall back to a local store. It
// says so and refuses to hold personal data (see src/screens/BackendMissing).

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// Where Supabase sends the user back after a password-reset mail. The app runs
// under a hash router, so the marker is a query parameter: a fragment would
// collide with the router's own `#/route`.
export function passwordResetRedirectTo() {
  if (typeof window === 'undefined') return undefined
  const { origin, pathname } = window.location
  return `${origin}${pathname}?recovery=1`
}
