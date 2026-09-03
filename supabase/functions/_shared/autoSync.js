// Der automatische Lauf — ein Wächter um `runSync`, keine zweite Sync-Logik.
//
// Es gibt genau eine Sync-Implementierung (`_shared/sync.js`). Was hier
// dazukommt, ist die Antwort auf die einzige Frage, die ein *automatischer*
// Auslöser stellt und ein manueller nicht: darf jetzt überhaupt gelaufen
// werden? Drei Gründe sprechen dagegen —
//
//   • es läuft bereits einer   → `sync_lock_until` in `google_connections`,
//     per bedingtem UPDATE beansprucht. Das ist atomar: zwei gleichzeitige
//     Ansprüche sehen einander, der zweite trifft null Zeilen und weiß damit,
//     dass er zu spät kam. Kein zweiter Lauf, keine Race Condition.
//   • es lief gerade eben erst → `last_sync_at` ist jünger als der Mindest-
//     abstand. So bleibt ein 5-Minuten-Takt ein 5-Minuten-Takt, auch wenn der
//     Cron-Lauf und drei offene Geräte gleichzeitig anklopfen.
//   • die Verbindung ist abgelaufen → ein automatischer Lauf würde Google im
//     Minutentakt mit einem toten Refresh-Token behelligen und den Fehler
//     immer wieder neu schreiben. Der Nutzer muss neu verbinden; bis dahin
//     schweigt der Automatik-Lauf. *Manuell* geht weiterhin jederzeit — wer
//     den Knopf drückt, bekommt seinen Versuch und seine Fehlermeldung.
//
// Der manuelle Sync ist davon nur durch das Schloss betroffen, und auch das
// nur, solange tatsächlich ein Lauf unterwegs ist.

import { runSync } from './sync.js'
import {
  AUTO,
  AUTO_SYNC_MIN_GAP_MS,
  MANUAL,
  PUSH,
  SKIP_BUSY,
  SKIP_REAUTH,
  SKIP_RECENT,
  SYNC_LOCK_MS,
  autoSyncSkipReason,
} from './autoSyncPolicy.js'

// Die Regeln selbst stehen in autoSyncPolicy.js, damit die App sie mitbenutzen
// kann, ohne die halbe Sync-Maschine mitzuladen. Hier werden sie angewandt.
export {
  AUTO,
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_MIN_GAP_MS,
  MANUAL,
  PUSH,
  SKIP_BUSY,
  SKIP_REAUTH,
  SKIP_RECENT,
  SYNC_LOCK_MS,
  autoSyncSkipReason,
} from './autoSyncPolicy.js'

// Ein Lauf, wenn er darf. Gibt entweder `{ result }` (dann ist `runSync`
// gelaufen) oder `{ skipped }` mit einem der Gründe oben zurück — nie einen
// Fehler dafür, dass gerade nicht der richtige Moment war.
export async function runGuardedSync(deps, options) {
  const { store, now } = deps
  const { userId, trigger = MANUAL, minGapMs = AUTO_SYNC_MIN_GAP_MS, lockMs = SYNC_LOCK_MS, ...rest } = options
  const nowMs = now()

  if (trigger === AUTO) {
    const connection = await store.getConnection(userId)
    const reason = autoSyncSkipReason(connection, nowMs, { minGapMs })
    if (reason) return { skipped: reason, trigger }
  }

  const claimed = await store.claimSyncLock(userId, {
    now: new Date(nowMs).toISOString(),
    until: new Date(nowMs + lockMs).toISOString(),
  })
  if (!claimed) return { skipped: SKIP_BUSY, trigger }

  try {
    const result = await runSync(deps, { userId, ...rest })
    return { result, trigger }
  } finally {
    // Auch nach einem Fehler: ein Schloss, das ein gescheiterter Lauf liegen
    // lässt, hielte die nächsten zehn Minuten jeden weiteren Versuch auf.
    await store.releaseSyncLock(userId).catch(() => {})
  }
}

// Der Cron-Lauf: jede Verbindung, die dafür in Frage kommt, der Reihe nach.
// `clientFor` liefert den Google-Client eines Nutzers (oder null, wenn keine
// Zugangsdaten da sind); `contextFor` den Rest der runSync-Optionen.
//
// Ein Nutzer, dessen Lauf scheitert, hält die anderen nicht auf: der Fehler
// steht danach in seiner Verbindungszeile — genau dort, wo ihn auch ein
// fehlgeschlagener manueller Lauf hinterlässt.
export async function runAutoSyncForAll({ store, now, randomId, clientFor, contextFor, onError }) {
  const connections = await store.listSyncableConnections()
  const runs = []

  for (const connection of connections) {
    const userId = connection.user_id
    const reason = autoSyncSkipReason(connection, now())
    if (reason) {
      runs.push({ userId, skipped: reason })
      continue
    }
    try {
      const google = await clientFor(userId)
      if (!google) {
        runs.push({ userId, skipped: 'no-credentials' })
        continue
      }
      const outcome = await runGuardedSync(
        { google, store, now, randomId },
        { userId, trigger: AUTO, ...(await contextFor(userId)) }
      )
      runs.push({ userId, ...outcome })
    } catch (error) {
      await onError?.(userId, error)
      runs.push({ userId, error: error?.message ?? String(error) })
    }
  }

  return { checked: connections.length, runs }
}
