// Runs supabase/tests/rls.sql against a real Postgres.
//
// The point is that Row Level Security is a database behaviour: asserting it in
// JavaScript would only test the mock. So this boots a throwaway cluster in a
// temp directory, adds the pieces of Supabase the migrations lean on
// (tools/pgtest/supabase-stub.sql), applies every migration in order, and runs
// the assertions. The cluster is deleted afterwards, whatever happened.
//
// Skips (exit 0) when no Postgres binaries are on the machine — the deploy
// workflow gates on `npm run verify`, and a missing local database must not
// fail a build. Run it before touching a migration; run it again after.
import { execFileSync, spawnSync } from 'node:child_process'
import { chownSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { userInfo } from 'node:os'

const BIN_CANDIDATES = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin', '']

function findBin() {
  for (const dir of BIN_CANDIDATES) {
    const initdb = dir ? join(dir, 'initdb') : 'initdb'
    const probe = spawnSync(initdb, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return dir
  }
  return null
}

const bin = findBin()
if (!bin && !process.env.RLS_TEST_REQUIRED) {
  console.log('rls: kein lokales Postgres gefunden — übersprungen.')
  console.log('     (In Supabase: SQL Editor → supabase/tests/rls.sql ausführen.)')
  process.exit(0)
}
if (!bin) {
  console.error('rls: RLS_TEST_REQUIRED ist gesetzt, aber es wurde kein unterstütztes PostgreSQL (16, 15 oder 14) gefunden.')
  process.exit(1)
}

const exe = (name) => (bin ? join(bin, name) : name)

// Postgres refuses to run as root, and CI containers often are root. When that
// is the case every call is dropped to an unprivileged account instead — the
// `postgres` user the package brings, or any other real login on the box.
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
const sudoUser = asRoot ? pickUnprivilegedUser() : null

function pickUnprivilegedUser() {
  for (const name of ['postgres', 'ubuntu', 'runner', 'node']) {
    const probe = spawnSync('id', ['-u', name], { encoding: 'utf8' })
    if (probe.status === 0) return { name, uid: Number(probe.stdout.trim()) }
  }
  return null
}

// setpriv keeps the call synchronous and quoting-free, unlike `su -c '…'`.
function pg(cmd, args, opts = {}) {
  if (!sudoUser) return run(cmd, args, opts)
  return run('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', cmd, ...args], opts)
}
const dir = mkdtempSync(join(tmpdir(), 'mw-rls-'))
const data = join(dir, 'data')
const sock = dir
let started = false

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

try {
  if (asRoot && !sudoUser) {
    // PostgreSQL läuft nicht als root, also braucht dieser Lauf ein
    // unprivilegiertes Konto. Auf einem Entwicklungsrechner ist das ein Grund
    // zu überspringen; im Deployment ist es ein Fehler — ein Gate, das sich
    // selbst abschalten kann, ist kein Gate. Geworfen statt `exit(1)`, damit
    // das `finally` unten den Cluster noch aufräumt.
    if (process.env.RLS_TEST_REQUIRED) {
      throw new Error('rls: läuft als root und findet kein unprivilegiertes Konto — im Deployment ist das ein Fehler.')
    }
    console.log('rls: läuft als root und findet kein unprivilegiertes Konto — übersprungen.')
    process.exit(0)
  }
  if (sudoUser) {
    // The cluster directory has to belong to whoever runs the server.
    chownSync(dir, sudoUser.uid, sudoUser.uid)
  }

  pg(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
  pg(exe('pg_ctl'), ['-D', data, '-o', `-k ${sock} -h '' -c fsync=off`, '-w', '-l', join(dir, 'log'), 'start'])
  started = true

  const psql = (args) =>
    pg(exe('psql'), ['-h', sock, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], {
      cwd: process.cwd(),
    })

  psql(['-f', 'tools/pgtest/supabase-stub.sql'])

  const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const file of migrations) {
    psql(['-f', join('supabase/migrations', file)])
    console.log(`  angewandt: ${file}`)
  }

  // ── Upgrade-Probe: die neueste Migration auf einem BESTEHENDEN Schema ──────
  // Alles oben baut die Datenbank in einem Zug. Produktion fragt etwas anderes:
  // die vorige Migration liegt seit Wochen drauf, es stehen Daten darunter, und
  // jetzt kommt die neue. Also eine zweite Datenbank, die genau diesen Weg geht.
  const latest = migrations[migrations.length - 1]
  const earlier = migrations.slice(0, -1)
  psql(['-c', 'create database upgrade_probe'])
  const probe = (args) =>
    pg(exe('psql'), ['-h', sock, '-U', 'postgres', '-d', 'upgrade_probe', '-v', 'ON_ERROR_STOP=1', ...args], {
      cwd: process.cwd(),
    })
  probe(['-f', 'tools/pgtest/supabase-stub.sql'])
  for (const file of earlier) probe(['-f', join('supabase/migrations', file)])
  probe(['-f', 'supabase/tests/finance_import_upgrade_seed.sql'])
  probe(['-f', join('supabase/migrations', latest)])
  probe(['-f', join('supabase/migrations', latest)])
  const upgrade = probe(['-f', 'supabase/tests/finance_import_upgrade_verify.sql'])
  if (!upgrade.includes('FINANCE-UPGRADE: all assertions passed')) {
    console.error(`rls: ${latest} auf bestehendem Schema meldete keinen Erfolg.`)
    process.exit(1)
  }
  console.log(`  Upgrade-Probe: ${latest} läuft zweimal auf einem bestehenden Schema und lässt die Daten in Ruhe`)

  // ── Upgrade-Probe II: die Kategorie-Hierarchie ────────────────────────────
  // Dieselbe Frage, auf die eine Zusage von 0014 hinausläuft und die sich in
  // JavaScript prinzipiell nicht stellen lässt: behalten die fünf Kategorien
  // aus 0008 ihre `id`, und zeigt danach jeder Fremdschlüssel noch auf dieselbe
  // Zeile? Also eine eigene Datenbank, die bis 0013 gebaut, dann mit echten
  // Daten befüllt und erst danach auf 0014 gehoben wird.
  psql(['-c', 'create database category_probe'])
  const catProbe = (args) =>
    pg(exe('psql'), ['-h', sock, '-U', 'postgres', '-d', 'category_probe', '-v', 'ON_ERROR_STOP=1', ...args], {
      cwd: process.cwd(),
    })
  catProbe(['-f', 'tools/pgtest/supabase-stub.sql'])
  for (const file of earlier) catProbe(['-f', join('supabase/migrations', file)])
  catProbe(['-f', 'supabase/tests/finance_category_upgrade_seed.sql'])
  catProbe(['-f', join('supabase/migrations', latest)])
  catProbe(['-f', join('supabase/migrations', latest)])
  const catUpgrade = catProbe(['-f', 'supabase/tests/finance_category_upgrade_verify.sql'])
  if (!catUpgrade.includes('FINANCE-CATEGORY-UPGRADE: all assertions passed')) {
    console.error('rls: die Kategorie-Hierarchie meldete auf bestehenden Daten keinen Erfolg.')
    process.exit(1)
  }
  console.log('  Upgrade-Probe: die fünf Kategorie-IDs aus 0008 überleben 0014 unverändert, mit allen Fremdschlüsseln')

  // Idempotence is a promise the migration headers make — so it gets tested.
  for (const file of migrations) psql(['-f', join('supabase/migrations', file)])
  console.log(`  erneut angewandt: ${migrations.length} Migrationen laufen zweimal ohne Fehler`)

  // Two suites against the same cluster: the policies, and the one operation
  // that writes across all of them.
  const suites = [
    { file: 'supabase/tests/rls.sql', marker: 'RLS: all assertions passed' },
    { file: 'supabase/tests/finance_import.sql', marker: 'FINANCE-IMPORT: all assertions passed' },
    { file: 'supabase/tests/finance_category_hierarchy.sql', marker: 'CATS: all assertions passed' },
  ]

  for (const suite of suites) {
    const out = psql(['-f', suite.file])
    process.stdout.write(out.split('\n').filter((l) => l.trim()).map((l) => `  ${l}`).join('\n') + '\n')
    if (!out.includes(suite.marker)) {
      console.error(`rls: ${suite.file} lief durch, meldete aber keinen Erfolg.`)
      process.exit(1)
    }
  }

  // Negative control. A suite that cannot fail proves nothing, so RLS is
  // switched off on one table and the very same script has to reject it. One
  // table per module that has its own assertion block — a control on `tasks`
  // alone would say nothing about whether the finance assertions bite.
  const controls = [
    { table: 'public.tasks', file: 'supabase/tests/rls.sql' },
    { table: 'public.finance_transactions', file: 'supabase/tests/rls.sql' },
    { table: 'public.finance_import_review_items', file: 'supabase/tests/finance_import.sql' },
    { table: 'public.finance_transaction_relations', file: 'supabase/tests/finance_import.sql' },
    { table: 'public.finance_transaction_observation_sightings', file: 'supabase/tests/finance_import.sql' },
    { table: 'public.finance_import_review_item_transactions', file: 'supabase/tests/finance_import.sql' },
  ]
  for (const { table, file } of controls) {
    psql(['-c', `alter table ${table} disable row level security`])
    let caught = false
    try {
      psql(['-f', file])
    } catch {
      caught = true
    }
    psql(['-c', `alter table ${table} enable row level security`])
    if (!caught) {
      console.error(`rls: Gegenprobe bestanden — die Assertions zu ${table} prüfen nichts.`)
      process.exit(1)
    }
    console.log(`  Gegenprobe: ohne RLS auf ${table} schlägt ${file} fehl`)
  }

  // More counter-proofs, aimed at the promises RLS cannot make. Each one takes
  // away exactly one guard and demands that the same suite notices — a suite
  // that cannot fail proves nothing, and these are the guards that stand
  // between a client bug and a wrong number in a spending report.
  const guards = [
    {
      what: 'Append-only auf Beobachtungen',
      drop: 'drop trigger finance_observations_no_update on public.finance_transaction_observations',
    },
    {
      what: 'Append-only auf Sichtungen',
      drop: 'drop trigger finance_sightings_no_update on public.finance_transaction_observation_sightings',
    },
    {
      what: 'Kohärenz-Prüfung der Relationen',
      drop: 'drop trigger finance_relation_members_coherent on public.finance_transaction_relation_members',
    },
    {
      what: 'statusbewusster Vorgänger-Index',
      drop: 'drop index finance_relation_members_one_predecessor_idx',
    },
  ]
  for (const guard of guards) {
    psql(['-c', guard.drop])
    let caught = false
    try {
      psql(['-f', 'supabase/tests/finance_import.sql'])
    } catch {
      caught = true
    }
    if (!caught) {
      console.error(`rls: Gegenprobe bestanden — ohne ${guard.what} merkt die Suite nichts.`)
      process.exit(1)
    }
    console.log(`  Gegenprobe: ohne ${guard.what} schlägt finance_import.sql fehl`)
    // Put it back, so the next counter-proof tests its own guard alone.
    psql(['-f', 'supabase/migrations/0009_finance_import.sql'])
  }

  // Dieselbe Übung für 0014. Jeder der fünf Wächter kommt einzeln weg, und die
  // Hierarchie-Suite muss es einzeln merken — sonst prüft sie den Wächter nicht,
  // sondern nur, dass die Datenbank antwortet. Dazu die beiden Regeln, an denen
  // die Zweistufigkeit hängt, und der Fremdschlüssel selbst: wird er wieder auf
  // `restrict` gesetzt, fällt die Suite auf „is not deferrable" — genau der
  // Grund, warum er es nicht mehr ist.
  const categoryGuards = [
    { what: 'den Wächter auf finance_transactions',
      drop: 'drop trigger finance_transactions_category_assignable on public.finance_transactions' },
    { what: 'den Wächter auf finance_transaction_overrides',
      drop: 'drop trigger finance_overrides_category_assignable on public.finance_transaction_overrides' },
    { what: 'den Wächter auf finance_category_rules',
      drop: 'drop trigger finance_category_rules_category_assignable on public.finance_category_rules' },
    { what: 'den Wächter auf finance_transaction_ai_suggestions',
      drop: 'drop trigger finance_ai_suggestions_category_assignable on public.finance_transaction_ai_suggestions' },
    { what: 'den Wächter auf finance_ai_learning_memories',
      drop: 'drop trigger finance_ai_memories_category_assignable on public.finance_ai_learning_memories' },
    { what: 'die Zweistufigkeit',
      drop: 'drop trigger finance_categories_hierarchy on public.finance_categories' },
    { what: 'den aufschiebbaren Fremdschlüssel (zurück auf restrict)',
      drop: 'alter table public.finance_categories drop constraint finance_categories_parent_fk; '
          + 'alter table public.finance_categories add constraint finance_categories_parent_fk '
          + 'foreign key (parent_id) references public.finance_categories (id) on delete restrict' },
  ]
  for (const guard of categoryGuards) {
    psql(['-c', guard.drop])
    let caught = false
    try {
      psql(['-f', 'supabase/tests/finance_category_hierarchy.sql'])
    } catch {
      caught = true
    }
    if (!caught) {
      console.error(`rls: Gegenprobe bestanden — ohne ${guard.what} merkt die Hierarchie-Suite nichts.`)
      process.exit(1)
    }
    console.log(`  Gegenprobe: ohne ${guard.what} schlägt finance_category_hierarchy.sql fehl`)
    psql(['-f', 'supabase/migrations/0014_finance_category_hierarchy.sql'])
  }

  console.log('\nrls: alle Policies verhalten sich wie erwartet.')
} catch (err) {
  console.error('rls: FEHLGESCHLAGEN\n')
  console.error(err.stdout || '')
  console.error(err.stderr || err.message)
  process.exit(1)
} finally {
  if (started) {
    const stop = [exe('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']]
    if (sudoUser) spawnSync('setpriv', ['--reuid', String(sudoUser.uid), '--regid', String(sudoUser.uid), '--clear-groups', stop[0], ...stop[1]], { stdio: 'ignore' })
    else spawnSync(stop[0], stop[1], { stdio: 'ignore' })
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
