import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import BottomSheet from '../BottomSheet'
import Segmented from '../Segmented'
import ScreenshotField from './ScreenshotField'
import TradingAssetPicker from './TradingAssetPicker'
import useRetained from '../../lib/useRetained'
import useScreenshotCapture from '../../lib/useScreenshotCapture'
import { useUI } from '../../context/UIContext'
import { useTrading } from '../../context/TradingContext'
import { useToast } from '../../context/ToastContext'
import {
  SESSIONS,
  TIMEFRAMES,
  formatTimestamp,
  parseYouTubeUrl,
  validateScreenshot,
  youtubeLinkState,
} from '../../lib/trading'

// Neues Setup / Setup bearbeiten. The same full-screen form sheet every other
// "Neu…" in the app is — × left, title, the accent action top right — so it
// arrives, leaves and behaves like the task, event and expense forms.
//
// Built for capturing while a video plays: the screenshot slot comes first and
// takes a drop or a paste from anywhere on the sheet, only the name is
// required, and everything else is a tap on a chip. Session, asset and
// timeframe are chips rather than native <select>s because that is what this
// app's choices look like (Segmented, FinanceAccountPicker); a second kind of
// dropdown would be a variant for no reason.
const EMPTY = () => ({
  name: '',
  description: '',
  session: null,
  assetId: null,
  timeframe: null,
  creator: '',
  youtube: '',
  favorite: false,
})

const fromSetup = (s) => ({
  name: s.name ?? '',
  description: s.description ?? '',
  session: s.session ?? null,
  assetId: s.asset_id ?? null,
  timeframe: s.timeframe ?? null,
  creator: s.creator ?? '',
  youtube: s.youtube_url ?? '',
  favorite: Boolean(s.is_favorite),
})

export default function TradingSetupForm() {
  const { tradingForm, closeTradingForm } = useUI()
  const { getSetup, setups, assets, urls, createAsset, saveSetup, activate } = useTrading()
  const { showToast } = useToast()

  const open = !!tradingForm
  // Read from the retained value so the title does not flip while the sheet
  // slides away (see useRetained).
  const retained = useRetained(tradingForm)
  const editing = retained?.mode === 'edit'
  const setup = editing ? getSetup(retained.setupId) : null

  const [form, setForm] = useState(EMPTY)
  // A newly chosen screenshot: { file, type, url, width, height } or null.
  const [shot, setShot] = useState(null)
  // Editing: whether the stored screenshot stays. "Entfernen" clears it.
  const [keepStored, setKeepStored] = useState(false)
  const [shotError, setShotError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Object URLs are released when the preview changes or the sheet closes —
  // a screenshot is megabytes, and a form opened twenty times would keep all
  // twenty in memory otherwise.
  const shotRef = useRef(null)
  const replaceShot = useCallback((next) => {
    if (shotRef.current?.url) revoke(shotRef.current.url)
    shotRef.current = next
    setShot(next)
  }, [])
  useEffect(() => () => replaceShot(null), [replaceShot])

  const take = useCallback(
    (file) => {
      const verdict = validateScreenshot(file)
      if (!verdict.ok) {
        // The current picture stays; only the new file is refused.
        setShotError(verdict.message)
        return
      }
      setShotError(null)
      const next = { file, type: verdict.type, url: objectUrl(file), width: null, height: null }
      replaceShot(next)
      // The size only reserves the right box for the card later; saving never
      // waits for it.
      readImageSize(next.url).then((size) => {
        if (!size || shotRef.current !== next) return
        const sized = { ...next, ...size }
        shotRef.current = sized
        setShot(sized)
      })
    },
    [replaceShot]
  )

  useEffect(() => {
    if (!open) return
    activate()
    setSaving(false)
    setSaveError(null)
    setShotError(null)
    replaceShot(null)
    if (tradingForm.mode === 'edit') {
      const current = getSetup(tradingForm.setupId)
      setForm(current ? fromSetup(current) : EMPTY())
      setKeepStored(Boolean(current?.screenshot_path))
    } else {
      setForm(EMPTY())
      setKeepStored(false)
    }
    // A screenshot pasted or dropped on the library arrives with the request.
    if (tradingForm.file) take(tradingForm.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tradingForm?.setupId, tradingForm?.file])

  const { dragActive } = useScreenshotCapture({ enabled: open && !saving, onFile: take })

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const storedUrl = editing && keepStored && setup?.screenshot_path ? urls[setup.screenshot_path] : null
  const previewUrl = shot?.url ?? storedUrl ?? null

  const removeShot = () => {
    replaceShot(null)
    setKeepStored(false)
    setShotError(null)
  }

  const linkState = youtubeLinkState(form.youtube)
  const link = linkState === 'valid' ? parseYouTubeUrl(form.youtube) : null
  const canSave = form.name.trim().length > 0 && linkState !== 'invalid' && !saving

  // Creators used before, offered while typing — the same five names come up
  // again and again, and a typo would split one creator into two.
  const creators = useMemo(
    () => [...new Set(setups.map((s) => s.creator?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')),
    [setups]
  )

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    const fields = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      session: form.session,
      asset_id: form.assetId,
      timeframe: form.timeframe,
      creator: form.creator.trim() || null,
      youtube_url: link?.url ?? null,
      is_favorite: form.favorite,
    }
    let screenshot = { kind: 'keep' }
    if (shot) {
      screenshot = { kind: 'new', file: shot.file, type: shot.type, width: shot.width, height: shot.height }
    } else if (editing && setup?.screenshot_path && !keepStored) {
      screenshot = { kind: 'remove' }
    }
    try {
      await saveSetup({ id: editing ? retained.setupId : null, fields, screenshot })
      showToast('Setup gespeichert ✓')
      closeTradingForm()
    } catch (err) {
      console.error(err)
      setSaveError('Das Setup konnte nicht gespeichert werden. Bitte prüfe deine Verbindung und versuch es noch einmal.')
    } finally {
      setSaving(false)
    }
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={!canSave}
      className={`press-fade text-body font-semibold ${canSave ? 'text-accent' : 'text-text-muted'}`}
    >
      {saving ? 'Sichern …' : editing ? 'Speichern' : 'Erstellen'}
    </button>
  )

  return (
    <BottomSheet
      open={open}
      onClose={closeTradingForm}
      full
      title={editing ? 'Setup bearbeiten' : 'Neues Setup'}
      headerRight={saveBtn}
    >
      <div className="space-y-6 px-5 py-5 pb-10" data-trading-form="">
        {saveError && (
          <p className="rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-label text-danger" role="alert">
            {saveError}
          </p>
        )}

        <ScreenshotField
          previewUrl={previewUrl}
          error={shotError}
          dragActive={dragActive}
          onPick={take}
          onRemove={removeShot}
          disabled={saving}
        />

        <Field label="Setup-Name">
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="z. B. London Breakout"
            maxLength={120}
            aria-label="Setup-Name"
            className={INPUT}
          />
        </Field>

        <Field label="Kurzbeschreibung">
          <textarea
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Einstieg, Stop, Ziel — in ein paar Sätzen"
            rows={3}
            maxLength={4000}
            aria-label="Kurzbeschreibung"
            className={`${INPUT} resize-y leading-snug`}
          />
        </Field>

        <Field label="Session">
          {/* Tapping the active session again clears it — the session is
              optional, and a choice that cannot be undone would force one. */}
          <Segmented
            options={SESSIONS}
            value={form.session}
            onChange={(id) => set({ session: form.session === id ? null : id })}
            ariaLabel="Session"
          />
        </Field>

        <Field label="Asset">
          <TradingAssetPicker
            assets={assets}
            value={form.assetId}
            onChange={(assetId) => set({ assetId })}
            onCreate={createAsset}
            disabled={saving}
          />
        </Field>

        <Field label="Timeframe">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((tf) => {
              const active = form.timeframe === tf
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => set({ timeframe: active ? null : tf })}
                  aria-pressed={active}
                  className={`press-tint min-h-[44px] min-w-[52px] rounded-chip px-3 py-2 text-ui font-medium tabular-nums transition-colors motion-reduce:transition-none ${
                    active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
                  }`}
                >
                  {tf}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Creator / Trader" optional>
          <input
            value={form.creator}
            onChange={(e) => set({ creator: e.target.value })}
            placeholder="Wer hat das Setup gezeigt?"
            maxLength={80}
            list="trading-creators"
            aria-label="Creator / Trader"
            className={INPUT}
          />
          <datalist id="trading-creators">
            {creators.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="YouTube-Link" optional>
          <input
            value={form.youtube}
            onChange={(e) => set({ youtube: e.target.value })}
            placeholder="https://youtu.be/…"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={500}
            aria-label="YouTube-Link"
            aria-invalid={linkState === 'invalid'}
            className={INPUT}
          />
          {linkState === 'invalid' && (
            <p className="mt-2 px-1 text-caption text-danger">Das ist kein YouTube-Link.</p>
          )}
          {link?.start != null && (
            <p className="mt-2 px-1 text-caption text-text-secondary">
              Startet bei {formatTimestamp(link.start)}
            </p>
          )}
        </Field>

        <button
          type="button"
          onClick={() => set({ favorite: !form.favorite })}
          aria-pressed={form.favorite}
          className="press-tint flex w-full items-center gap-3 rounded-input bg-bg-input px-4 py-3.5 text-left"
        >
          <Star
            size={20}
            className={form.favorite ? 'text-accent' : 'text-text-muted'}
            fill={form.favorite ? '#4A80FF' : 'none'}
          />
          <span className="flex-1 text-field text-text-primary">
            {form.favorite ? 'Favorit' : 'Als Favorit markieren'}
          </span>
        </button>
      </div>
    </BottomSheet>
  )
}

const INPUT =
  'w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent'

function Field({ label, optional = false, children }) {
  return (
    <div>
      <label className="mb-2 block text-label font-semibold text-text-secondary">
        {label}
        {optional && <span className="ml-1 font-normal text-text-muted">(optional)</span>}
      </label>
      {children}
    </div>
  )
}

function objectUrl(file) {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
}

function revoke(url) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

// Natural size of the chosen image, or null when it cannot be read within a
// moment (an environment without image decoding never answers — it must not
// hold anything up).
function readImageSize(url) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(null), 4000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
}
