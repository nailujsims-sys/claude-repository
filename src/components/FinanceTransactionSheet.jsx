import { useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import ConfirmDialog from './ConfirmDialog'
import MerchantAvatar from './MerchantAvatar'
import { useFinance } from '../context/FinanceContext'
import { useToast } from '../context/ToastContext'
import { categoryPath } from '../lib/finance/categories'
import { formatAmountMinor, formatBookingDate } from '../lib/finance/importFlow'
import { transactionTypeLabel } from '../config/finance'

// Eine einzelne Buchung, angesehen — und, wenn es sein muss, gelöscht.
//
// WARUM DAS EIN KLEINES SHEET IST UND KEIN EDITOR. Der Buchungen-Tab war bis
// v1.26 eine Liste, die aussah wie etwas, das man antippen kann, und auf ein
// Antippen nicht reagierte. Das ist der eigentliche Fehler, den diese Datei
// behebt: eine Zeile, die nichts tut, ist eine kaputte Zeile. Was sie zeigt,
// ist deshalb genau das, was in der Zeile nicht hineinpasste — Konto,
// Kategoriepfad, Buchungsart, Notiz, „zählt in der Auswertung" — plus die eine
// Handlung, die es bisher nirgends gab.
//
// DER VOLLSTÄNDIGE EDITOR IST v1.26B. Betrag, Datum oder Händler hier ändern zu
// lassen hieße, die Rangfolge aus `effectiveClassification` an einer zweiten
// Stelle zu öffnen; das ist ein eigenes Stück Arbeit und kein Beiwerk eines
// Detail-Sheets.
//
// LÖSCHEN FRAGT NACH, UND ZWAR ZU RECHT. §18/§19 sagen „lieber Rückgängig als
// Rückfrage" — das gilt, solange es ein ehrliches Rückgängig geben kann. Hier
// kann es das nicht: die Buchung ist nach dem Aufruf samt Override, KI-Vorschlag
// und Beobachtungen aus der Datenbank verschwunden, und ein Knopf, der so tut,
// als könnte er sie zurückholen, wäre eine Lüge mit Toast. Also der bestehende
// ConfirmDialog, wie beim Löschen eines leeren Kontos.
//
// DER IMPORT-SATZ IM DIALOG ist keine Deko. Wer eine Buchung aus einem
// Kontoauszug entfernt, erwartet nicht unbedingt, dass die Datei weiterhin als
// „schon eingelesen" gilt — steht es im Dialog, ist es keine Überraschung mehr.
export default function FinanceTransactionSheet({ entry, onClose }) {
  const { accounts, categories, overrides, deleteTransaction } = useFinance()
  const { showToast } = useToast()

  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const override = useMemo(
    () => overrides.find((o) => o.transaction_id === entry?.id) ?? null,
    [overrides, entry]
  )

  if (!entry) return null

  const account = accounts.find((a) => a.id === entry.accountId) ?? null
  const path = categoryPath(categories, entry.categoryId)
  const note = override?.note ?? null
  const imported = Boolean(entry.transaction?.import_id)
  const title = entry.merchantName || entry.description || 'Buchung'

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      await deleteTransaction(entry.id)
      // Kein „Rückgängig" im Toast: es gibt keines. Die Meldung bestätigt, mehr
      // verspricht sie nicht.
      showToast('Buchung gelöscht')
      onClose?.()
    } catch (err) {
      setProblem('Die Buchung konnte nicht gelöscht werden. Es wurde nichts geändert.')
      console.error('finance: Buchung löschen fehlgeschlagen', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <BottomSheet open onClose={onClose} title="Buchung" z="z-[60]">
        <TransactionDetail
          entry={entry}
          title={title}
          account={account}
          categoryLabel={path.label}
          note={note}
          imported={imported}
          busy={busy}
          problem={problem}
          onDelete={() => setConfirm(true)}
        />
      </BottomSheet>

      <ConfirmDialog
        open={confirm}
        title="Buchung löschen?"
        message={
          imported
            ? 'Diese Buchung wird dauerhaft aus Finanzen entfernt. Der zugehörige Import bleibt in der Importhistorie gespeichert.'
            : 'Diese Buchung wird dauerhaft aus Finanzen entfernt.'
        }
        confirmLabel="Buchung löschen"
        z="z-[65]"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          remove()
        }}
      />
    </>
  )
}

/**
 * Der Inhalt des Sheets — exportiert, damit ein echter Browser ihn vermessen
 * kann (tools/financeDashboardLayout.mjs), wie `AccountDetail` und `Overview`.
 */
export function TransactionDetail({
  entry,
  title,
  account,
  categoryLabel,
  note,
  imported,
  busy = false,
  problem = null,
  onDelete,
}) {
  return (
    <div className="px-5 pb-6 pt-1">
      <div className="flex items-center gap-3">
        <MerchantAvatar merchant={entry.merchant} name={title} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-heading font-semibold text-text-primary">{title}</p>
          <p className="truncate text-caption text-text-secondary">
            {formatBookingDate(entry.bookingDate)}
          </p>
        </div>
        <span
          className={`shrink-0 tabular-nums text-section font-bold ${
            entry.amountMinor > 0 ? 'text-success' : 'text-text-primary'
          }`}
        >
          {formatAmountMinor(entry.amountMinor, entry.currency)}
        </span>
      </div>

      <dl className="mt-4 overflow-hidden rounded-card border border-subtle bg-bg-card">
        <Row label="Konto" value={account?.name ?? 'Unbekanntes Konto'} />
        <Row label="Kategorie" value={categoryLabel || 'Nicht zugeordnet'} bordered />
        <Row label="Buchungsart" value={transactionTypeLabel(entry.transactionType)} bordered />
        <Row label="In Auswertung" value={entry.included ? 'Ja' : 'Nein'} bordered />
        {note && <Row label="Notiz" value={note} bordered />}
      </dl>

      {/* Der volle Buchungstext, wenn er etwas anderes sagt als die Überschrift.
          Bei einem Kontoauszug sind das die drei bis fünf gedruckten Zeilen, an
          denen ein Mensch eine Buchung wirklich wiedererkennt. */}
      {entry.description && entry.description !== title && (
        <p className="mt-3 whitespace-pre-line px-1 text-caption text-text-secondary">
          {entry.description}
        </p>
      )}

      {problem && (
        <p className="mt-3 text-caption text-danger" role="alert">
          {problem}
        </p>
      )}

      {/* Die leise, rote Aktion — dasselbe Muster wie „Konto löschen" in der
          Kontoverwaltung: eine Textzeile, kein zweiter Primärknopf. */}
      <div className="mt-4">
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-busy={busy}
          className="press-tint flex min-h-[44px] w-full items-center rounded-btn px-1 text-ui text-danger disabled:opacity-60"
        >
          {busy ? 'Wird gelöscht …' : 'Buchung löschen'}
        </button>
      </div>

      <p className="mt-1 px-1 text-caption text-text-muted">
        {imported
          ? 'Die Buchung wird dauerhaft entfernt. Der Import, aus dem sie stammt, bleibt gespeichert.'
          : 'Die Buchung wird dauerhaft entfernt. Das lässt sich nicht rückgängig machen.'}
      </p>
    </div>
  )
}

function Row({ label, value, bordered = false }) {
  return (
    <div
      className={`flex min-h-[44px] items-center gap-3 px-4 py-2.5 ${
        bordered ? 'border-t border-subtle' : ''
      }`}
    >
      <dt className="shrink-0 text-caption text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-ui text-text-primary">{value}</dd>
    </div>
  )
}
