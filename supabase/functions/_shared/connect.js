// Was nach dem Code-Tausch passiert — und was passiert, wenn es schiefgeht.
//
// Der OAuth-Callback hatte die Zugangsdaten gespeichert und die Verbindung auf
// `connected` gesetzt, *bevor* er zum ersten Mal mit Google gesprochen hat.
// Scheiterte dieser erste Abruf, blieb genau das zurück, was niemand
// gebrauchen kann: eine Verbindung, die sich „Verbunden" nennt, ohne einen
// einzigen Kalender und ohne funktionierende Rechte. Der Nutzer sah eine
// Fehlermeldung und danach einen Bereich, der so tat, als sei alles in
// Ordnung.
//
// Deshalb ist das Anlegen einer Verbindung hier ein Vorgang mit zwei Ausgängen
// und ohne Zwischenzustand: entweder es gibt am Ende Kalender, oder es gibt
// keinen Zugang mehr. Und deshalb steht es in einem eigenen Modul statt in der
// Edge Function — so kann tools/googleSyncLogic.mjs beide Ausgänge wirklich
// durchspielen.

import { refreshCalendars } from './sync.js'
import { missingScopes } from './google.js'

// Warum es nicht geklappt hat, in der Sprache, in der die App es anzeigt.
export const CONNECT_OK = 'ok'
export const CONNECT_MISSING_SCOPES = 'rechte-fehlen'
export const CONNECT_NO_CALENDARS = 'kalender-fehler'

// Nimmt den Zugang wieder zurück. Termine werden dabei nie angefasst: an
// dieser Stelle kann es noch keine synchronisierten geben, und alles, was
// schon da war, gehört der App.
export async function rollbackConnection(store, userId) {
  await store.deleteCalendars(userId).catch(() => {})
  await store.deleteCredentials(userId).catch(() => {})
  await store.deleteConnection(userId).catch(() => {})
}

// `tokens` ist die Antwort von exchangeCode(), `identity` das, was im
// id_token stand. `makeClient` baut den Google-Client aus den gerade
// gespeicherten Zugangsdaten — als Funktion übergeben, weil die Edge Function
// dafür ihre eigenen Secrets braucht und dieses Modul keine kennen soll.
export async function completeConnection(
  { store, now = Date.now, makeClient },
  { userId, tokens, identity = {} }
) {
  // Erst gar nicht anfangen, wenn die Kalenderrechte fehlen. Google gibt auch
  // dann ein Token aus, wenn der Nutzer auf dem Zustimmungsbildschirm einzelne
  // Häkchen entfernt hat — nur die erteilten Scopes stehen in der Antwort.
  const missing = missingScopes(tokens.scopes)
  if (missing.length) {
    return { status: CONNECT_MISSING_SCOPES, missing }
  }

  await store.saveCredentials(userId, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type,
    scopes: tokens.scopes,
  })
  await store.upsertConnection(userId, {
    google_account_email: identity.email ?? null,
    google_account_sub: identity.sub ?? null,
    status: 'connected',
    scopes: tokens.scopes,
    last_error: null,
    last_sync_at: null,
    last_sync_status: null,
  })

  try {
    const google = await makeClient(userId)
    if (!google) throw new Error('Zugangsdaten konnten nicht gelesen werden.')

    const known = await store.listCalendars(userId)
    const { calendars } = await refreshCalendars(
      { google, store, now },
      { userId, firstConnection: known.length === 0 }
    )

    // Jedes Google-Konto hat mindestens einen Kalender. Eine leere Liste ist
    // deshalb kein „nichts zu tun", sondern ein Abruf, der nicht das geliefert
    // hat, was er sollte — und wird wie ein Fehler behandelt.
    if (!calendars.length) {
      throw new Error('Google hat keine Kalender zurückgegeben.')
    }

    return { status: CONNECT_OK, google, calendars }
  } catch (error) {
    await rollbackConnection(store, userId)
    return { status: CONNECT_NO_CALENDARS, error }
  }
}
