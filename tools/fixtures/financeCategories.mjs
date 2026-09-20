import { FINANCE_CATEGORIES } from '../../src/config/finance.js'

// Die Kategoriezeilen, wie die Datenbank sie nach 0014 hält — für die Tests.
//
// WARUM DAS EINE DATEI IST UND KEINE HANDATTRAPPE JE SUITE: seit v1.26
// entscheidet `parent_id`, ob eine Kategorie überhaupt zugeordnet werden darf.
// Eine Attrappe ohne `parent_id` beschreibt damit stillschweigend lauter
// Oberkategorien — und ein Test, der darauf grün wird, sagt nichts über den
// Bildschirm, der echte Zeilen bekommt. Also wird hier aus der ausgelieferten
// Taxonomie genau das gebaut, was `finance_apply_category_taxonomy` anlegt:
// Eltern mit `parent_id = null`, Kinder mit der id ihres Elternteils.
//
// Sie ist NICHT Teil der App — wie jede andere Datei unter tools/fixtures/.

/**
 * @param {{id?: (slug: string, index: number) => string, userId?: string|null}} options
 * @returns {Array<object>} Eltern vor Kindern, in Seed-Reihenfolge
 */
export function financeCategoryRows({ id = (slug) => `cat-${slug}`, userId = null } = {}) {
  const rows = FINANCE_CATEGORIES.map((category, index) => ({
    id: id(category.slug, index),
    ...(userId ? { user_id: userId } : {}),
    slug: category.slug,
    label: category.label,
    sort_order: category.sort_order,
    is_system: true,
    parent_id: null,
  }))
  const bySlug = new Map(rows.map((row) => [row.slug, row]))
  FINANCE_CATEGORIES.forEach((category, index) => {
    if (category.parent_slug) rows[index].parent_id = bySlug.get(category.parent_slug).id
  })
  return rows
}

/** Nur die Zeilen zu diesen Slugs — plus die Oberkategorien, die sie brauchen. */
export function financeCategorySubset(slugs, options = {}) {
  const all = financeCategoryRows(options)
  const wanted = new Set(slugs)
  const byId = new Map(all.map((row) => [row.id, row]))
  for (const row of all) {
    if (wanted.has(row.slug) && row.parent_id) wanted.add(byId.get(row.parent_id).slug)
  }
  return all.filter((row) => wanted.has(row.slug))
}
