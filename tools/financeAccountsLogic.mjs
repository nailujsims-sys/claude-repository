// Die Kontoverwaltung, ohne Browser und ohne Datenbank.
//
// WAS HIER BEWIESEN WIRD UND WAS NICHT. Diese Datei prüft, was die OBERFLÄCHE
// anbietet: welches Konto in der Auswahl steht, welche Aktion an einem Konto
// sichtbar ist, welcher Satz unter einem Feld erscheint. Was die Datenbank
// durchsetzt — dass ein belegtes Konto nicht löschbar ist und die Währung
// gesperrt bleibt — steht in tools/financeAccountsE2E.mjs gegen ein echtes
// Postgres, weil eine Zusage, die man in JavaScript „prüft", eine Zusage an
// einen Mock ist.
//
// Gebündelt mit esbuild wie die anderen Logik-Suiten.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  ACCOUNT_ERROR,
  accountActions,
  accountDraftChanged,
  accountErrorMessage,
  accountSubtitle,
  accountUsage,
  activeAccountsOf,
  archivedAccountsOf,
  canEditCurrency,
  isAccountDraftValid,
  isAccountEmpty,
  isArchivedAccount,
  nextAccountId,
  normalizeAccountDraft,
  selectableAccounts,
  splitAccounts,
  validateAccountDraft,
} from './src/lib/finance/accounts.js'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else {
    fail += 1
    console.log('  ✗ ' + name + (detail ? ' (' + detail + ')' : ''))
  }
}
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
     JSON.stringify(actual) + ' ≠ ' + JSON.stringify(expected))

const giro = { id: 'a1', name: 'DKB Girokonto', provider: 'DKB', currency: 'EUR', archived_at: null }
const alt = { id: 'a2', name: 'Altes Konto', provider: 'ING', currency: 'EUR',
              archived_at: '2026-09-01T10:00:00Z' }
const bar = { id: 'a3', name: 'Bargeld', provider: null, currency: 'EUR', archived_at: null }
const accounts = [giro, alt, bar]

// ── 1. Aktiv und archiviert ─────────────────────────────────────────────────
{
  const { active, archived } = splitAccounts(accounts)
  eq('1: die aktiven Konten, in ihrer Reihenfolge', active.map((a) => a.id), ['a1', 'a3'])
  eq('1: die archivierten', archived.map((a) => a.id), ['a2'])
  ok('1: archived_at entscheidet, nicht ein Flag', isArchivedAccount(alt) && !isArchivedAccount(giro))
  ok('1: archived_at = null ist aktiv', !isArchivedAccount({ archived_at: null }))
  eq('1: ohne Konten zwei leere Listen', splitAccounts([]), { active: [], archived: [] })
  eq('1: splitAccounts ohne Argument stürzt nicht ab', splitAccounts(), { active: [], archived: [] })
  eq('1: activeAccountsOf ist dieselbe Antwort', activeAccountsOf(accounts).map((a) => a.id), ['a1', 'a3'])
  eq('1: archivedAccountsOf ebenso', archivedAccountsOf(accounts).map((a) => a.id), ['a2'])
  ok('1: die Eingabeliste wird nicht verändert', accounts.length === 3 && accounts[0] === giro)
}

// ── 2. Ein archiviertes Konto steht nie zur Wahl (§10) ──────────────────────
{
  eq('2: der Picker sieht nur aktive Konten',
     selectableAccounts(accounts).map((a) => a.id), ['a1', 'a3'])
  ok('2: ein archiviertes Konto ist nirgends darin',
     !selectableAccounts(accounts).some((a) => a.id === 'a2'))
  eq('2: sind alle archiviert, bleibt nichts zu wählen',
     selectableAccounts([alt]), [])
}

// ── 3. Was an einem Konto hängt ─────────────────────────────────────────────
{
  const data = {
    transactions: [{ account_id: 'a1' }, { account_id: 'a1' }, { account_id: 'a2' }],
    imports: [{ account_id: 'a2' }],
  }
  eq('3: Buchungen und Importe werden getrennt gezählt',
     accountUsage('a1', data), { transactions: 2, imports: 0, total: 2 })
  eq('3: … auch wenn nur ein Import da ist',
     accountUsage('a2', data), { transactions: 1, imports: 1, total: 2 })
  eq('3: ein Konto ohne beides ist bei null',
     accountUsage('a3', data), { transactions: 0, imports: 0, total: 0 })
  ok('3: leer heißt keine Buchung UND kein Import', isAccountEmpty('a3', data))
  ok('3: ein Konto mit Buchung ist nicht leer', !isAccountEmpty('a1', data))

  // Der Fall, der ohne die Import-Zeilen falsch wäre: keine Buchung, aber ein
  // abgebrochener Import. Die Datenbank lehnt das Löschen ab — die Oberfläche
  // darf es deshalb gar nicht erst anbieten.
  const nurImport = { transactions: [], imports: [{ account_id: 'a9' }] }
  ok('3: ein Konto mit bloß einem Import ist NICHT leer', !isAccountEmpty('a9', nurImport))
  ok('3: ohne accountId ist nichts gezählt', accountUsage(null, data).total === 0)
  ok('3: ohne Daten ist nichts gezählt', accountUsage('a1').total === 0)
}

// ── 4. Die Währung ──────────────────────────────────────────────────────────
{
  const belegt = { transactions: [{ account_id: 'a1' }], imports: [] }
  const leer = { transactions: [], imports: [] }
  ok('4: die Währung eines leeren Kontos ist frei', canEditCurrency('a1', leer))
  ok('4: die Währung eines belegten Kontos ist gesperrt', !canEditCurrency('a1', belegt))
  ok('4: ein bloßer Import sperrt sie ebenfalls',
     !canEditCurrency('a1', { transactions: [], imports: [{ account_id: 'a1' }] }))
}

// ── 5. Welche Aktion ein Konto anbietet (§8) ────────────────────────────────
{
  const belegt = { transactions: [{ account_id: 'a1' }], imports: [] }
  const leer = { transactions: [], imports: [] }

  eq('5: aktiv mit Daten → archivieren',
     accountActions(giro, belegt), { archive: true, reactivate: false, remove: false, currency: false })
  eq('5: aktiv und leer → löschen',
     accountActions(giro, leer), { archive: false, reactivate: false, remove: true, currency: true })
  const altBelegt = { transactions: [{ account_id: 'a2' }], imports: [] }
  eq('5: archiviert mit Daten → nur reaktivieren',
     accountActions(alt, altBelegt), { archive: false, reactivate: true, remove: false, currency: false })
  ok('5: nie zwei Aktionen gleichzeitig', [belegt, leer, altBelegt].every((data) =>
     [giro, alt].every((account) => {
       const a = accountActions(account, data)
       return [a.archive, a.reactivate, a.remove].filter(Boolean).length === 1
     })))
  ok('5: ein archiviertes leeres Konto wird reaktiviert, nicht gelöscht',
     accountActions(alt, leer).reactivate && !accountActions(alt, leer).remove)
  eq('5: ohne Konto gibt es keine Aktion',
     accountActions(null, leer), { archive: false, reactivate: false, remove: false, currency: false })
}

// ── 6. Das gewählte Konto, nachdem eines wegfällt (§4) ──────────────────────
{
  ok('6: ein gültiges gewähltes Konto bleibt stehen',
     nextAccountId(accounts, 'a3') === 'a3')
  ok('6: wird das gewählte archiviert, rückt das erste aktive nach',
     nextAccountId(accounts, 'a2') === 'a1')
  ok('6: wird das gewählte gelöscht, ebenso',
     nextAccountId([alt, bar], 'weg') === 'a3')
  ok('6: ohne ein einziges aktives Konto ist die Antwort null — der normale Fall',
     nextAccountId([alt], 'a2') === null)
  ok('6: ganz ohne Konten ebenfalls null', nextAccountId([], null) === null)
  ok('6: ohne Wahl wird das erste aktive vorgeschlagen', nextAccountId(accounts, null) === 'a1')

  // Der konkrete Ablauf aus §4: das eine aktive Konto wird archiviert.
  const danach = accounts.map((a) => (a.id === 'a1' ? { ...a, archived_at: 'jetzt' } : a))
  ok('6: nach dem Archivieren des gewählten Kontos steht ein anderes aktives da',
     nextAccountId(danach, 'a1') === 'a3')
}

// ── 7. Die zweite Zeile einer Kontozeile ────────────────────────────────────
{
  ok('7: Anbieter und Währung', accountSubtitle(giro) === 'DKB · EUR')
  ok('7: ohne Anbieter nur die Währung', accountSubtitle(bar) === 'EUR')
  ok('7: ein leerer Anbieter zählt als keiner',
     accountSubtitle({ provider: '   ', currency: 'EUR' }) === 'EUR')
  ok('7: ohne alles ein leerer Text', accountSubtitle({}) === '')
}

// ── 8. Der Entwurf im Formular ──────────────────────────────────────────────
{
  eq('8: getrimmt, Anbieter optional, Währung groß',
     normalizeAccountDraft({ name: '  Giro  ', provider: ' dkb ', currency: 'eur' }),
     { name: 'Giro', provider: 'dkb', currency: 'EUR' })
  eq('8: ein leerer Anbieter wird null',
     normalizeAccountDraft({ name: 'Giro', provider: '   ', currency: 'EUR' }).provider, null)
  eq('8: ohne Währung die Voreinstellung',
     normalizeAccountDraft({ name: 'Giro' }).currency, 'EUR')

  ok('8: ohne Namen kein Speichern',
     validateAccountDraft({ name: '   ', currency: 'EUR' }) === 'Das Konto braucht einen Namen.')
  ok('8: ein zu langer Name wird benannt',
     validateAccountDraft({ name: 'x'.repeat(121), currency: 'EUR' }).includes('zu lang'))
  ok('8: ein zu langer Anbieter auch',
     validateAccountDraft({ name: 'Giro', provider: 'y'.repeat(81), currency: 'EUR' }).includes('Bank'))
  ok('8: eine Währung ohne drei Buchstaben wird abgelehnt',
     validateAccountDraft({ name: 'Giro', currency: 'EURO' }) !== null)
  ok('8: EUR geht', isAccountDraftValid({ name: 'Giro', currency: 'EUR' }))
  ok('8: die Grenzen selbst gehen noch',
     isAccountDraftValid({ name: 'x'.repeat(120), provider: 'y'.repeat(80), currency: 'AUD' }))

  ok('9: ein unveränderter Entwurf ist unverändert',
     !accountDraftChanged(giro, { name: 'DKB Girokonto', provider: 'DKB', currency: 'EUR' }))
  ok('9: ein neuer Name ist eine Änderung',
     accountDraftChanged(giro, { name: 'Giro', provider: 'DKB', currency: 'EUR' }))
  ok('9: ein entfernter Anbieter ist eine Änderung',
     accountDraftChanged(giro, { name: 'DKB Girokonto', provider: '', currency: 'EUR' }))
  ok('9: eine andere Währung ist eine Änderung',
     accountDraftChanged(giro, { name: 'DKB Girokonto', provider: 'DKB', currency: 'AUD' }))
}

// ── 10. Was nach einem abgelehnten Schreibvorgang dasteht ───────────────────
{
  ok('10: FIN01 wird zum Satz über die Währung',
     accountErrorMessage({ code: ACCOUNT_ERROR.currencyLocked })
       === 'Die Währung kann nicht mehr geändert werden, weil das Konto bereits Buchungen enthält.')
  ok('10: FIN02 wird zum Satz über die Finanzdaten',
     accountErrorMessage({ code: ACCOUNT_ERROR.notEmpty })
       === 'Dieses Konto enthält bereits Finanzdaten und kann nur archiviert werden.')
  ok('10: FIN03 trägt seinen Text selbst',
     accountErrorMessage({ code: ACCOUNT_ERROR.invalid, message: 'Das Konto braucht einen Namen.' })
       === 'Das Konto braucht einen Namen.')
  ok('10: ein unbekannter Fehler bekommt keinen erfundenen Grund',
     accountErrorMessage({ code: 'PGRST000', message: 'irgendwas Technisches' })
       === 'Das hat nicht geklappt. Versuch es noch einmal.')
  ok('10: … und auch gar kein Fehler nicht', accountErrorMessage(null).length > 0)
  ok('10: der Ersatztext ist wählbar',
     accountErrorMessage(new Error('x'), 'Eigener Satz') === 'Eigener Satz')
  // Die Codes selbst sind die Schnittstelle zu 0013 — sie dürfen sich nicht
  // still ändern, sonst zeigt die App wieder „irgendwas Technisches".
  eq('10: die Fehlercodes sind die aus 0013',
     [ACCOUNT_ERROR.currencyLocked, ACCOUNT_ERROR.notEmpty, ACCOUNT_ERROR.invalid],
     ['FIN01', 'FIN02', 'FIN03'])
}

console.log('finance accounts logic: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeAccountsLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeAccountsLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
