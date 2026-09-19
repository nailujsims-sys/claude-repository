import { FINANCE_CATEGORY_ICONS, categoryLabel } from '../../config/finance'

// Die Kategoriehierarchie, gelesen aus den Zeilen der Datenbank.
//
// EINE QUELLE, NICHT ZWEI. `src/config/finance.js` beschreibt die Taxonomie,
// die die App ausliefert; diese Datei beantwortet Fragen über die Taxonomie,
// die dieser Benutzer WIRKLICH hat — inklusive der Kategorien, die er sich
// selbst angelegt oder umbenannt hat. Deshalb bekommt jede Funktion hier die
// `finance_categories`-Zeilen übergeben und nicht die ausgelieferte Liste; die
// Konfiguration ist nur der Rückfall für ein Label, zu dem keine Zeile vorliegt.
//
// ZWEI EBENEN, und was daraus folgt: `parent_id is null` ist eine
// Oberkategorie, alles andere ist ein Blatt. Ein Blatt ist zuordenbar, eine
// Oberkategorie ist eine Überschrift — 0014 setzt das in der Datenbank durch,
// und jede Auswahl im Client liest `assignableCategories`, damit eine
// Überschrift gar nicht erst angeboten wird.
//
// Pur: kein React, kein Supabase.

/** Ist das eine Oberkategorie? */
export const isParentCategory = (category) =>
  Boolean(category) && (category.parent_id ?? null) === null

/** Ist das eine zuordenbare Unterkategorie? */
export const isAssignableCategory = (category) =>
  Boolean(category) && (category.parent_id ?? null) !== null

const bySortOrder = (a, b) =>
  (a?.sort_order ?? 0) - (b?.sort_order ?? 0) ||
  String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'de')

/**
 * Die Kategorien, die einer Buchung zugeordnet werden dürfen — sortiert wie sie
 * in einem Picker stehen sollen: nach Oberkategorie, darin nach Sortierung.
 *
 * @param {Array<object>} categories
 * @returns {Array<object>}
 */
export function assignableCategories(categories = []) {
  const parents = new Map(categories.filter(isParentCategory).map((c) => [c.id, c]))
  return categories
    .filter(isAssignableCategory)
    .slice()
    .sort((a, b) => {
      const pa = parents.get(a.parent_id)
      const pb = parents.get(b.parent_id)
      if (pa && pb && pa.id !== pb.id) return bySortOrder(pa, pb)
      return bySortOrder(a, b)
    })
}

/**
 * Die Hierarchie als Baum: jede Oberkategorie mit ihren Kindern.
 *
 * Eine Oberkategorie ohne Kinder bleibt drin — sie ist real, sie ist nur leer,
 * und sie wegzulassen hieße, dem Nutzer eine Zeile zu verschweigen, die in
 * seiner Datenbank steht.
 *
 * @param {Array<object>} categories
 * @returns {Array<{parent: object, children: Array<object>}>}
 */
export function categoryTree(categories = []) {
  const parents = categories.filter(isParentCategory).slice().sort(bySortOrder)
  const children = categories.filter(isAssignableCategory)
  return parents.map((parent) => ({
    parent,
    children: children.filter((c) => c.parent_id === parent.id).sort(bySortOrder),
  }))
}

/**
 * Kategorie-Zeilen nach id, für die heiße Schleife der Auswertung.
 *
 * @param {Array<object>} categories
 * @returns {Map<string, object>}
 */
export const categoriesById = (categories = []) =>
  new Map(categories.filter((c) => c?.id).map((c) => [c.id, c]))

/**
 * Der Weg einer Kategorie: „Essen & Trinken · Lebensmittel".
 *
 * Für eine Oberkategorie ist `child` null — die Antwort bleibt ehrlich, statt
 * die Überschrift zweimal auszugeben. Für eine Kategorie, deren Oberkategorie
 * nicht mitgeladen wurde, bleibt `parent` null; es wird keine erfunden.
 *
 * @param {Array<object>|Map<string, object>} categories
 * @param {string|null} categoryId
 * @returns {{parent: object|null, child: object|null, labels: string[], label: string}}
 */
export function categoryPath(categories, categoryId) {
  const byId = categories instanceof Map ? categories : categoriesById(categories)
  const category = categoryId ? byId.get(categoryId) ?? null : null
  if (!category) return { parent: null, child: null, labels: [], label: '' }

  if (isParentCategory(category)) {
    const label = category.label ?? categoryLabel(category.slug)
    return { parent: category, child: null, labels: [label], label }
  }

  const parent = byId.get(category.parent_id) ?? null
  const childLabel = category.label ?? categoryLabel(category.slug)
  const parentLabel = parent ? parent.label ?? categoryLabel(parent.slug) : null
  const labels = parentLabel ? [parentLabel, childLabel] : [childLabel]
  return { parent, child: category, labels, label: labels.join(' · ') }
}

/**
 * Die Oberkategorie, unter der ein Betrag verbucht wird.
 *
 * Eine Unterkategorie zählt bei ihrem Elternteil; eine Oberkategorie zählt bei
 * sich selbst (es gibt sie als Zuordnung nicht, aber eine Auswertung über alte
 * Daten darf daran nicht scheitern); alles andere ist „nicht zugeordnet" und
 * bekommt bewusst KEINE erfundene Kategorie.
 *
 * @param {Map<string, object>} byId
 * @param {string|null} categoryId
 * @returns {object|null}
 */
export function parentCategoryOf(byId, categoryId) {
  const category = categoryId ? byId.get(categoryId) ?? null : null
  if (!category) return null
  if (isParentCategory(category)) return category
  return byId.get(category.parent_id) ?? null
}

/** Der Icon-Name einer Oberkategorie — siehe src/components/CategoryIcon.jsx. */
export const categoryIconName = (slug) => FINANCE_CATEGORY_ICONS[slug] ?? null
