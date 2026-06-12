// Reads Supabase connection details from Vite env. When both are present the
// app runs against Supabase (with login); otherwise it falls back to a
// localStorage-backed data layer so the app is fully usable out of the box.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// Hardcoded single-user display name (see spec: Julian is the only user).
export const USER_NAME = 'Julian'
