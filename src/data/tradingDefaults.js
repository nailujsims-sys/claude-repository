// The columns a client may write — same shape as src/data/expenseDefaults.js,
// and for the same reason: a caller that hands the repository a whole row (an
// edited copy, the snapshot an undo restores) must not be able to smuggle a
// server-managed column in with it. `id`, `user_id` and `created_at` are set
// once on insert; the `updated_at` trigger keeps that column honest.
export const WRITABLE_SETUP_FIELDS = [
  'name',
  'description',
  'session',
  'asset_id',
  'timeframe',
  'creator',
  'youtube_url',
  'is_favorite',
  'screenshot_path',
  'screenshot_width',
  'screenshot_height',
  'updated_at',
]

export const WRITABLE_ASSET_FIELDS = ['name', 'updated_at']

function pick(fields, patch) {
  const out = {}
  for (const key of fields) {
    if (key in patch) out[key] = patch[key]
  }
  return out
}

export const pickWritableSetup = (patch) => pick(WRITABLE_SETUP_FIELDS, patch)
export const pickWritableAsset = (patch) => pick(WRITABLE_ASSET_FIELDS, patch)
