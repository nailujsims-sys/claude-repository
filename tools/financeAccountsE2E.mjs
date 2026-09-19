// Die Kontoverwaltung gegen eine echte Datenbank.
//
// WARUM DIESE SUITE EXISTIERT UND NICHT DURCH REINE LOGIK ERSETZBAR IST. Die
// Regeln von v1.25 sind Zusagen der DATENBANK, nicht der Oberfläche — genau
// deshalb stehen sie in 0013 und nicht nur in einem Formular:
//
//   • Ein Konto mit Buchungen oder Importen lässt sich nicht löschen. Die
//     Fremdschlüssel stehen auf `on delete cascade`; ein Test, der das nur im
//     Browser prüft, prüft die Höflichkeit und nicht den Schutz.
//   • Die Währung eines belegten Kontos lässt sich nicht mehr ändern, und alte
//     Buchungen werden dabei NICHT umgeschrieben.
//   • Archivieren verändert keine einzige Buchung und keinen Import.
//   • Und was hier liegt, gehört genau einem Benutzer — ein fremdes Konto ist
//     weder lesbar noch änderbar, `anon` hat auf keine der drei Funktionen
//     Ausführungsrechte.
//
// Echte Migrationen (inklusive 0013), echte RPCs, echte Policies.
//
// Überspringt (exit 0), wenn kein Postgres auf der Maschine ist.
import { execFileSync, spawnSync } from 'node:child_process'
import { chownSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BIN_CANDIDATES = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin', '']
const findBin = () => {
  for (const dir of BIN_CANDIDATES) {
    const probe = spawnSync(dir ? join(dir, 'initdb') : 'initdb', ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return dir
  }
  return null
}
const bin = findBin()
if (!bin && !process.env.RLS_TEST_REQUIRED) {
  console.log('finance accounts e2e: kein lokales Postgres gefunden — übersprungen.')
  process.exit(0)
}

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
const sudoUser = asRoot
  ? (() => {
      for (const name of ['postgres', 'ubuntu', 'runner', 'node']) {
        const probe = spawnSync('id', ['-u', name], { encoding: 'utf8' })
        if (probe.status === 0) return { name, uid: Number(probe.stdout.trim()) }
      }
      return null
    })()
  : null
if (asRoot && !sudoUser) {
  console.log('finance accounts e2e: läuft als root ohne unprivilegiertes Konto — übersprungen.')
  process.exit(0)
}

const exe = (n) => (bin ? join(bin, n) : n)
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const pg = (cmd, args, opts = {}) =>
  sudoUser
    ? run('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', cmd, ...args], opts)
    : run(cmd, args, opts)

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else {
    fail += 1
    console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mw-accounts-e2e-'))
const data = join(dir, 'data')
const sqlFile = join(dir, 'q.sql')
let started = false

try {
  if (sudoUser) chownSync(dir, sudoUser.uid, sudoUser.uid)
  pg(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
  pg(exe('pg_ctl'), ['-D', data, '-o', `-k ${dir} -h '' -c fsync=off`, '-w', '-l', join(dir, 'log'), 'start'])
  started = true

  const psql = (args) =>
    pg(exe('psql'), ['-h', dir, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], {
      cwd: process.cwd(),
    })

  psql(['-f', 'tools/pgtest/supabase-stub.sql'])
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) psql(['-f', join('supabase/migrations', file)])
  ok('alle Migrationen inklusive 0013 laufen durch', files.includes('0013_finance_account_management.sql'))

  // Eine additive Migration muss ein zweites Mal durchlaufen, ohne zu meckern —
  // sonst ist sie auf einer Datenbank, die schon einmal deployt wurde, kaputt.
  psql(['-f', join('supabase/migrations', '0013_finance_account_management.sql')])
  ok('0013 lässt sich zweimal einspielen', true)

  // `verbose` stellt psql den SQLSTATE voran — und genau der ist die Zusage,
  // auf die der Client baut: die Oberfläche zeigt den deutschen Satz, aber
  // unterscheiden tut sie am Fehlercode (src/lib/finance/accounts.js).
  const asUser = (userId, sql, { verbose = false } = {}) => {
    const script = `${verbose ? '\\set VERBOSITY verbose\n' : ''}set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
${sql}`
    writeFileSync(sqlFile, script)
    if (sudoUser) chownSync(sqlFile, sudoUser.uid, sudoUser.uid)
    return psql(['-t', '-A', '-f', sqlFile])
  }
  const jsonAsUser = (userId, sql) => {
    const writes = /^\s*(insert|update|delete)\b/i.test(sql)
    const wrapped = writes
      ? `with t as (${sql}) select coalesce(jsonb_agg(t), '[]'::jsonb)::text from t;`
      : `select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (${sql}) t;`
    const out = asUser(userId, wrapped)
    const line = out.trim().split('\n').filter(Boolean).pop()
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`psql gab nichts Lesbares zurueck:\n${out}`)
    }
  }
  // Der Fehler, den die Datenbank tatsächlich wirft — Text UND SQLSTATE. Beides
  // zählt: die Oberfläche zeigt den Satz, der Client unterscheidet am Code.
  const errorOf = (userId, sql) => {
    try {
      asUser(userId, sql, { verbose: true })
      return null
    } catch (err) {
      return String(err.stderr ?? err.stdout ?? err.message ?? '')
    }
  }
  const failsAsUser = (userId, sql) => errorOf(userId, sql) !== null

  const userId = '11111111-2222-4333-8444-555555555555'
  const otherUser = '99999999-2222-4333-8444-555555555555'
  psql(['-c', `insert into auth.users (id, email) values ('${userId}', 'konten@mindwhiteboard.test')`])
  psql(['-c', `insert into auth.users (id, email) values ('${otherUser}', 'fremd@mindwhiteboard.test')`])

  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`

  const newAccount = (owner, name, provider = null, currency = 'EUR') =>
    jsonAsUser(
      owner,
      `insert into public.finance_accounts (user_id, name, provider, currency)
       values ('${owner}', ${quote(name)}, ${provider === null ? 'null' : quote(provider)}, '${currency}')
       returning id`
    )[0].id

  // ── Die Migration archiviert nichts ──────────────────────────────────────
  // Ein Konto, wie es vor 0013 bestand, und dann 0013 noch einmal darüber: es
  // bleibt aktiv. Die Prüfung steht hier oben, weil sie sonst die Konten zählen
  // würde, die dieser Lauf selbst archiviert.
  {
    const bestand = jsonAsUser(
      userId,
      `insert into public.finance_accounts (user_id, name, currency)
       values ('${userId}', 'Konto von vorher', 'EUR') returning id, archived_at`
    )[0]
    ok('ein neu angelegtes Konto ist aktiv', bestand.archived_at === null)
    psql(['-f', join('supabase/migrations', '0013_finance_account_management.sql')])
    const danach = jsonAsUser(
      userId,
      `select archived_at from public.finance_accounts where id = '${bestand.id}'`
    )[0]
    ok('0013 archiviert ein bestehendes Konto nicht', danach.archived_at === null)
    const alle = jsonAsUser(
      userId,
      `select count(*)::int as n from public.finance_accounts
       where user_id = '${userId}' and archived_at is not null`
    )[0].n
    ok('… und auch sonst keines', alle === 0, `${alle} archiviert`)
  }

  const accountRow = (owner, id) =>
    jsonAsUser(
      owner,
      `select id, name, provider, currency, archived_at from public.finance_accounts where id = '${id}'`
    )[0] ?? null

  const addTransaction = (owner, accountId, amount = -2495) =>
    jsonAsUser(
      owner,
      `insert into public.finance_transactions
         (user_id, account_id, booking_date, amount_minor, currency, raw_description, normalized_tokens)
       values ('${owner}', '${accountId}', '2026-09-18', ${amount}, 'EUR', 'REWE TROISDORF', array['REWE'])
       returning id`
    )[0].id

  let hashes = 0
  const addImport = (owner, accountId) => {
    hashes += 1
    return jsonAsUser(
      owner,
      `insert into public.finance_imports (user_id, account_id, source_type, source_name, source_hash, status)
       values ('${owner}', '${accountId}', 'ai', 'KI-Import', 'hash-${hashes}', 'parsed')
       returning id`
    )[0].id
  }

  const update = (owner, id, name, provider, currency) =>
    asUser(
      owner,
      `select public.finance_update_account('${id}'::uuid, ${quote(name)}, ${provider === null ? 'null' : quote(provider)}, ${quote(currency)});`
    )
  const setArchived = (owner, id, archived) =>
    asUser(owner, `select public.finance_set_account_archived('${id}'::uuid, ${archived});`)
  const remove = (owner, id) =>
    asUser(owner, `select public.finance_delete_empty_account('${id}'::uuid);`)

  // ── A) Ein eigenes leeres Konto bearbeiten ───────────────────────────────
  {
    const id = newAccount(userId, 'Girokonto', 'DKB')
    update(userId, id, '  DKB Girokonto  ', ' DKB Bank ', 'eur')
    const row = accountRow(userId, id)
    ok('A: der Name wird gespeichert', row.name === 'DKB Girokonto', row.name)
    ok('A: … und dabei getrimmt', !row.name.startsWith(' '))
    ok('A: der Anbieter wird gespeichert', row.provider === 'DKB Bank', row.provider)
    ok('A: eine klein geschriebene Währung wird normalisiert', row.currency === 'EUR', row.currency)
    ok('A: das Konto bleibt aktiv', row.archived_at === null)

    // Ein leerer Anbieter ist null und nicht ''.
    update(userId, id, 'DKB Girokonto', '   ', 'EUR')
    ok('A: ein leerer Anbieter wird zu null', accountRow(userId, id).provider === null)

    ok('A: ein Konto ohne Namen wird abgelehnt',
       failsAsUser(userId, `select public.finance_update_account('${id}'::uuid, '   ', null, 'EUR');`))
    ok('A: eine Währung ohne drei Buchstaben wird abgelehnt',
       failsAsUser(userId, `select public.finance_update_account('${id}'::uuid, 'X', null, 'EURO');`))
  }

  // ── B) Ein fremdes Konto ist nicht bearbeitbar ───────────────────────────
  {
    const mine = newAccount(userId, 'Mein Konto')
    ok('B: ein fremdes Konto lässt sich nicht umbenennen',
       failsAsUser(otherUser, `select public.finance_update_account('${mine}'::uuid, 'Gekapert', null, 'EUR');`))
    ok('B: … nicht archivieren',
       failsAsUser(otherUser, `select public.finance_set_account_archived('${mine}'::uuid, true);`))
    ok('B: … und nicht löschen',
       failsAsUser(otherUser, `select public.finance_delete_empty_account('${mine}'::uuid);`))
    ok('B: es ist für den Fremden nicht einmal sichtbar',
       jsonAsUser(otherUser, `select id from public.finance_accounts where id = '${mine}'`).length === 0)
    ok('B: und unverändert', accountRow(userId, mine).name === 'Mein Konto')
  }

  // ── C) Währung bei leerem Konto änderbar ─────────────────────────────────
  {
    const id = newAccount(userId, 'Reisekonto', null, 'EUR')
    update(userId, id, 'Reisekonto', null, 'AUD')
    ok('C: die Währung eines leeren Kontos ist frei', accountRow(userId, id).currency === 'AUD')
  }

  // ── D) Währung bei einem Konto mit Buchung abgelehnt ─────────────────────
  {
    const id = newAccount(userId, 'Girokonto EUR', 'DKB', 'EUR')
    const tx = addTransaction(userId, id)
    const before = jsonAsUser(userId,
      `select amount_minor, currency, raw_description from public.finance_transactions where id = '${tx}'`)[0]

    const err = errorOf(userId,
      `select public.finance_update_account('${id}'::uuid, 'Girokonto EUR', 'DKB', 'AUD');`)
    ok('D: der Währungswechsel wird abgelehnt', err !== null)
    ok('D: … mit dem verständlichen Satz',
       Boolean(err?.includes('Die Währung kann nicht mehr geändert werden')), String(err).slice(0, 120))
    ok('D: … und einem eigenen Fehlercode (FIN01)', Boolean(err?.includes('FIN01')))
    ok('D: die Währung des Kontos steht noch', accountRow(userId, id).currency === 'EUR')

    const after = jsonAsUser(userId,
      `select amount_minor, currency, raw_description from public.finance_transactions where id = '${tx}'`)[0]
    ok('D: KEINE alte Buchung wurde umgeschrieben',
       after.amount_minor === before.amount_minor && after.currency === before.currency &&
       after.raw_description === before.raw_description)

    // Name und Anbieter bleiben jederzeit änderbar — auch mit Historie.
    update(userId, id, 'Girokonto (alt)', 'Deutsche Kreditbank', 'EUR')
    ok('D: Name und Anbieter bleiben trotzdem änderbar',
       accountRow(userId, id).name === 'Girokonto (alt)')

    // Und auch ein Konto, an dem nur ein Import hängt, ist keine freie Währung.
    const onlyImport = newAccount(userId, 'Nur Import', null, 'EUR')
    addImport(userId, onlyImport)
    ok('D: ein Konto mit bloß einem Import sperrt die Währung ebenfalls',
       failsAsUser(userId, `select public.finance_update_account('${onlyImport}'::uuid, 'Nur Import', null, 'AUD');`))
  }

  // ── E) Archivieren hält Buchungen und Importe unverändert ────────────────
  {
    const id = newAccount(userId, 'Altes Konto', 'DKB')
    const tx = addTransaction(userId, id, -1234)
    const im = addImport(userId, id)
    const txBefore = jsonAsUser(userId, `select * from public.finance_transactions where id = '${tx}'`)[0]
    const imBefore = jsonAsUser(userId, `select * from public.finance_imports where id = '${im}'`)[0]

    setArchived(userId, id, true)
    const row = accountRow(userId, id)
    ok('E: das Konto trägt einen Archiv-Zeitstempel', row.archived_at !== null)
    ok('E: Name und Währung bleiben stehen', row.name === 'Altes Konto' && row.currency === 'EUR')

    const txAfter = jsonAsUser(userId, `select * from public.finance_transactions where id = '${tx}'`)[0]
    const imAfter = jsonAsUser(userId, `select * from public.finance_imports where id = '${im}'`)[0]
    ok('E: die Buchung ist Zeile für Zeile unverändert',
       JSON.stringify(txAfter) === JSON.stringify(txBefore))
    ok('E: der Import ist Zeile für Zeile unverändert',
       JSON.stringify(imAfter) === JSON.stringify(imBefore))
    ok('E: die Buchung ist weiterhin lesbar',
       jsonAsUser(userId, `select id from public.finance_transactions where account_id = '${id}'`).length === 1)

    // Zweimal archivieren darf den Zeitstempel nicht erneuern — sonst sähe ein
    // altes Archiv aus, als wäre es gerade eben passiert.
    const stamp = row.archived_at
    setArchived(userId, id, true)
    ok('E: zweimal archivieren behält den ersten Zeitstempel',
       accountRow(userId, id).archived_at === stamp)

    // ── F) Reaktivieren ───────────────────────────────────────────────────
    setArchived(userId, id, false)
    ok('F: reaktivieren setzt den Zeitstempel zurück', accountRow(userId, id).archived_at === null)
    ok('F: die Buchung ist immer noch da',
       jsonAsUser(userId, `select id from public.finance_transactions where account_id = '${id}'`).length === 1)
  }

  // ── G) Ein leeres Konto ist löschbar ─────────────────────────────────────
  {
    const id = newAccount(userId, 'Versehen')
    remove(userId, id)
    ok('G: ein leeres Konto ist weg',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${id}'`).length === 0)
  }

  // ── H) Ein Konto mit Buchung ist NICHT löschbar ──────────────────────────
  {
    const id = newAccount(userId, 'Mit Buchung')
    const tx = addTransaction(userId, id)
    const err = errorOf(userId, `select public.finance_delete_empty_account('${id}'::uuid);`)
    ok('H: das Löschen wird abgelehnt', err !== null)
    ok('H: … mit dem verständlichen Satz',
       Boolean(err?.includes('Dieses Konto enthält bereits Finanzdaten')), String(err).slice(0, 120))
    ok('H: … und einem eigenen Fehlercode (FIN02)', Boolean(err?.includes('FIN02')))
    ok('H: das Konto steht noch',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${id}'`).length === 1)
    ok('H: die Buchung steht noch — kein Cascade ist gelaufen',
       jsonAsUser(userId, `select id from public.finance_transactions where id = '${tx}'`).length === 1)
  }

  // ── I) Ein Konto mit Import ist NICHT löschbar ───────────────────────────
  {
    const id = newAccount(userId, 'Nur Import, keine Buchung')
    const im = addImport(userId, id)
    ok('I: das Löschen wird abgelehnt',
       failsAsUser(userId, `select public.finance_delete_empty_account('${id}'::uuid);`))
    ok('I: der Import steht noch',
       jsonAsUser(userId, `select id from public.finance_imports where id = '${im}'`).length === 1)

    // Und auch eine offene Prüfung (0009) zählt — der Beweis, dass die Prüfung
    // die Fremdschlüssel liest und nicht eine Liste von zwei Tabellen.
    const review = newAccount(userId, 'Nur Prüfposten')
    jsonAsUser(
      userId,
      `insert into public.finance_import_review_items
         (user_id, account_id, item_type, reason, payload, item_key)
       values ('${userId}', '${review}', 'manual_review', 'wartet auf einen Menschen',
               '{}'::jsonb, 'key-review-1') returning id`
    )
    ok('I: ein offener Prüfposten verhindert das Löschen ebenfalls',
       failsAsUser(userId, `select public.finance_delete_empty_account('${review}'::uuid);`))
    ok('I: … und finance_account_dependency benennt die Tabelle',
       asUser(userId, `select public.finance_account_dependency('${review}'::uuid);`)
         .includes('finance_import_review_items'))
  }

  // ── J) anon hat auf nichts davon Rechte ──────────────────────────────────
  {
    const id = newAccount(userId, 'Für anon unsichtbar')
    const asAnon = (sql) => {
      const script = `set role anon;\n${sql}`
      writeFileSync(sqlFile, script)
      if (sudoUser) chownSync(sqlFile, sudoUser.uid, sudoUser.uid)
      try {
        psql(['-t', '-A', '-f', sqlFile])
        return null
      } catch (err) {
        return String(err.stderr ?? err.message ?? '')
      }
    }
    ok('J: anon darf finance_update_account nicht ausführen',
       asAnon(`select public.finance_update_account('${id}'::uuid, 'X', null, 'EUR');`) !== null)
    ok('J: anon darf finance_set_account_archived nicht ausführen',
       asAnon(`select public.finance_set_account_archived('${id}'::uuid, true);`) !== null)
    ok('J: anon darf finance_delete_empty_account nicht ausführen',
       asAnon(`select public.finance_delete_empty_account('${id}'::uuid);`) !== null)
    ok('J: anon darf finance_account_dependency nicht ausführen',
       asAnon(`select public.finance_account_dependency('${id}'::uuid);`) !== null)
    ok('J: anon sieht die Tabelle nicht', asAnon('select * from public.finance_accounts;') !== null)
  }

  // ── K) Direktes UPDATE der Währung ───────────────────────────────────────
  //
  //  Der Kern der Nachbesserung: die Regel darf nicht daran hängen, dass ein
  //  Client den RPC benutzt. 0008 erlaubt `update` auf eigene Konten, also muss
  //  der Trigger aus 0013 greifen — sonst wäre jede gespeicherte Zahl dieses
  //  Kontos einen PostgREST-Aufruf von einer neuen Basiswährung entfernt.
  {
    const id = newAccount(userId, 'Direkt belegt', 'DKB', 'EUR')
    addTransaction(userId, id, -777)

    const err = errorOf(
      userId,
      `update public.finance_accounts set currency = 'AUD' where id = '${id}';`
    )
    ok('K: das direkte UPDATE der Währung wird abgelehnt', err !== null)
    ok('K: … mit demselben Satz wie der RPC',
       Boolean(err?.includes('Die Währung kann nicht mehr geändert werden')), String(err).slice(0, 140))
    ok('K: … und demselben Fehlercode (FIN01)', Boolean(err?.includes('FIN01')))
    ok('K: die Währung steht unverändert', accountRow(userId, id).currency === 'EUR')

    // Der Trigger darf nicht mehr verbieten als die Regel: Name und Anbieter
    // bleiben auch direkt änderbar …
    asUser(userId, `update public.finance_accounts set name = 'Direkt umbenannt' where id = '${id}';`)
    ok('K: ein direktes UPDATE des Namens läuft durch',
       accountRow(userId, id).name === 'Direkt umbenannt')

    // … und ein Update, das die Währung MITSCHREIBT, ohne sie zu ändern (ein
    // Client, der die ganze Zeile zurückschickt), ebenfalls.
    asUser(
      userId,
      `update public.finance_accounts set name = 'Ganze Zeile', currency = 'EUR' where id = '${id}';`
    )
    ok('K: eine unveränderte Währung im SET ist kein Wechsel',
       accountRow(userId, id).name === 'Ganze Zeile')

    // Und beim LEEREN Konto bleibt der direkte Wechsel erlaubt.
    const frei = newAccount(userId, 'Direkt leer', null, 'EUR')
    asUser(userId, `update public.finance_accounts set currency = 'AUD' where id = '${frei}';`)
    ok('K: bei einem leeren Konto bleibt die Währung direkt änderbar',
       accountRow(userId, frei).currency === 'AUD')

    // Auch das Archivieren bleibt ein gewöhnliches Update.
    asUser(userId, `update public.finance_accounts set archived_at = now() where id = '${id}';`)
    ok('K: archivieren bleibt ein gewöhnliches UPDATE',
       accountRow(userId, id).archived_at !== null)
  }

  // ── L) Direktes DELETE eines Kontos mit Buchung ──────────────────────────
  //
  //  Ohne die verschärfte Policy nähme dieser eine Aufruf über den Cascade aus
  //  0008 die ganze Buchungshistorie mit.
  {
    const id = newAccount(userId, 'Direkt mit Buchung')
    const tx = addTransaction(userId, id, -4242)

    asUser(userId, `delete from public.finance_accounts where id = '${id}';`)
    ok('L: das Konto ist noch da',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${id}'`).length === 1)
    ok('L: die Buchung ist noch da — kein Cascade ist gelaufen',
       jsonAsUser(userId, `select id from public.finance_transactions where id = '${tx}'`).length === 1)
    ok('L: … und unverändert',
       jsonAsUser(userId,
         `select amount_minor from public.finance_transactions where id = '${tx}'`)[0].amount_minor === -4242)
  }

  // ── M) Direktes DELETE eines Kontos mit Import ───────────────────────────
  {
    const id = newAccount(userId, 'Direkt mit Import')
    const im = addImport(userId, id)

    asUser(userId, `delete from public.finance_accounts where id = '${id}';`)
    ok('M: das Konto ist noch da',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${id}'`).length === 1)
    ok('M: der Import ist noch da',
       jsonAsUser(userId, `select id from public.finance_imports where id = '${im}'`).length === 1)

    // Und derselbe Fall über einen Prüfposten — die dynamische Abhängigkeits-
    // prüfung gilt auch in der Policy, nicht nur im RPC.
    const review = newAccount(userId, 'Direkt mit Prüfposten')
    jsonAsUser(
      userId,
      `insert into public.finance_import_review_items
         (user_id, account_id, item_type, reason, payload, item_key)
       values ('${userId}', '${review}', 'manual_review', 'wartet', '{}'::jsonb, 'key-direct-1')
       returning id`
    )
    asUser(userId, `delete from public.finance_accounts where id = '${review}';`)
    ok('M: ein offener Prüfposten schützt das Konto ebenfalls',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${review}'`).length === 1)
  }

  // ── N) Direktes DELETE eines wirklich leeren Kontos ──────────────────────
  //
  //  Die Zusage lautet „nicht leer ⇒ unter keinem authenticated-Schreibweg
  //  löschbar" — nicht „nur der RPC darf löschen". Ein leeres eigenes Konto
  //  direkt zu löschen bleibt deshalb erlaubt; der Produktweg ist trotzdem
  //  finance_delete_empty_account, weil der im Ablehnungsfall einen Satz sagt,
  //  den ein Mensch lesen kann.
  {
    const id = newAccount(userId, 'Direkt leer und weg')
    const otherId = newAccount(userId, 'Bleibt stehen')
    const txElsewhere = addTransaction(userId, otherId, -1111)

    asUser(userId, `delete from public.finance_accounts where id = '${id}';`)
    ok('N: ein wirklich leeres eigenes Konto lässt sich direkt löschen',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${id}'`).length === 0)
    ok('N: das andere Konto ist unberührt',
       jsonAsUser(userId, `select id from public.finance_accounts where id = '${otherId}'`).length === 1)
    ok('N: und dessen Buchung auch',
       jsonAsUser(userId, `select id from public.finance_transactions where id = '${txElsewhere}'`).length === 1)

    // Ein `delete` ohne `where` über alle eigenen Konten nimmt ebenfalls nur
    // die leeren mit — der Fall, der einen Schaden anrichten würde, wenn die
    // Policy an der Zeile nicht griffe.
    const belegteVorher = jsonAsUser(
      userId,
      `select count(*)::int as n from public.finance_accounts a
       where a.user_id = '${userId}'
         and exists (select 1 from public.finance_transactions t where t.account_id = a.id)`
    )[0].n
    const txVorher = jsonAsUser(userId,
      `select count(*)::int as n from public.finance_transactions where user_id = '${userId}'`)[0].n
    asUser(userId, `delete from public.finance_accounts;`)
    const belegteNachher = jsonAsUser(
      userId,
      `select count(*)::int as n from public.finance_accounts a
       where a.user_id = '${userId}'
         and exists (select 1 from public.finance_transactions t where t.account_id = a.id)`
    )[0].n
    const txNachher = jsonAsUser(userId,
      `select count(*)::int as n from public.finance_transactions where user_id = '${userId}'`)[0].n
    ok('N: ein DELETE ohne WHERE lässt jedes belegte Konto stehen',
       belegteNachher === belegteVorher, `${belegteVorher} → ${belegteNachher}`)
    ok('N: … und keine einzige Buchung geht dabei verloren',
       txNachher === txVorher, `${txVorher} → ${txNachher}`)
  }

  // ── O) Fremde Konten: weiterhin weder les-, änder- noch löschbar ─────────
  {
    const mine = newAccount(userId, 'Immer noch meins', 'DKB', 'EUR')
    addTransaction(userId, mine, -999)
    const mineEmpty = newAccount(userId, 'Meins und leer')

    // Ein Fremder sieht sie nicht …
    ok('O: ein Fremder sieht meine Konten nicht',
       jsonAsUser(otherUser,
         `select id from public.finance_accounts where id in ('${mine}', '${mineEmpty}')`).length === 0)

    // … und ein direktes UPDATE/DELETE trifft nichts. RLS lehnt hier nicht ab,
    // sie findet die Zeile schlicht nicht — geprüft wird deshalb die Wirkung.
    asUser(otherUser, `update public.finance_accounts set name = 'Gekapert' where id = '${mine}';`)
    asUser(otherUser, `update public.finance_accounts set currency = 'AUD' where id = '${mineEmpty}';`)
    asUser(otherUser, `delete from public.finance_accounts where id = '${mine}';`)
    asUser(otherUser, `delete from public.finance_accounts where id = '${mineEmpty}';`)

    const a = accountRow(userId, mine)
    const b = accountRow(userId, mineEmpty)
    ok('O: das belegte Konto ist unverändert', a?.name === 'Immer noch meins' && a?.currency === 'EUR')
    ok('O: auch das leere ist unverändert', b?.name === 'Meins und leer' && b?.currency === 'EUR')
    ok('O: und beide sind noch da', a !== null && b !== null)
    ok('O: die Buchung ebenfalls',
       jsonAsUser(userId, `select id from public.finance_transactions where account_id = '${mine}'`).length === 1)
  }

  // ── P) Die Cascade-Semantik beim Löschen eines Benutzers ─────────────────
  //
  //  DER GRUND, WARUM DIE REGEL EINE POLICY IST UND KEIN `before delete`.
  //  „Ein Konto mit Historie wird nicht einzeln gelöscht" und „wer geht, nimmt
  //  alles mit" sind zwei verschiedene Regeln. Ein Trigger könnte sie nicht
  //  auseinanderhalten und würde die Löschung eines Benutzerkontos unmöglich
  //  machen; eine RLS-Policy gilt nur für `authenticated`, und der Cascade
  //  eines Fremdschlüssels läuft als Eigentümer mit abgeschalteter
  //  Zeilensicherheit. Das wird hier nachgewiesen und nicht geglaubt.
  {
    const doomed = '77777777-2222-4333-8444-555555555555'
    psql(['-c', `insert into auth.users (id, email) values ('${doomed}', 'geht@mindwhiteboard.test')`])

    const acc = newAccount(doomed, 'Konto des scheidenden Nutzers', 'DKB', 'EUR')
    const tx = addTransaction(doomed, acc, -5150)
    const im = addImport(doomed, acc)
    jsonAsUser(
      doomed,
      `insert into public.finance_import_review_items
         (user_id, account_id, item_type, reason, payload, item_key)
       values ('${doomed}', '${acc}', 'manual_review', 'wartet', '{}'::jsonb, 'key-doomed-1')
       returning id`
    )

    // Die Gegenprobe zuerst: für den Nutzer selbst ist dieses Konto geschützt.
    asUser(doomed, `delete from public.finance_accounts where id = '${acc}';`)
    const stillThere = psql([
      '-t', '-A', '-c',
      `select count(*) from public.finance_accounts where id = '${acc}'`,
    ]).trim()
    ok('P: der Nutzer selbst kann sein belegtes Konto nicht löschen', stillThere === '1', stillThere)

    // Und jetzt der Weg, den eine Kontolöschung wirklich geht: der Datensatz in
    // auth.users verschwindet, und der Cascade räumt alles ab.
    psql(['-c', `delete from auth.users where id = '${doomed}'`])

    const countOf = (table, where) =>
      psql(['-t', '-A', '-c', `select count(*) from public.${table} where ${where}`]).trim()

    ok('P: das Benutzerkonto lässt sich löschen', countOf('finance_accounts', `id = '${acc}'`) === '0')
    ok('P: … der Cascade nimmt die Buchung mit',
       countOf('finance_transactions', `id = '${tx}'`) === '0')
    ok('P: … den Import',
       countOf('finance_imports', `id = '${im}'`) === '0')
    ok('P: … und den Prüfposten',
       countOf('finance_import_review_items', `account_id = '${acc}'`) === '0')
    ok('P: von diesem Nutzer bleibt nichts zurück',
       countOf('finance_accounts', `user_id = '${doomed}'`) === '0' &&
       countOf('finance_transactions', `user_id = '${doomed}'`) === '0')

    // Und die Daten des anderen Nutzers hat das nicht angefasst.
    ok('P: die Konten des verbleibenden Nutzers sind unberührt',
       Number(countOf('finance_accounts', `user_id = '${userId}'`)) > 0)
  }

  // ── Die Policy selbst, wie sie in der Datenbank steht ────────────────────
  {
    const policy = jsonAsUser(
      userId,
      `select qual from pg_policies
       where schemaname = 'public' and tablename = 'finance_accounts'
         and policyname = 'finance_accounts_delete_own'`
    )
    ok('die Delete-Policy trägt die Abhängigkeitsprüfung', policy.length === 1 &&
       String(policy[0].qual).includes('finance_account_dependency'),
       policy.length ? String(policy[0].qual).slice(0, 120) : 'keine Policy')

    const trigger = jsonAsUser(
      userId,
      `select tgname from pg_trigger
       where tgrelid = 'public.finance_accounts'::regclass
         and tgname = 'finance_accounts_guard_currency'`
    )
    ok('der Währungs-Trigger hängt an der Tabelle', trigger.length === 1)
  }

  // ── Der Index, an dem „meine aktiven Konten" hängt ───────────────────────
  {
    const rows = jsonAsUser(
      userId,
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'finance_accounts'
         and indexname = 'finance_accounts_user_archived_idx'`
    )
    ok('der Index auf (user_id, archived_at) existiert', rows.length === 1)
  }

} finally {
  if (started) {
    try {
      pg(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'])
    } catch {
      /* egal — das Verzeichnis geht ohnehin gleich weg */
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(`finance accounts e2e: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
