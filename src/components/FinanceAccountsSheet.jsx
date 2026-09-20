import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import BottomSheet from './BottomSheet'
import ConfirmDialog from './ConfirmDialog'
import FinanceAccountFields from './FinanceAccountFields'
import { NewAccountForm } from './FinanceAccountPicker'
import { useFinance } from '../context/FinanceContext'
import { useToast } from '../context/ToastContext'
import { useUI } from '../context/UIContext'
import {
  accountActions,
  accountErrorMessage,
  accountSubtitle,
  splitAccounts,
  validateAccountDraft,
} from '../lib/finance/accounts'

// „Konten" — die Verwaltung, die es bis v1.24 nicht gab.
//
// WARUM SIE ÜBERHAUPT NÖTIG IST. Ein Konto entstand bisher nebenbei, mitten in
// einer Buchung, mit einem Namen, den jemand in drei Sekunden getippt hat.
// Danach war es unveränderlich: kein Umbenennen, kein Aufräumen, kein Weg
// zurück aus einem Tippfehler. Diese Liste ist dieser Weg — und bewusst nicht
// mehr: keine Salden, keine Auswertung, keine Bankverbindung.
//
// ARCHIVIEREN IST DER NORMALFALL, LÖSCHEN DIE AUSNAHME. Ein Konto mit Historie
// zu löschen hieße, die Historie zu löschen (die Fremdschlüssel stehen auf
// `on delete cascade`), und das ist keine Handlung, die hinter einem Sheet
// stehen darf. Also bietet diese Oberfläche für ein belegtes Konto nur das
// Archivieren an — und die Datenbank setzt dieselbe Regel noch einmal durch,
// denn was nur eine Oberfläche verspricht, ist nicht versprochen (0013).
//
// ARCHIVIEREN OHNE RÜCKFRAGE, MIT „RÜCKGÄNGIG" (§18/§19): es geht keine Zeile
// verloren, das Konto verschwindet nur aus der Auswahl für Neues. Gelöscht wird
// dagegen mit Rückfrage — nicht weil Daten in Gefahr wären (es sind keine da),
// sondern weil „weg" hier wirklich weg heißt und es dafür kein Rückgängig gibt.
export default function FinanceAccountsSheet() {
  const { financeAccounts, closeFinanceAccounts } = useUI()
  return financeAccounts ? <Sheet onClose={closeFinanceAccounts} /> : null
}

function Sheet({ onClose }) {
  const { accounts, resetFinanceData } = useFinance()
  const { showToast } = useToast()
  // null | { mode: 'edit', id } | { mode: 'create' }
  const [detail, setDetail] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetProblem, setResetProblem] = useState(null)

  const { active, archived } = useMemo(() => splitAccounts(accounts), [accounts])

  /**
   * Alles zurücksetzen.
   *
   * EIN AUFRUF, und der Knopf ist währenddessen gesperrt — ein zweiter Tap auf
   * eine laufende Löschung wäre ein zweiter Reset über einen Zustand, den der
   * erste gerade verändert. Scheitert er, bleibt alles, wie es war: die Funktion
   * in 0015 ist eine Transaktion, und dieser Bildschirm behauptet deshalb nichts
   * über halbe Ergebnisse.
   */
  const reset = async () => {
    if (resetting) return
    setResetting(true)
    setResetProblem(null)
    try {
      await resetFinanceData()
      showToast('Finanzdaten zurückgesetzt')
      onClose?.()
    } catch (err) {
      setResetProblem(accountErrorMessage(err))
    } finally {
      setResetting(false)
    }
  }

  // Das offene Detail folgt den Zeilen: wird das Konto gelöscht (hier) oder
  // fällt es weg (ein anderes Gerät), schließt sich das Sheet, statt auf eine
  // Zeile zu zeigen, die es nicht mehr gibt.
  useEffect(() => {
    if (detail?.mode === 'edit' && !accounts.some((a) => a.id === detail.id)) setDetail(null)
  }, [accounts, detail])

  const open = accounts.find((a) => a.id === detail?.id) ?? null

  return (
    <>
      <BottomSheet open onClose={onClose} title="Konten">
        <AccountList
          active={active}
          archived={archived}
          onOpen={(account) => setDetail({ mode: 'edit', id: account.id })}
          onCreate={() => setDetail({ mode: 'create' })}
          onReset={() => setConfirmReset(true)}
          resetting={resetting}
          resetProblem={resetProblem}
        />
      </BottomSheet>

      <ConfirmDialog
        open={confirmReset}
        title="Finanzdaten zurücksetzen?"
        message={
          'Dadurch werden alle Konten, Buchungen, Importe, Händlerzuordnungen und das '
          + 'gelernte Finanzwissen gelöscht. Die Standardkategorien bleiben erhalten. '
          + 'Andere Bereiche der App sind nicht betroffen. '
          + 'Diese Aktion kann nicht rückgängig gemacht werden.'
        }
        confirmLabel="Alles zurücksetzen"
        z="z-[65]"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false)
          reset()
        }}
      />

      {detail?.mode === 'edit' && open && (
        <AccountDetailSheet account={open} onClose={() => setDetail(null)} />
      )}

      {detail?.mode === 'create' && <CreateAccountSheet onClose={() => setDetail(null)} />}
    </>
  )
}

// Die Liste selbst, ohne das Sheet — exportiert, damit ein echter Browser sie
// vermessen kann (tools/financeAccountsLayout.mjs).
export function AccountList({
  active = [], archived = [], onOpen, onCreate,
  onReset = null, resetting = false, resetProblem = null,
}) {
  return (
    <div className="px-5 pb-6">
      <p className="pt-1 text-caption text-text-secondary">
        Konten für neue Buchungen und Importe. Ein archiviertes Konto bleibt mit allen
        Umsätzen in der Historie — es wird nur nicht mehr angeboten.
      </p>

      <AccountSection title="Aktiv" accounts={active} onOpen={onOpen} />
      <AccountSection title="Archiviert" accounts={archived} onOpen={onOpen} dimmed />

      <button
        type="button"
        onClick={onCreate}
        className="press-tint mt-4 flex min-h-[44px] w-full items-center gap-1.5 rounded-btn px-1 text-ui text-text-secondary"
      >
        <Plus size={16} /> Neues Konto
      </button>

      {onReset && <DataSection onReset={onReset} busy={resetting} problem={resetProblem} />}
    </div>
  )
}

// „Daten" — der eine Weg, alles wegzuwerfen.
//
// WARUM ER HIER STEHT UND NICHT AUF DEM DASHBOARD. Ein Knopf, der jede Buchung
// löscht, gehört nicht neben den Knopf, der eine anlegt. Er gehört dorthin, wo
// man ohnehin aufräumt — und dort hinter eine eigene Überschrift, deutlich
// unterhalb von allem anderen, damit ihn niemand im Vorbeiscrollen trifft.
//
// EINE TEXTZEILE, KEIN ROTER PRIMÄRKNOPF, dieselbe Regel wie bei „Konto
// löschen": Rot ist hier Bedeutung und nicht Betonung. Die Rückfrage kommt aus
// dem bestehenden ConfirmDialog, und WÄHREND sie läuft ist die Zeile gesperrt —
// ein zweiter Tap auf eine laufende Löschung ist keine zweite Entscheidung.
function DataSection({ onReset, busy, problem }) {
  return (
    <section className="mt-8 border-t border-subtle pt-4">
      <p className="px-1 pb-1 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Daten
      </p>
      <button
        type="button"
        onClick={onReset}
        disabled={busy}
        aria-busy={busy}
        className="press-tint flex min-h-[44px] w-full items-center rounded-btn px-1 text-ui text-danger disabled:opacity-60"
      >
        {busy ? 'Wird zurückgesetzt …' : 'Finanzdaten zurücksetzen'}
      </button>
      <p className="mt-1 px-1 text-caption text-text-muted">
        Alle Konten, Buchungen, Importe und gelernten Zuordnungen löschen. Die
        Standardkategorien bleiben.
      </p>
      {problem && (
        <p className="mt-2 px-1 text-caption text-danger" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}

function AccountSection({ title, accounts, onOpen, dimmed = false }) {
  if (accounts.length === 0) return null
  return (
    <section className="mt-4">
      <p className="px-1 pb-1 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        {title}
      </p>
      <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        {accounts.map((account, i) => (
          <button
            key={account.id}
            type="button"
            onClick={() => onOpen?.(account)}
            className={`press-tint flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left ${
              i < accounts.length - 1 ? 'border-b border-subtle' : ''
            }`}
          >
            <span className="min-w-0 flex-1">
              {/* Gedimmt, aber lesbar: ein archiviertes Konto ist kein
                  deaktivierter Knopf, sondern eine Zeile mit anderem Gewicht. */}
              <span
                className={`block truncate text-ui font-medium ${
                  dimmed ? 'text-text-secondary' : 'text-text-primary'
                }`}
              >
                {account.name}
              </span>
              <span className="block truncate text-caption text-text-secondary">
                {accountSubtitle(account)}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-text-muted" />
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Ein Konto anlegen ───────────────────────────────────────────────────────
// Dasselbe Formular, das auch mitten in einer Buchung erscheint — siehe
// FinanceAccountPicker. Hier steht es nur in einem eigenen Sheet.
function CreateAccountSheet({ onClose }) {
  const { createAccount } = useFinance()
  return (
    <BottomSheet open onClose={onClose} title="Neues Konto" z="z-[60]">
      <div className="px-5 pb-6 pt-1">
        <NewAccountForm onCreate={createAccount} onCreated={onClose} onCancel={onClose} />
      </div>
    </BottomSheet>
  )
}

// ── Ein Konto bearbeiten ────────────────────────────────────────────────────
function AccountDetailSheet({ account, onClose }) {
  const {
    imports, transactions, updateAccount, archiveAccount, reactivateAccount, deleteEmptyAccount,
  } = useFinance()
  const { showToast } = useToast()

  return (
    <BottomSheet open onClose={onClose} title={account.name} z="z-[60]">
      <AccountDetail
        account={account}
        data={{ transactions, imports }}
        onSave={(patch) => updateAccount(account.id, patch)}
        onArchive={() => archiveAccount(account.id)}
        onReactivate={() => reactivateAccount(account.id)}
        onDelete={() => deleteEmptyAccount(account.id)}
        onToast={showToast}
        onDone={onClose}
      />
    </BottomSheet>
  )
}

/**
 * Der Inhalt des Bearbeiten-Sheets — exportiert für die Layout-Messung.
 *
 * Ein primärer Knopf („Speichern") und darunter genau EINE leise Aktion: ein
 * Konto ist entweder archiviert (→ reaktivieren), leer (→ löschen) oder in
 * Gebrauch (→ archivieren). Drei Möglichkeiten nebeneinander anzubieten, von
 * denen zwei nicht gehen, wäre eine Liste von Fehlermeldungen.
 */
export function AccountDetail({
  account,
  data,
  onSave,
  onArchive,
  onReactivate,
  onDelete,
  onToast,
  onDone,
}) {
  const [name, setName] = useState(account.name ?? '')
  const [provider, setProvider] = useState(account.provider ?? '')
  const [currency, setCurrency] = useState(account.currency ?? 'EUR')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const can = accountActions(account, data)
  const invalid = validateAccountDraft({ name, provider, currency })
  const canSave = !invalid && !busy

  const run = async (fn, after) => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      await fn?.()
      after?.()
    } catch (err) {
      setProblem(accountErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(
      () => onSave?.({ name: name.trim(), provider: provider.trim() || null, currency }),
      () => {
        onToast?.('Konto gespeichert ✓')
        onDone?.()
      }
    )

  const archive = () =>
    run(onArchive, () => {
      // Kein „Wirklich archivieren?": es geht nichts verloren, und der Weg
      // zurück ist ein Tippen weit (§18/§19).
      onToast?.('Konto archiviert', {
        actionLabel: 'Rückgängig',
        onAction: async () => {
          // Der Toast überlebt dieses Sheet — die Meldung eines gescheiterten
          // Rückgängig muss deshalb über `onToast` laufen und nicht über den
          // lokalen Zustand einer Komponente, die es dann nicht mehr gibt.
          try {
            await onReactivate?.()
          } catch {
            onToast?.('Das hat nicht geklappt')
          }
        },
      })
      onDone?.()
    })

  const reactivate = () =>
    run(onReactivate, () => {
      onToast?.('Konto wieder aktiv')
      onDone?.()
    })

  const remove = () =>
    run(onDelete, () => {
      onToast?.('Konto gelöscht')
      onDone?.()
    })

  return (
    <div className="px-5 pb-6 pt-1">
      <FinanceAccountFields
        name={name}
        onName={setName}
        provider={provider}
        onProvider={setProvider}
        currency={currency}
        onCurrency={setCurrency}
        currencyLocked={!can.currency}
        currencyHint="Die Währung kann nicht mehr geändert werden, weil das Konto bereits Finanzdaten enthält."
        disabled={busy}
      />

      {problem && (
        <p className="mt-3 text-caption text-danger" role="alert">
          {problem}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        aria-busy={busy}
        className="press-tint mt-4 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Wird gespeichert …' : 'Speichern'}
      </button>

      {invalid && (
        <p className="mt-2 px-1 text-caption text-text-secondary">{invalid}</p>
      )}

      {/* Die leise Aktion darunter. Rot ist hier Bedeutung, nicht Betonung:
          eine Textzeile, kein zweiter Primärknopf. */}
      <div className="mt-2">
        {can.archive && (
          <QuietAction onClick={archive} disabled={busy}>
            Konto archivieren
          </QuietAction>
        )}
        {can.reactivate && (
          <QuietAction onClick={reactivate} disabled={busy}>
            Konto reaktivieren
          </QuietAction>
        )}
        {can.remove && (
          <QuietAction onClick={() => setConfirmDelete(true)} disabled={busy} danger>
            Konto löschen
          </QuietAction>
        )}
      </div>

      {can.archive && (
        <p className="mt-1 px-1 text-caption text-text-muted">
          Umsätze und Importe bleiben erhalten. Das Konto wird nur nicht mehr für neue
          Buchungen angeboten.
        </p>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Konto löschen?"
        message="Das Konto enthält keine Buchungen und wird dauerhaft entfernt."
        confirmLabel="Löschen"
        z="z-[65]"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          remove()
        }}
      />
    </div>
  )
}

function QuietAction({ onClick, disabled, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press-tint flex min-h-[44px] w-full items-center rounded-btn px-1 text-ui ${
        danger ? 'text-danger' : 'text-text-secondary'
      } disabled:opacity-60`}
    >
      {children}
    </button>
  )
}
