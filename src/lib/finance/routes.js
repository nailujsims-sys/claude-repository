// Die Adressen der Finanz-Detailseiten (v1.27) — und wie ein Händler in eine
// Adresse passt.
//
// WARUM HIER KODIERT WIRD. Eine Kategorie hat immer eine UUID, die in jede
// Adresse passt. Ein Händler nicht unbedingt: die Auswertung kennt auch bloß
// benannte Händler, deren Schlüssel `name:<normalisierter Name>` heißt — und
// ein Name aus einem Kontoauszug darf alles enthalten, was eine Adresse
// zerbricht: „/" (ein weiteres Pfadsegment), „#" (die HashRouter-Grenze), „?"
// (der Beginn der Suchparameter), „%" (eine halbe Escape-Sequenz). Prozent-
// Kodierung allein reicht dafür nicht verlässlich, weil der Router je nach
// Version selbst noch einmal dekodiert und „%2F" dann doch wieder ein „/" ist.
//
// Deshalb eine eigene, eindeutige Form, die nur aus Zeichen besteht, die nie
// jemand dekodiert:
//
//   eine ID aus [A-Za-z0-9_-]   →  steht unverändert da   (die UUID von heute)
//   name:<…>                    →  n~<base64url(UTF-8)>
//   jede andere ID              →  k~<base64url(UTF-8)>
//
// „~" kommt in keiner unverändert übernommenen ID vor; damit ist jede Adresse
// genau einem Schlüssel zugeordnet, und zurück.
//
// Pur: kein React, kein Router. `btoa`/`atob` und TextEncoder gibt es im
// Browser und in Node.

export const FINANCE_ROUTES = Object.freeze({
  overview: '/finanzen',
  categories: '/finanzen/kategorien',
  merchants: '/finanzen/haendler',
  unassigned: '/finanzen/nicht-zugeordnet',
})

const SAFE_ID = /^[A-Za-z0-9_-]+$/

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value) {
  try {
    const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Ein Händlerschlüssel als Pfadsegment.
 *
 * @param {string} key  `merchantKey` aus resolveAnalyticsEntries
 * @returns {string}
 */
export function encodeMerchantKey(key) {
  const value = String(key ?? '')
  if (value.startsWith('name:')) return `n~${toBase64Url(value.slice(5))}`
  if (SAFE_ID.test(value)) return value
  return `k~${toBase64Url(value)}`
}

/**
 * Ein Pfadsegment zurück zum Händlerschlüssel — oder null, wenn es keiner ist.
 *
 * @param {string} segment
 * @returns {string|null}
 */
export function decodeMerchantKey(segment) {
  const value = String(segment ?? '')
  if (value.startsWith('n~')) {
    const name = fromBase64Url(value.slice(2))
    return name ? `name:${name}` : null
  }
  if (value.startsWith('k~')) return fromBase64Url(value.slice(2))
  return SAFE_ID.test(value) ? value : null
}

/** Die Adresse einer Kategorie (Ober- oder Unterkategorie, dieselbe Route). */
export const categoryRoute = (categoryId) =>
  `${FINANCE_ROUTES.categories}/${encodeURIComponent(String(categoryId ?? ''))}`

/** Die Adresse eines Händlers. */
export const merchantRoute = (merchantKey) =>
  `${FINANCE_ROUTES.merchants}/${encodeMerchantKey(merchantKey)}`
