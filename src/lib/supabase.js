import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config'

// The one shared client, or null when the app was built without a backend.
// Nothing in the app may read or write personal data while this is null — the
// gate in App.jsx stops before any provider that would try.
//
// PKCE rather than the implicit flow: the recovery link then comes back as
// `?code=…` in the query string instead of `#access_token=…` in the fragment,
// which is where our hash router lives. Two things fighting over one fragment
// is a bug waiting for the first password reset.
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

// Repositories call this instead of reaching for `supabase` directly, so a
// missing client fails loudly at the call site rather than as "cannot read
// properties of null" three frames deeper.
export function requireSupabase() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  return supabase
}
