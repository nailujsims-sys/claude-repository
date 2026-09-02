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
  console.error('rls: RLS_TEST_REQUIRED gesetzt, aber kein Postgres gefunden.')
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

  // Idempotence is a promise the migration headers make — so it gets tested.
  for (const file of migrations) psql(['-f', join('supabase/migrations', file)])
  console.log(`  erneut angewandt: ${migrations.length} Migrationen laufen zweimal ohne Fehler`)

  const out = psql(['-f', 'supabase/tests/rls.sql'])
  process.stdout.write(out.split('\n').filter((l) => l.trim()).map((l) => `  ${l}`).join('\n') + '\n')

  if (!out.includes('all assertions passed')) {
    console.error('rls: das Skript lief durch, meldete aber keinen Erfolg.')
    process.exit(1)
  }

  // Negative control. A suite that cannot fail proves nothing, so RLS is
  // switched off on one table and the very same script has to reject it.
  psql(['-c', 'alter table public.tasks disable row level security'])
  let caught = false
  try {
    psql(['-f', 'supabase/tests/rls.sql'])
  } catch {
    caught = true
  }
  psql(['-c', 'alter table public.tasks enable row level security'])
  if (!caught) {
    console.error('rls: Gegenprobe bestanden — die Assertions prüfen nichts.')
    process.exit(1)
  }
  console.log('  Gegenprobe: ohne RLS auf public.tasks schlägt dasselbe Skript fehl')

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
