import { listTemplate } from '../config/listTemplates'

// Reading what the user typed into the one-line add field.
//
// Pure, and deliberately small. The point of this file is §6 of the brief:
// adding an ordinary article must be fast, and the extra fields must still be
// reachable without a form per entry. So the add field reads a trailing
// quantity or amount when the text clearly carries one, and the entry sheet
// stays there for everything else — including correcting a reading, which is
// why nothing here is allowed to be clever: whatever it decides is visible in
// the row the moment it is created, and editable in two taps.
//
// A Standard list parses nothing at all. "Kapitel 2 lesen" is an entry titled
// "Kapitel 2 lesen", not an entry with a quantity.

// German-style numbers throughout, the way the rest of the app writes them:
// "25,00" and "25.00" both mean the same, and both come back as 25.
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/\s/g, '')
  if (!text) return null
  // One separator only, and the last one wins as the decimal point — so
  // "1.250,50" and "1250,5" both read correctly and "1.250" stays 1250.
  const normalised = text.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null
  const value = Number(normalised)
  return Number.isFinite(value) ? value : null
}

// Trailing separators a person types between a name and its number — "Max –
// 25", "Äpfel: 6". Removed from the title, never from anywhere else.
const TRAILING_SEPARATOR = /[\s–—\-:,]+$/

function cleanTitle(raw) {
  return raw.replace(TRAILING_SEPARATOR, '').trim()
}

// "Äpfel 6 Stück" → { title: 'Äpfel', quantity: 6, unit: 'Stück' }
// "Tomaten 500 g" → { title: 'Tomaten', quantity: 500, unit: 'g' }
// "Milch 2"       → { title: 'Milch',   quantity: 2,   unit: null }
// "Brot"          → { title: 'Brot',    quantity: null, unit: null }
const SHOPPING = /^(.*?)[\s–—\-:]+(\d+(?:[.,]\d+)?)\s*([\p{L}]{1,12})?$/u

// "Max Mustermann 25,00 €" → { title: 'Max Mustermann', amount: 25 }
// "Anna 40€"               → { title: 'Anna',           amount: 40 }
// "Paul"                   → { title: 'Paul',           amount: null }
const MONEY = /^(.*?)[\s–—\-:]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?$/iu

/**
 * Turn one line of typed text into the fields of a new entry.
 *
 * Always returns a usable `title`: when nothing matches — and when a match
 * would leave the title empty, as in a line that is nothing but a number — the
 * whole text is the title and no extra field is set. Typing "42" into a
 * shopping list creates an entry called "42", which is what was asked for.
 */
export function parseQuickAdd(template, text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  const { fields } = listTemplate(template)

  if (fields.includes('amount')) {
    const match = MONEY.exec(raw)
    const title = match ? cleanTitle(match[1]) : ''
    const amount = match ? parseNumber(match[2]) : null
    if (title && amount !== null) return { title, amount }
    return { title: raw, amount: null }
  }

  if (fields.includes('quantity')) {
    const match = SHOPPING.exec(raw)
    const title = match ? cleanTitle(match[1]) : ''
    const quantity = match ? parseNumber(match[2]) : null
    if (title && quantity !== null) {
      return { title, quantity, unit: match[3] ? match[3].trim() : null }
    }
    return { title: raw, quantity: null, unit: null }
  }

  return { title: raw }
}

// The inverse, for the entry sheet's number fields: a stored value shown the
// way it will be typed back in.
export function numberToInput(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return String(number).replace('.', ',')
}
