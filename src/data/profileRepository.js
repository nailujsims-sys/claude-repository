import { requireSupabase } from '../lib/supabase'

// The signed-in user's profile row. It is created by a database trigger when
// the account is created, so the app only ever reads and updates it — never
// inserts. A missing row is not an error here: the app falls back to the email
// for the display name rather than blocking on it.
export const profileRepository = {
  async getProfile(userId) {
    if (!userId) throw new Error('Kein angemeldeter Benutzer.')
    const { data, error } = await requireSupabase()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw error
    return data ?? null
  },
}
