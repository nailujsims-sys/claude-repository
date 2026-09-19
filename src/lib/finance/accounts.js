// Konten: was aktiv ist, was leer ist, und was ein Mensch daran ändern darf.
//
// Reine Funktionen, keine React-Komponente und kein Supabase — dieselbe
// Aufteilung wie im Rest des Moduls: die Regeln stehen hier, prüfbar ohne
// Browser und ohne Datenbank, und die Oberfläche fragt sie.
//
// DIE ZWEITE WAHRHEIT, UND WARUM SIE TROTZDEM RICHTIG IST. Dieselben Regeln
// stehen noch einmal in supabase/migrations/0013 — und dort sind sie der
// Schutz: ein gesperrtes Eingabefeld ist Höflichkeit, `finance_update_account`
// ist die Zusage. Was hier liegt, entscheidet nur, was die Oberfläche anbietet,
// damit ein Nutzer nicht gegen eine Wand läuft, deren Existenz er nicht sehen
// konnte. Eine Regel, die hier fehlt, ist ein hässlicher Fehler; eine Regel,
// die dort fehlt, ist ein Datenverlust.

import { DEFAULT_FINANCE_CURRENCY, isCurrencyCode } from '../../config/finance'

export const ACCOUNT_NAME_MAX = 120
export const ACCOUNT_PROVIDER_MAX = 80

// Die Fehlercodes, die 0013 wirft. Sie sind der Grund, warum die Oberfläche
// eine verständliche Meldung zeigen kann, ohne den Text der Datenbank zu
// parsen — der könnte sich ändern, der Code nicht.
export const ACCOUNT_ERROR = Object.freeze({
  currencyLocked: 'FIN01',
  notEmpty: 'FIN02',
  invalid: 'FIN03',
})

const ACCOUNT_ERROR_MESSAGES = Object.freeze({
  [ACCOUNT_ERROR.currencyLocked]:
    'Die Währung kann nicht mehr geändert werden, weil das Konto bereits Buchungen enthält.',
  [ACCOUNT_ERROR.notEmpty]:
    'Dieses Konto enthält bereits Finanzdaten und kann nur archiviert werden.',
})

/** Ein archiviertes Konto trägt einen Zeitstempel; `null` heißt aktiv. */
export const isArchivedAccount = (account) => Boolean(account?.archived_at)

/**
 * Aktiv und archiviert, in der Reihenfolge, in der sie hereinkamen.
 *
 * Bewusst KEIN Filter, der irgendwo anders noch einmal gebaut werden müsste:
 * `accounts` bleibt überall „alle Konten" (sonst verschwände ein archiviertes
 * Konto aus Stellen, die die Historie lesen), und wer nur die aktiven braucht,
 * fragt hier danach.
 */
export function splitAccounts(accounts = []) {
  const active = []
  const archived = []
  for (const account of accounts) {
    if (isArchivedAccount(account)) archived.push(account)
    else active.push(account)
  }
  return { active, archived }
}

export const activeAccountsOf = (accounts = []) => splitAccounts(accounts).active
export const archivedAccountsOf = (accounts = []) => splitAccounts(accounts).archived

/**
 * Was für neue Buchungen und Importe zur Wahl steht.
 *
 * Genau die aktiven Konten — die eine Zusage von §10. Sie steht als eigene
 * Funktion da und nicht als `accounts.filter(...)` an drei Stellen, weil „ein
 * archiviertes Konto ist nie auswählbar" eine Regel ist und keine Gewohnheit.
 */
export const selectableAccounts = (accounts = []) => activeAccountsOf(accounts)

/**
 * Wie viel Finanzhistorie an einem Konto hängt.
 *
 * Nur die beiden Tabellen, die der Client ohnehin liest. Die vollständige
 * Antwort gibt `finance_account_dependency` in 0013 — hier geht es darum, ob
 * „Löschen" überhaupt angeboten wird.
 */
export function accountUsage(accountId, { transactions = [], imports = [] } = {}) {
  if (!accountId) return { transactions: 0, imports: 0, total: 0 }
  let tx = 0
  let im = 0
  for (const row of transactions) if (row?.account_id === accountId) tx += 1
  for (const row of imports) if (row?.account_id === accountId) im += 1
  return { transactions: tx, imports: im, total: tx + im }
}

/** Leer heißt: keine Buchung, kein Import. */
export const isAccountEmpty = (accountId, data) => accountUsage(accountId, data).total === 0

/** Die Währung ist so lange frei, wie das Konto leer ist — §3. */
export const canEditCurrency = (accountId, data) => isAccountEmpty(accountId, data)

/**
 * Welche der drei leisen Aktionen ein Konto gerade anbietet.
 *
 * Es sind nie alle drei: ein archiviertes Konto wird reaktiviert, ein leeres
 * gelöscht, alles andere archiviert. Die Datenbank ließe zwar auch das
 * Archivieren eines leeren Kontos zu (0013, Abschnitt 5) — angeboten wird es
 * nicht, weil „weg" bei einem leeren Konto die ehrlichere Antwort ist.
 */
export function accountActions(account, data) {
  if (!account) return { archive: false, reactivate: false, remove: false, currency: false }
  const archived = isArchivedAccount(account)
  const empty = isAccountEmpty(account.id, data)
  return {
    archive: !archived && !empty,
    reactivate: archived,
    remove: !archived && empty,
    currency: empty,
  }
}

/**
 * Auf welches Konto die Oberfläche wechselt, wenn das gewählte wegfällt.
 *
 * „Wegfallen" heißt archiviert oder gelöscht, und die Antwort ist dieselbe:
 * das erste aktive Konto, das übrig ist — oder null, und dann ist das die
 * ganz normale „kein aktives Konto"-Situation, die der Picker schon kennt.
 * Ein noch gültiges `currentId` bleibt unangetastet; ein Wechsel, den niemand
 * verlangt hat, wäre schlimmer als gar keiner.
 */
export function nextAccountId(accounts = [], currentId = null) {
  const active = activeAccountsOf(accounts)
  if (currentId && active.some((a) => a.id === currentId)) return currentId
  return active[0]?.id ?? null
}

/** „DKB · EUR", oder nur „EUR", wenn keine Bank hinterlegt ist. */
export const accountSubtitle = (account) =>
  [account?.provider?.trim() || null, account?.currency || null].filter(Boolean).join(' · ')

/** Was aus den drei Feldern eines Formulars wird, bevor sie gespeichert werden. */
export function normalizeAccountDraft({ name = '', provider = '', currency = '' } = {}) {
  return {
    name: String(name).trim(),
    provider: String(provider).trim() || null,
    currency: String(currency).trim().toUpperCase() || DEFAULT_FINANCE_CURRENCY,
  }
}

/**
 * Der erste Grund, warum dieses Formular noch nicht gespeichert werden kann —
 * oder null.
 *
 * Ein Satz statt einer Liste: es sind drei Felder, und der Nutzer räumt sie
 * ohnehin eines nach dem anderen auf.
 */
export function validateAccountDraft(draft) {
  const { name, provider, currency } = normalizeAccountDraft(draft)
  if (name === '') return 'Das Konto braucht einen Namen.'
  if (name.length > ACCOUNT_NAME_MAX) return 'Der Name des Kontos ist zu lang.'
  if (provider && provider.length > ACCOUNT_PROVIDER_MAX) return 'Der Name der Bank ist zu lang.'
  if (!isCurrencyCode(currency)) return 'Die Währung braucht drei Buchstaben, zum Beispiel EUR.'
  return null
}

export const isAccountDraftValid = (draft) => validateAccountDraft(draft) === null

/** Hat sich gegenüber der gespeicherten Zeile überhaupt etwas geändert? */
export function accountDraftChanged(account, draft) {
  const next = normalizeAccountDraft(draft)
  return (
    next.name !== (account?.name ?? '') ||
    next.provider !== (account?.provider ?? null) ||
    next.currency !== (account?.currency ?? '')
  )
}

/**
 * Was auf dem Bildschirm steht, wenn ein Schreibvorgang abgelehnt wurde.
 *
 * Die beiden Regeln, die 0013 durchsetzt, haben dort ihren eigenen Fehlercode
 * und ihren eigenen deutschen Satz. Für alles andere — Netzwerk, RLS, ein
 * Fehler, den es heute noch nicht gibt — steht ein Satz bereit, der nicht so
 * tut, als wüsste die App mehr als sie weiß.
 */
export function accountErrorMessage(error, fallback = 'Das hat nicht geklappt. Versuch es noch einmal.') {
  const code = error?.code ?? null
  if (code && ACCOUNT_ERROR_MESSAGES[code]) return ACCOUNT_ERROR_MESSAGES[code]
  // FIN03 trägt seinen Text selbst — es ist der Satz zum konkreten Feld.
  if (code === ACCOUNT_ERROR.invalid && error?.message) return error.message
  return fallback
}
