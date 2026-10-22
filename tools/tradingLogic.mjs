// Pure-logic and repository tests for the Trading-Setups module.
//
// What is pinned here are the rules the screens can only keep if the layer
// underneath is right:
//
//   1. Which files count as a screenshot, and the German sentence for those
//      that do not (format, size).
//   2. Which paste is the screenshot and which is text — normal text pasting
//      into a field must keep working.
//   3. YouTube links, with and without a timestamp, in every shape YouTube
//      hands out; anything else is refused.
//   4. Session, asset, favourites and search combine (AND), and the search
//      reads name and description.
//   5. Assets are one per spelling.
//   6. Which stored files are orphans — and that a young file never is.
//   7. The repository: nothing without a user, every call scoped, uploads land
//      in the user's own folder, a client cannot write a server column.
//
// The UI half — drop zone, paste, form, gallery, detail — is covered by
// tools/smoke.mjs. Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SUPABASE_URL, SUPABASE_ANON_KEY, installRealtimeStub } from './supabaseStub.mjs'

const TEST = `
import {
  DEFAULT_FILTERS,
  MAX_SCREENSHOT_BYTES,
  SESSIONS,
  TIMEFRAMES,
  assetKey,
  fileFromTransfer,
  filterSetups,
  findAssetByName,
  formatTimestamp,
  hasActiveFilters,
  normalizeAssetName,
  orphanedScreenshots,
  parseTimestamp,
  parseYouTubeUrl,
  screenshotFromPaste,
  screenshotPath,
  setupCountLabel,
  setupFacts,
  sortAssets,
  sortSetups,
  transferHasFiles,
  validateScreenshot,
  youtubeLinkState,
  transferMayCarryFiles,
  convertibleType,
  pickClipboardType,
  clipboardFailure,
  createDuplicateGuard,
  CLIPBOARD_MESSAGES,
  CONVERSION_FAILED_MESSAGE,
} from './src/lib/trading.js'
import { prepareScreenshot, readClipboardImage } from './src/lib/screenshotInput.js'
import { WRITABLE_SETUP_FIELDS, pickWritableSetup } from './src/data/tradingDefaults.js'
import { tradingRepository } from './src/data/tradingRepository.js'
import { makeBackend } from './tools/supabaseStub.mjs'
import { readFileSync } from 'node:fs'

const USER = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const file = (name, type, size = 1000) => ({ name, type, size })

// ── 1. screenshots ──────────────────────────────────────────────────────────
{
  ok('PNG, JPG and WebP are screenshots',
     validateScreenshot(file('a.png', 'image/png')).ok &&
     validateScreenshot(file('a.jpg', 'image/jpeg')).ok &&
     validateScreenshot(file('a.webp', 'image/webp')).ok)
  ok('the type is reported back for the upload', validateScreenshot(file('a.jpg', 'image/jpeg')).type === 'image/jpeg')
  ok('a file without a type is recognised by its extension',
     validateScreenshot(file('Chart.PNG', '')).type === 'image/png' &&
     validateScreenshot(file('chart.jpeg', '')).type === 'image/jpeg')

  const gif = validateScreenshot(file('a.gif', 'image/gif'))
  ok('a GIF is refused, with the allowed formats named',
     !gif.ok && gif.message.includes('PNG, JPG und WebP'))
  ok('a PDF is refused', !validateScreenshot(file('a.pdf', 'application/pdf')).ok)
  ok('a mislabelled extension does not outvote the declared type',
     !validateScreenshot(file('a.png', 'application/pdf')).ok)

  ok('exactly the limit is still fine', validateScreenshot(file('a.png', 'image/png', MAX_SCREENSHOT_BYTES)).ok)
  const big = validateScreenshot(file('a.png', 'image/png', 12.4 * 1024 * 1024))
  ok('a file over the limit is refused, saying how big it is and what is allowed',
     !big.ok && big.message.includes('12,4 MB') && big.message.includes('10 MB'))
  ok('the limit is 10 MB — the same number as the bucket in 0016',
     MAX_SCREENSHOT_BYTES === 10485760 &&
     readFileSync('supabase/migrations/0016_trading_setups.sql', 'utf8').includes('10485760'))
  ok('an empty file is refused', !validateScreenshot(file('a.png', 'image/png', 0)).ok)
  ok('no file at all is refused', !validateScreenshot(null).ok)

  ok('a screenshot lives in its owner\\'s folder', screenshotPath(USER, 'image/webp', 'abc') === USER + '/abc.webp')
  ok('a JPEG gets the .jpg extension', screenshotPath(USER, 'image/jpeg', 'x').endsWith('.jpg'))
  let threw = false
  try { screenshotPath(null, 'image/png', 'x') } catch { threw = true }
  ok('no path without a user', threw)
}

// ── 2. clipboard and drag & drop ────────────────────────────────────────────
{
  const png = file('image.png', 'image/png')
  const clip = ({ files = [], text = '' } = {}) => ({
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files,
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    getData: (t) => (t === 'text/plain' ? text : ''),
  })
  const input = { tagName: 'INPUT', type: 'text' }
  const textarea = { tagName: 'TEXTAREA' }
  const body = { tagName: 'BODY' }

  ok('an image pasted with nothing focused is the screenshot', screenshotFromPaste(clip({ files: [png] }), body) === png)
  ok('an image pasted into a text field, with no text in the clipboard, is the screenshot',
     screenshotFromPaste(clip({ files: [png] }), input) === png)
  ok('text pasted into a text field stays text', screenshotFromPaste(clip({ text: 'London' }), input) === null)
  ok('text AND image pasted into a field: the field gets its text',
     screenshotFromPaste(clip({ files: [png], text: 'Bildbeschreibung' }), textarea) === null)
  ok('text AND image pasted outside any field: the image is taken',
     screenshotFromPaste(clip({ files: [png], text: 'Bildbeschreibung' }), body) === png)
  ok('a paste without any file is never taken', screenshotFromPaste(clip({ text: 'x' }), body) === null)
  ok('a paste into a contentEditable counts as text', screenshotFromPaste(clip({ files: [png], text: 'x' }), { isContentEditable: true }) === null)
  ok('no clipboard data is not an error', screenshotFromPaste(null, body) === null)

  const pdf = file('a.pdf', 'application/pdf')
  ok('a drop with a PDF and a PNG yields the PNG', fileFromTransfer({ files: [pdf, png] }) === png)
  ok('a drop with only a PDF still yields it, so the user hears why',
     fileFromTransfer({ files: [pdf] }) === pdf)
  ok('the same file in items and files is counted once',
     fileFromTransfer({ items: [{ kind: 'file', getAsFile: () => png }], files: [png] }) === png)
  ok('a drag carrying files is recognised', transferHasFiles({ types: ['Files'] }))
  ok('a drag of selected text is not', !transferHasFiles({ types: ['text/plain'] }) && !transferHasFiles(null))
}

// ── 3. YouTube links ────────────────────────────────────────────────────────
{
  const id = 'dQw4w9WgXcQ'
  const cases = [
    ['https://www.youtube.com/watch?v=' + id, null],
    ['https://youtube.com/watch?v=' + id + '&t=90', 90],
    ['https://www.youtube.com/watch?v=' + id + '&t=1m30s', 90],
    ['https://youtu.be/' + id + '?t=754', 754],
    ['https://youtu.be/' + id + '?si=abc&t=1h2m3s', 3723],
    ['youtu.be/' + id, null],
    ['https://m.youtube.com/watch?v=' + id + '&feature=share', null],
    ['https://www.youtube.com/shorts/' + id, null],
    ['https://www.youtube.com/live/' + id + '?t=60', 60],
    ['https://www.youtube.com/embed/' + id + '?start=42', 42],
    ['https://www.youtube.com/watch?v=' + id + '#t=2m', 120],
  ]
  for (const [url, start] of cases) {
    const parsed = parseYouTubeUrl(url)
    ok('reads ' + url, parsed && parsed.videoId === id && parsed.start === start)
  }
  ok('a link without scheme is stored with https://', parseYouTubeUrl('youtu.be/' + id).url === 'https://youtu.be/' + id)
  ok('a link is stored as given, timestamp and all',
     parseYouTubeUrl(' https://youtu.be/' + id + '?t=754 ').url === 'https://youtu.be/' + id + '?t=754')

  ok('another site is not a YouTube link', parseYouTubeUrl('https://vimeo.com/12345') === null)
  ok('a lookalike host is not either', parseYouTubeUrl('https://youtube.com.evil.test/watch?v=' + id) === null)
  ok('a channel page has no video', parseYouTubeUrl('https://www.youtube.com/@trader') === null)
  ok('nonsense is not a link', parseYouTubeUrl('kein link') === null)
  ok('link states: empty / valid / invalid',
     youtubeLinkState('  ') === 'empty' && youtubeLinkState('https://youtu.be/' + id) === 'valid' &&
     youtubeLinkState('https://example.com') === 'invalid')

  ok('timestamps in every shape', parseTimestamp('90') === 90 && parseTimestamp('90s') === 90 &&
     parseTimestamp('1m30s') === 90 && parseTimestamp('1h') === 3600 && parseTimestamp('01:30') === 90 &&
     parseTimestamp('1:02:03') === 3723)
  ok('an unreadable timestamp is null', parseTimestamp('bald') === null && parseTimestamp('') === null && parseTimestamp(null) === null)
  ok('timestamps read back the way YouTube writes them',
     formatTimestamp(90) === '1:30' && formatTimestamp(5) === '0:05' && formatTimestamp(3723) === '1:02:03')
}

// ── 4. filter, search, favourites — combined ────────────────────────────────
{
  const s = (over) => ({ id: over.id, name: '', description: null, session: null, asset_id: null,
    is_favorite: false, created_at: '2026-10-01T10:00:00Z', ...over })
  const setups = [
    s({ id: 'a', name: 'London Breakout', description: 'FVG nach dem Asia-Range', session: 'london', asset_id: 'nq', is_favorite: true }),
    s({ id: 'b', name: 'NY Open Reversal', description: 'Liquidity Sweep', session: 'new_york', asset_id: 'nq' }),
    s({ id: 'c', name: 'Asia Range Fade', session: 'asia', asset_id: 'eu', is_favorite: true }),
    s({ id: 'd', name: 'Ohne Angaben' }),
  ]
  const ids = (list) => list.map((x) => x.id).join(',')

  ok('no filter shows everything', ids(filterSetups(setups, DEFAULT_FILTERS)) === 'a,b,c,d')
  ok('a session shows only that session', ids(filterSetups(setups, { session: 'london' })) === 'a')
  ok('an asset shows only that asset', ids(filterSetups(setups, { assetId: 'nq' })) === 'a,b')
  ok('favourites only', ids(filterSetups(setups, { onlyFavorites: true })) === 'a,c')
  ok('session AND asset AND favourite combine',
     ids(filterSetups(setups, { session: 'london', assetId: 'nq', onlyFavorites: true })) === 'a' &&
     ids(filterSetups(setups, { session: 'new_york', assetId: 'nq', onlyFavorites: true })) === '')
  ok('the search reads the name', ids(filterSetups(setups, { query: 'breakout' })) === 'a')
  ok('the search reads the description', ids(filterSetups(setups, { query: 'sweep' })) === 'b')
  ok('every word must match somewhere', ids(filterSetups(setups, { query: 'london fvg' })) === 'a' &&
     ids(filterSetups(setups, { query: 'london sweep' })) === '')
  ok('search ignores case and accents', ids(filterSetups([s({ id: 'x', name: 'Café Setup' })], { query: 'CAFE' })) === 'x')
  ok('search and filters combine', ids(filterSetups(setups, { query: 'asia', onlyFavorites: true })) === 'a,c' &&
     ids(filterSetups(setups, { query: 'asia', session: 'asia' })) === 'c')
  ok('a setup without a session appears only under "Alle"',
     !filterSetups(setups, { session: 'asia' }).some((x) => x.id === 'd'))
  ok('an untouched filter set is not "active"', !hasActiveFilters(DEFAULT_FILTERS))
  ok('any one filter makes it active', hasActiveFilters({ query: ' x ' }) && hasActiveFilters({ session: 'asia' }) &&
     hasActiveFilters({ assetId: 'nq' }) && hasActiveFilters({ onlyFavorites: true }))
  ok('whitespace alone is not a search', !hasActiveFilters({ query: '   ' }))

  const sorted = sortSetups([s({ id: 'old', created_at: '2026-01-01T00:00:00Z' }), s({ id: 'new', created_at: '2026-10-01T00:00:00Z' })])
  ok('newest first', ids(sorted) === 'new,old')

  ok('a card names asset, session and timeframe, in that order',
     setupFacts({ asset_id: 'nq', session: 'new_york', timeframe: '5m' }, { nq: { name: 'NQ' } }).join(' · ') === 'NQ · New York · 5m')
  ok('a card leaves out what is missing', setupFacts({ session: 'asia' }, {}).join(' · ') === 'Asia')
  ok('count label', setupCountLabel(1) === '1 Setup' && setupCountLabel(4) === '4 Setups')
  ok('three sessions, as in the database',
     SESSIONS.map((x) => x.id).join(',') === 'asia,london,new_york')
  const sql = readFileSync('supabase/migrations/0016_trading_setups.sql', 'utf8')
  ok('every timeframe the form offers is one the database accepts',
     TIMEFRAMES.every((tf) => sql.includes("'" + tf + "'")))
}

// ── 5. assets ───────────────────────────────────────────────────────────────
{
  ok('an asset name is trimmed and its spaces collapsed', normalizeAssetName('  nq   100 ') === 'nq 100')
  ok('case does not make a second asset', assetKey('EURUSD') === assetKey(' eurusd '))
  const assets = [{ id: '1', name: 'NQ' }, { id: '2', name: 'eurusd' }, { id: '3', name: 'Gold' }]
  ok('an existing asset is found in any spelling', findAssetByName(assets, ' nq ')?.id === '1')
  ok('a new name is not found', findAssetByName(assets, 'ES') === null)
  ok('assets sort alphabetically, ignoring case', sortAssets(assets).map((a) => a.name).join(',') === 'eurusd,Gold,NQ')
}

// ── 6. orphaned screenshots ─────────────────────────────────────────────────
{
  const now = Date.parse('2026-10-22T12:00:00Z')
  const day = 24 * 60 * 60 * 1000
  const objects = [
    { name: 'used.png', id: '1', created_at: new Date(now - 5 * day).toISOString() },
    { name: 'orphan.png', id: '2', created_at: new Date(now - 2 * day).toISOString() },
    { name: 'young.png', id: '3', created_at: new Date(now - 60 * 1000).toISOString() },
    { name: 'folder', id: null, created_at: null },
  ]
  const setups = [{ screenshot_path: USER + '/used.png' }, { screenshot_path: null }]
  const orphans = orphanedScreenshots({ userId: USER, objects, setups, now })
  ok('an old file no setup points at is an orphan', orphans.includes(USER + '/orphan.png'))
  ok('a file a setup points at is never one', !orphans.includes(USER + '/used.png'))
  ok('a young file is never one — it may be a save in flight', !orphans.includes(USER + '/young.png'))
  ok('a folder entry is ignored', orphans.length === 1)
}

// ── 7. the repository ───────────────────────────────────────────────────────
{
  const backend = makeBackend({})
  globalThis.fetch = (...args) => backend.fetch(...args)
  const lastCall = () => backend.calls[backend.calls.length - 1]

  const before = backend.calls.length
  const attempts = [
    () => tradingRepository.listSetups(null),
    () => tradingRepository.listAssets(''),
    () => tradingRepository.createAsset(null, { name: 'NQ' }),
    () => tradingRepository.createSetup(undefined, { name: 'x' }),
    () => tradingRepository.updateSetup(null, 'id', { name: 'x' }),
    () => tradingRepository.deleteSetup(null, 'id'),
    () => tradingRepository.uploadScreenshot(null, new Blob(['x'], { type: 'image/png' }), 'image/png'),
    () => tradingRepository.removeScreenshots(null, ['a/b.png']),
    () => tradingRepository.listScreenshotFiles(null),
  ]
  let refused = 0
  for (const run of attempts) { try { await run() } catch { refused++ } }
  ok('every call refuses to run without a user', refused === attempts.length)
  ok('and not one request left the client', backend.calls.length === before)

  await tradingRepository.listSetups(USER)
  ok('reading setups filters by user', lastCall().search.includes('user_id=eq.' + USER))
  ok('reading setups is newest first', lastCall().search.includes('order=created_at.desc'))
  await tradingRepository.listAssets(USER)
  ok('reading assets filters by user', lastCall().search.includes('user_id=eq.' + USER))

  const asset = await tradingRepository.createAsset(USER, { name: 'NQ', user_id: OTHER, id: 'geschmuggelt' })
  ok('a created asset belongs to the signed-in user, whatever was handed in', asset.user_id === USER && asset.id !== 'geschmuggelt')

  const setup = await tradingRepository.createSetup(USER, {
    name: 'London Breakout', session: 'london', asset_id: asset.id, timeframe: '15m',
    user_id: OTHER, created_at: '1999-01-01T00:00:00Z',
  })
  ok('a created setup belongs to its user', setup.user_id === USER)
  ok('a client cannot set created_at', setup.created_at !== '1999-01-01T00:00:00Z')

  await tradingRepository.updateSetup(USER, setup.id, { is_favorite: true, user_id: OTHER })
  ok('an update names the row and its owner',
     lastCall().search.includes('id=eq.' + setup.id) && lastCall().search.includes('user_id=eq.' + USER))
  ok('an update cannot hand the row to someone else', !('user_id' in (lastCall().body ?? {})))
  ok('the favourite was stored', backend.tables.trading_setups[0].is_favorite === true)

  const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' })
  const path = await tradingRepository.uploadScreenshot(USER, blob, 'image/png')
  ok('an upload lands in the user\\'s folder with a fresh name',
     path.startsWith(USER + '/') && path.endsWith('.png') && backend.storage.has(path))
  const second = await tradingRepository.uploadScreenshot(USER, blob, 'image/png')
  ok('two uploads never share a name (nothing is ever overwritten)', second !== path)

  const signed = await tradingRepository.signScreenshots([path, USER + '/fehlt.png'])
  ok('existing screenshots get a signed URL', typeof signed[path] === 'string' && signed[path].includes('/object/sign/trading-screenshots/'))
  ok('a missing file gets none', !(USER + '/fehlt.png' in signed))

  const listed = await tradingRepository.listScreenshotFiles(USER)
  ok('listing reads the user\\'s folder', listed.length === 2 && backend.storageCalls.at(-1).prefix === USER)

  const removed = await tradingRepository.removeScreenshots(USER, [path, OTHER + '/fremd.png'])
  ok('removing never even asks for a file outside the user\\'s folder',
     removed.length === 1 && !backend.storageCalls.at(-1).paths.includes(OTHER + '/fremd.png'))
  ok('the file is gone', !backend.storage.has(path))

  await tradingRepository.deleteSetup(USER, setup.id)
  ok('a delete names the row and its owner',
     lastCall().search.includes('id=eq.' + setup.id) && lastCall().search.includes('user_id=eq.' + USER))
  ok('the setup is gone from the database', backend.tables.trading_setups.length === 0)
}

// ── 8. the writable whitelist ───────────────────────────────────────────────
{
  ok('a client never writes id, user_id or created_at',
     !['id', 'user_id', 'created_at'].some((f) => WRITABLE_SETUP_FIELDS.includes(f)))
  const picked = pickWritableSetup({ name: 'x', screenshot_path: 'p', id: 'i', user_id: 'u', created_at: 'c' })
  ok('a whole row comes back without its server-managed columns',
     Object.keys(picked).sort().join(',') === 'name,screenshot_path')
}


// ── 9. iPhone input: drag detection, formats, clipboard, duplicates ─────────
{
  ok('a desktop file drag may carry files', transferMayCarryFiles({ types: ['Files'] }))
  ok('an iOS drag announcing its MIME type may carry files', transferMayCarryFiles({ types: ['image/png'] }))
  ok('an iOS drag announcing an Apple type identifier may carry files', transferMayCarryFiles({ types: ['public.heic'] }))
  ok('an iOS drag that reveals nothing yet may carry files', transferMayCarryFiles({ types: [] }))
  ok('a text drag does not — dragging text into a field keeps working',
     !transferMayCarryFiles({ types: ['text/plain', 'text/html'] }))
  ok('no transfer at all does not', !transferMayCarryFiles(null))

  ok('HEIC, HEIF and TIFF are convertible', convertibleType({ type: 'image/heic' }) === 'image/heic' &&
     convertibleType({ type: 'image/heif' }) === 'image/heif' && convertibleType({ type: 'image/tiff' }) === 'image/tiff')
  ok('a HEIC without a type is recognised by its extension', convertibleType({ name: 'IMG_0001.HEIC', type: '' }) === 'image/heic')
  ok('a GIF or PDF is not converted', convertibleType({ type: 'image/gif' }) === null && convertibleType({ type: 'application/pdf' }) === null)
  ok('a declared type outvotes the extension', convertibleType({ name: 'a.heic', type: 'image/gif' }) === null)

  ok('PNG is read first', pickClipboardType(['image/jpeg', 'text/plain', 'image/png']) === 'image/png')
  ok('JPEG before WebP', pickClipboardType(['image/webp', 'image/jpeg']) === 'image/jpeg')
  ok('a HEIC-only clipboard is read for conversion', pickClipboardType(['image/heic']) === 'image/heic')
  ok('another image type is still read, so validation can explain', pickClipboardType(['image/gif']) === 'image/gif')
  ok('text only is "no image"', pickClipboardType(['text/plain']) === null && pickClipboardType([]) === null)

  ok('a refused permission reads as denied', clipboardFailure({ name: 'NotAllowedError' }) === 'denied')
  ok('an empty clipboard reported as DataError reads as empty', clipboardFailure({ name: 'DataError' }) === 'empty')
  ok('anything else reads as failed', clipboardFailure(new Error('x')) === 'failed')
  ok('every clipboard message offers the photo picker',
     Object.values(CLIPBOARD_MESSAGES).every((m) => m.includes('Fotos auswählen')))

  let t = 0
  const guard = createDuplicateGuard(1500, () => t)
  const f = { name: 'a.png', size: 10, type: 'image/png', lastModified: 1 }
  ok('the first arrival is taken', guard(f) === false)
  t = 100
  ok('the same file a moment later is a duplicate', guard({ ...f }) === true)
  t = 2000
  ok('the same file much later is a new gesture', guard(f) === false)
  t = 2100
  ok('a different file is never a duplicate', guard({ ...f, size: 11 }) === false)
}

// ── 10. readClipboardImage / prepareScreenshot against stubbed browser APIs ─
{
  const setNav = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
  const realNav = globalThis.navigator
  const pngBlob = new Blob([new Uint8Array(500)], { type: 'image/png' })
  const item = (types, blob = pngBlob) => ({ types, getType: async () => blob })

  setNav({})
  let r = await readClipboardImage()
  ok('no Clipboard API → the unsupported sentence', !r.ok && r.message === CLIPBOARD_MESSAGES.unsupported)

  globalThis.window = { isSecureContext: false }
  r = await readClipboardImage()
  ok('no Clipboard API over plain HTTP → the HTTPS sentence', !r.ok && r.message === CLIPBOARD_MESSAGES.insecure)
  delete globalThis.window

  setNav({ clipboard: { read: async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e } } })
  r = await readClipboardImage()
  ok('a refused permission → the denied sentence', !r.ok && r.message === CLIPBOARD_MESSAGES.denied)

  setNav({ clipboard: { read: async () => [item(['text/plain'], new Blob(['hallo']))] } })
  r = await readClipboardImage()
  ok('a clipboard with only text → the "no image" sentence', !r.ok && r.message === CLIPBOARD_MESSAGES.empty)

  setNav({ clipboard: { read: async () => [] } })
  r = await readClipboardImage()
  ok('an empty clipboard → the "no image" sentence', !r.ok && r.message === CLIPBOARD_MESSAGES.empty)

  let calls = 0
  setNav({ clipboard: { read: () => { calls++; return Promise.resolve([item(['text/plain', 'image/png'])]) } } })
  const pending = readClipboardImage()
  ok('clipboard.read() is called synchronously, inside the tap (iOS requirement)', calls === 1)
  r = await pending
  ok('a copied screenshot comes back as a PNG file', r.ok && r.file.type === 'image/png' && r.file.size === 500 && /\\.png$/.test(r.file.name))

  setNav(realNav)

  const png = new File([new Uint8Array(100)], 'chart.png', { type: 'image/png' })
  let p = await prepareScreenshot(png)
  ok('a supported file passes untouched — the original bytes are stored', p.ok && p.file === png && p.type === 'image/png')
  p = await prepareScreenshot(new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }))
  ok('a GIF is refused with the format sentence, not converted', !p.ok && p.message.includes('PNG, JPG und WebP'))
  p = await prepareScreenshot(new File([new Uint8Array(10)], 'IMG.HEIC', { type: 'image/heic' }))
  ok('a HEIC the environment cannot decode → a clear sentence with the fallback', !p.ok && p.message === CONVERSION_FAILED_MESSAGE)
  p = await prepareScreenshot({ name: 'huge.heic', type: 'image/heic', size: 40 * 1024 * 1024 })
  ok('a HEIC too large to convert is refused before decoding', !p.ok && p.message.includes('Erlaubt sind PNG'))
}

console.log(\`trading logic: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'tradingLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'test',
      DEV: false,
      PROD: true,
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    }),
  },
  write: false,
  logLevel: 'silent',
})

// See installRealtimeStub: without it this suite dies on the runner, which pins
// Node 20, before its first assertion.
installRealtimeStub()

const out = `${process.env.SCRATCH || '/tmp'}/tradingLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
