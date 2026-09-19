// Händlerlogos — die Liste, und warum sie leer ist.
//
// KEIN LOGO-DIENST. Ein Aufruf an clearbit.com/logo/rewe.de oder einen anderen
// Dienst wäre eine Zeile Code und der Moment, in dem diese App anfängt, die
// Einkaufsgewohnheiten ihres Nutzers an Dritte zu melden: jede Anfrage trägt
// den Händlernamen, die IP und den Zeitpunkt. Das Finanzmodul ist die
// persönlichste Datenlage der App (0008), und eine Abkürzung für ein 32 Pixel
// großes Bildchen ist es nicht wert.
//
// ALSO LOKAL ODER GAR NICHT. Hier stehen Logos, die im Repository liegen — und
// heute steht hier keines: Markenlogos sind fremde Marken, und sie ohne
// geklärte Lizenz einzuchecken wäre der zweite Fehler nach dem ersten. Die
// Infrastruktur ist trotzdem fertig, damit ein einzelnes Logo später eine Zeile
// ist und keine Umbauaktion: Datei nach `src/assets/merchants/` legen,
// importieren, Schlüssel eintragen.
//
// DER SCHLÜSSEL IST DER NORMALISIERTE NAME, nicht die Händler-ID: dieselbe
// Marke hat bei zwei Nutzern zwei IDs, aber denselben Namen, und ein Logo, das
// an einer ID hängt, wäre für jeden neuen Nutzer wieder weg.
//
// Bis dahin gilt die zweite Stufe: Initialen (src/components/MerchantAvatar.jsx).

/** @type {Record<string, {src: string, alt: string, background?: string}>} */
export const MERCHANT_LOGOS = Object.freeze({})

/** Der Schlüssel, unter dem ein Händlername nachgeschlagen wird. */
export const merchantLogoKey = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

/** Das hinterlegte Logo eines Händlers — oder null. */
export const merchantLogo = (name) => MERCHANT_LOGOS[merchantLogoKey(name)] ?? null

/**
 * Bis zu zwei Buchstaben, die den Namen wiedererkennbar machen.
 *
 * „Deutsche Bahn" → DB, „REWE" → RE, „dm" → DM. Ziffern und Zeichen fliegen
 * raus, damit aus „24/7 Shop" kein „24" wird.
 */
export function merchantInitials(name) {
  const cleaned = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
  if (cleaned === '') return '?'
  const words = cleaned.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (words.length === 0) return cleaned.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
