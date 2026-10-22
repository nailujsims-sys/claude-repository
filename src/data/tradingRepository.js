import { requireSupabase } from '../lib/supabase'
import { SCREENSHOT_BUCKET, screenshotPath } from '../lib/trading'
import { pickWritableAsset, pickWritableSetup } from './tradingDefaults'

// Trading-Setups live in Supabase and nowhere else — the rows in two tables,
// the screenshots in the private `trading-screenshots` bucket. Every statement
// is scoped twice, exactly as the other repositories are: RLS (and, for files,
// the storage policies) decide what the signed-in user may touch, and the
// explicit `user_id` filter or folder keeps the intent visible in the call.
// The guard below is the third — a missing user id never reaches the network.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

const bucket = () => requireSupabase().storage.from(SCREENSHOT_BUCKET)

// How long a signed screenshot URL stays valid. Long enough that a library left
// open for an afternoon keeps its images; an image that fails anyway asks for a
// fresh signature (see TradingContext → refreshUrls).
export const SIGNED_URL_TTL_S = 6 * 60 * 60

export const tradingRepository = {
  async listSetups(userId) {
    const { data, error } = await requireSupabase()
      .from('trading_setups')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  async listAssets(userId) {
    const { data, error } = await requireSupabase()
      .from('trading_assets')
      .select('*')
      .eq('user_id', requireUser(userId))
      .order('name', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  async createAsset(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('trading_assets')
      .insert({ ...pickWritableAsset(data), user_id: requireUser(userId) })
      .select()
      .single()
    if (error) throw error
    return row
  },

  async createSetup(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('trading_setups')
      .insert({ ...pickWritableSetup(data), user_id: requireUser(userId) })
      .select()
      .single()
    if (error) throw error
    return row
  },

  async updateSetup(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('trading_setups')
      .update({ ...pickWritableSetup(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteSetup(userId, id) {
    const { error } = await requireSupabase()
      .from('trading_setups')
      .delete()
      .eq('id', id)
      .eq('user_id', requireUser(userId))
    if (error) throw error
    return id
  },

  // ── Screenshots ──────────────────────────────────────────────────────────

  // A fresh, unguessable name per upload — never an overwrite. Replacing a
  // screenshot therefore never touches the file the row still points at until
  // the row has moved on (see TradingContext → saveSetup).
  async uploadScreenshot(userId, file, type) {
    const path = screenshotPath(requireUser(userId), type, crypto.randomUUID())
    const { error } = await bucket().upload(path, file, {
      contentType: type,
      cacheControl: '31536000',
      upsert: false,
    })
    if (error) throw error
    return path
  },

  async removeScreenshots(userId, paths) {
    requireUser(userId)
    // Only ever files in the user's own folder; the policies would refuse the
    // rest, this keeps a bug from even asking.
    const own = (paths ?? []).filter((p) => p && p.startsWith(`${userId}/`))
    if (own.length === 0) return []
    const { error } = await bucket().remove(own)
    if (error) throw error
    return own
  },

  async listScreenshotFiles(userId) {
    const { data, error } = await bucket().list(requireUser(userId), { limit: 1000 })
    if (error) throw error
    return data ?? []
  },

  // { [path]: signedUrl } for every path the bucket could sign.
  async signScreenshots(paths) {
    if (!paths?.length) return {}
    const { data, error } = await bucket().createSignedUrls(paths, SIGNED_URL_TTL_S)
    if (error) throw error
    const out = {}
    for (const entry of data ?? []) {
      if (entry?.path && entry.signedUrl && !entry.error) out[entry.path] = entry.signedUrl
    }
    return out
  },
}
