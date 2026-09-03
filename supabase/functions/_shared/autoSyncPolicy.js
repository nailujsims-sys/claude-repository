// Wann ein *automatischer* Lauf stattfinden darf — die Regeln allein, ohne
// Datenbank, ohne Netz, ohne Google.
//
// Sie stehen in einer eigenen Datei, weil beide Seiten sie brauchen und keine
// Seite die andere mitschleppen soll: der Server (autoSync.js) prüft sie, bevor
// er das Schloss beansprucht, und die App prüft sie, bevor sie ihren Timer
// überhaupt losschickt. Eine Datei, ein Takt, keine zwei Wahrheiten.

// Der Takt. Denselben Wert benutzen der Cron-Zeitplan (Migration 0007) und der
// Timer in der App.
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

// Etwas weniger als der Takt: ein Lauf, der ein paar Sekunden zu früh kommt,
// soll nicht als „gerade erst gelaufen" durchfallen.
export const AUTO_SYNC_MIN_GAP_MS = 4 * 60 * 1000

// Wie lange ein Anspruch gilt, wenn ihn niemand mehr freigibt. Eine Function,
// die mitten im Lauf abgeräumt wird, darf die Synchronisierung nicht dauerhaft
// blockieren — nach dieser Zeit ist das Schloss von selbst wieder offen.
export const SYNC_LOCK_MS = 10 * 60 * 1000

export const SKIP_BUSY = 'busy'
export const SKIP_RECENT = 'recent'
export const SKIP_REAUTH = 'needs_reauth'

// Auslöser: 'manual' (der Knopf), 'auto' (Cron oder der Timer der App),
// 'push' (Googles Benachrichtigung — die meldet eine konkrete Änderung und
// wartet deshalb keinen Mindestabstand ab).
export const MANUAL = 'manual'
export const AUTO = 'auto'
export const PUSH = 'push'

// Der Grund, aus dem ein automatischer Lauf gerade nicht stattfindet — oder
// null, wenn er stattfinden darf.
//
//   'needs_reauth' — die Verbindung ist abgelaufen. Ein automatischer Lauf
//                    würde Google alle fünf Minuten mit einem toten Token
//                    behelligen und denselben Fehler neu schreiben. Der Nutzer
//                    muss neu verbinden; *manuell* geht weiterhin jederzeit.
//   'recent'       — es lief gerade erst einer. So bleibt ein 5-Minuten-Takt
//                    einer, auch wenn der Cron-Lauf und drei offene Geräte
//                    gleichzeitig anklopfen.
export function autoSyncSkipReason(connection, nowMs, { minGapMs = AUTO_SYNC_MIN_GAP_MS } = {}) {
  if (!connection) return null
  if (connection.status === 'needs_reauth') return SKIP_REAUTH
  const last = Date.parse(connection.last_sync_at ?? '')
  if (Number.isFinite(last) && nowMs - last < minGapMs) return SKIP_RECENT
  return null
}

// Dieselbe Frage aus Sicht der App: Soll dieser Tab jetzt einen automatischen
// Lauf anstoßen? Der Server entscheidet danach noch einmal selbst — das hier
// erspart nur den offensichtlich sinnlosen Aufruf.
//
//   • ohne Verbindung gibt es nichts zu synchronisieren;
//   • ein Tab im Hintergrund lässt den Cron-Lauf und die sichtbaren Geräte
//     machen (und Browser drosseln seine Timer ohnehin);
//   • solange eine Aktion des Nutzers läuft, kommt ihr der Automatismus nicht
//     in die Quere;
//   • und was dieser Tab selbst gerade eben erst versucht hat, versucht er
//     nicht sofort noch einmal — sonst würde jeder Wechsel zurück ins Fenster
//     einen neuen Aufruf auslösen.
export function shouldClientAutoSync(
  { connection, visible = true, busy = false, lastAttemptAt = null },
  nowMs,
  { minGapMs = AUTO_SYNC_MIN_GAP_MS } = {}
) {
  if (!connection || !visible || busy) return false
  if (connection.status === 'needs_reauth') return false
  const last = Number(lastAttemptAt)
  if (Number.isFinite(last) && last > 0 && nowMs - last < minGapMs) return false
  return true
}
