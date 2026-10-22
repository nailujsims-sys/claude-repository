// The rules of the Trading-Setups module, as pure functions.
//
// Everything here is decided without React, Supabase or a browser, so
// tools/tradingLogic.mjs can pin it: which files count as a screenshot, which
// paste is an image and which is text, what a YouTube link with a timestamp
// means, how filter, search and favourites combine, and which stored files no
// setup needs any more. The screen and the form only ask.

// ── Fixed vocabularies ──────────────────────────────────────────────────────
// The same lists the database constrains in 0016_trading_setups.sql. A new
// session or timeframe is a change in both places, deliberately.
export const SESSIONS = [
  { id: 'asia', label: 'Asia' },
  { id: 'london', label: 'London' },
  { id: 'new_york', label: 'New York' },
]

export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W']

export const sessionLabel = (id) => SESSIONS.find((s) => s.id === id)?.label ?? null
export const isSession = (id) => SESSIONS.some((s) => s.id === id)
export const isTimeframe = (tf) => TIMEFRAMES.includes(tf)

// ── Screenshots ─────────────────────────────────────────────────────────────
export const SCREENSHOT_BUCKET = 'trading-screenshots'

// The bucket enforces the same two limits (see 0016). Checked here first so the
// user reads a sentence, not a status code.
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
export const SCREENSHOT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}
export const SCREENSHOT_ACCEPT = Object.keys(SCREENSHOT_TYPES).join(',')

// Some systems hand over a file without a type (a drag from certain file
// managers). The extension is the honest fallback; nothing else is guessed.
function typeOf(file) {
  if (file?.type) return file.type === 'image/jpg' ? 'image/jpeg' : file.type
  const ext = String(file?.name ?? '').toLowerCase().split('.').pop()
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] ?? ''
}

export const screenshotType = (file) => {
  const type = typeOf(file)
  return type in SCREENSHOT_TYPES ? type : null
}

export function formatMegabytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return `${mb.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}

// { ok: true, type } or { ok: false, message } — the message is what the form
// shows under the drop zone, word for word.
export function validateScreenshot(file) {
  if (!file) return { ok: false, message: 'Es wurde keine Datei erkannt.' }
  const type = screenshotType(file)
  if (!type) {
    return {
      ok: false,
      message: 'Dieses Format wird nicht unterstützt. Erlaubt sind PNG, JPG und WebP.',
    }
  }
  if (typeof file.size === 'number' && file.size > MAX_SCREENSHOT_BYTES) {
    return {
      ok: false,
      message: `Der Screenshot ist zu groß (${formatMegabytes(file.size)}). Erlaubt sind höchstens ${formatMegabytes(MAX_SCREENSHOT_BYTES)}.`,
    }
  }
  if (typeof file.size === 'number' && file.size === 0) {
    return { ok: false, message: 'Die Datei ist leer.' }
  }
  return { ok: true, type }
}

// Every object lives in the owner's folder — the storage policies and the
// table's check constraint both rely on exactly this shape.
export function screenshotPath(userId, type, id) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  const ext = SCREENSHOT_TYPES[type] ?? 'png'
  return `${userId}/${id}.${ext}`
}

// ── Clipboard and drag & drop ───────────────────────────────────────────────
// Both APIs are read duck-typed, so a test can hand in a plain object.

function filesOf(transfer) {
  if (!transfer) return []
  const out = []
  // `items` is where a pasted screenshot shows up in Chrome and Safari; `files`
  // is where a dropped file does. Read both, de-duplicated by identity.
  for (const item of Array.from(transfer.items ?? [])) {
    if (item?.kind === 'file') {
      const file = item.getAsFile?.()
      if (file) out.push(file)
    }
  }
  for (const file of Array.from(transfer.files ?? [])) {
    if (file && !out.includes(file)) out.push(file)
  }
  return out
}

// The first image in a clipboard or drop, else the first file of any kind —
// a dropped PDF must still reach validation, so the user hears why it was not
// taken instead of nothing happening at all.
export function fileFromTransfer(transfer) {
  const files = filesOf(transfer)
  return files.find((f) => screenshotType(f)) ?? files[0] ?? null
}

export const transferHasFiles = (transfer) =>
  Array.from(transfer?.types ?? []).includes('Files')

const isTextEntry = (target) => {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = String(target.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  const type = String(target.type ?? 'text').toLowerCase()
  return ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''].includes(type)
}

// Which paste the form takes over, and which it leaves alone.
//
// The rule that keeps normal text pasting working: when the cursor stands in a
// text field AND the clipboard carries text, the text wins and the browser
// does what it always does. In every other case an image in the clipboard is
// the screenshot — including a paste while a text field has focus but the
// clipboard holds nothing but an image, which a text field could not take
// anyway. Returns the file to take, or null to stay out of the way.
export function screenshotFromPaste(clipboardData, target) {
  const file = fileFromTransfer(clipboardData)
  if (!file) return null
  if (isTextEntry(target)) {
    const text = clipboardData?.getData?.('text/plain') ?? ''
    if (text.trim() !== '') return null
  }
  return file
}

// ── YouTube links ───────────────────────────────────────────────────────────
const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be',
])
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/

// "90", "90s", "1m30s", "1h2m3s", "01:30" → seconds. Null when unreadable.
export function parseTimestamp(raw) {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim().toLowerCase()
  if (value === '') return null
  if (/^\d+$/.test(value)) return Number(value)
  if (/^\d+(:\d{1,2}){1,2}$/.test(value)) {
    return value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
  }
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// A YouTube link as typed or pasted → { url, videoId, start } or null.
//
// `url` is what is stored and opened: the input itself, trimmed and given a
// scheme when it had none — never rebuilt, so a link keeps whatever the user
// copied (playlist, timestamp, `si=` tracking and all). `start` is read out of
// it only to say "ab 12:34" next to the link.
export function parseYouTubeUrl(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!YT_HOSTS.has(host)) return null

  let videoId = null
  const parts = url.pathname.split('/').filter(Boolean)
  if (host.endsWith('youtu.be')) {
    videoId = parts[0] ?? null
  } else if (parts[0] === 'watch') {
    videoId = url.searchParams.get('v')
  } else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
    videoId = parts[1] ?? null
  }
  if (!videoId || !VIDEO_ID.test(videoId)) return null

  const hashT = url.hash.match(/t=([^&]+)/)?.[1] ?? null
  const start = parseTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hashT)
  return { url: withScheme, videoId, start }
}

// 'empty' | 'valid' | 'invalid' — what the form needs to decide whether it may
// save. An empty link is fine; a link that is not YouTube is not.
export function youtubeLinkState(input) {
  if (String(input ?? '').trim() === '') return 'empty'
  return parseYouTubeUrl(input) ? 'valid' : 'invalid'
}

// ── Assets ──────────────────────────────────────────────────────────────────
// "  nq  100 " → "nq 100". Case is kept as typed; uniqueness ignores it (the
// database index is on lower(btrim(name)), this mirrors it).
export const normalizeAssetName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ')
export const assetKey = (name) => normalizeAssetName(name).toLocaleLowerCase('de-DE')

export const findAssetByName = (assets, name) =>
  (assets ?? []).find((a) => assetKey(a.name) === assetKey(name)) ?? null

export const sortAssets = (assets) =>
  [...(assets ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))

// ── The library ─────────────────────────────────────────────────────────────
// Newest first: the setup captured a minute ago is the one most likely looked
// at next. `id` breaks a tie so the order never flickers between renders.
export const sortSetups = (setups) =>
  [...(setups ?? [])].sort(
    (a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) ||
      String(a.id).localeCompare(String(b.id))
  )

export const DEFAULT_FILTERS = Object.freeze({
  session: 'all',
  assetId: null,
  onlyFavorites: false,
  query: '',
})

export const hasActiveFilters = (f) =>
  (f?.session ?? 'all') !== 'all' ||
  Boolean(f?.assetId) ||
  Boolean(f?.onlyFavorites) ||
  String(f?.query ?? '').trim() !== ''

const fold = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

// Session, asset, favourites and search all apply at once (AND). The search
// reads name and description, and every word typed has to appear somewhere in
// them — "london fvg" finds the London setup whose description mentions an FVG.
export function filterSetups(setups, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  const words = fold(f.query).split(/\s+/).filter(Boolean)
  return (setups ?? []).filter((s) => {
    if (f.session !== 'all' && s.session !== f.session) return false
    if (f.assetId && s.asset_id !== f.assetId) return false
    if (f.onlyFavorites && !s.is_favorite) return false
    if (words.length > 0) {
      const haystack = fold(`${s.name ?? ''} ${s.description ?? ''}`)
      if (!words.every((w) => haystack.includes(w))) return false
    }
    return true
  })
}

// The facts under a card's title, in reading order, without gaps.
export function setupFacts(setup, assetsById = {}) {
  return [
    assetsById[setup?.asset_id]?.name ?? null,
    sessionLabel(setup?.session),
    isTimeframe(setup?.timeframe) ? setup.timeframe : null,
  ].filter(Boolean)
}

export const setupCountLabel = (n) => (n === 1 ? '1 Setup' : `${n} Setups`)

// ── Storage hygiene ─────────────────────────────────────────────────────────
// Files in the user's folder that no setup points at any more — left behind by
// a tab closed in the seconds between deleting a setup and its undo running
// out, or by an upload whose row never got written. Only files older than
// `minAgeMs` count: a younger one may belong to a save still in flight on
// another device, and deleting that would break a setup being created.
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000

export function orphanedScreenshots({ userId, objects, setups, now = Date.now(), minAgeMs = ORPHAN_MIN_AGE_MS }) {
  const used = new Set((setups ?? []).map((s) => s.screenshot_path).filter(Boolean))
  return (objects ?? [])
    .filter((o) => o?.name && o.id !== null && o.id !== undefined) // folders have no id
    .map((o) => ({ path: `${userId}/${o.name}`, created: Date.parse(o.created_at ?? '') }))
    .filter(({ path, created }) => !used.has(path) && Number.isFinite(created) && now - created >= minAgeMs)
    .map(({ path }) => path)
}
