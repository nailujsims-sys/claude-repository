// Demo rows for the test harness only — they are NOT shipped with the app.
// tools/smoke.mjs feeds them to its stubbed Supabase backend, so a list the
// smoke test sees on screen is a list that came over the wire.
//
// Between them the four lists cover every state a screen has to render: all
// three templates, a pinned list, an archived one, entries with and without a
// category, and both sides of the open/done split.

export const LIST_IDS = {
  shopping: 'aaaaaaaa-1111-4111-8111-111111111111',
  standard: 'bbbbbbbb-2222-4222-8222-222222222222',
  money: 'cccccccc-3333-4333-8333-333333333333',
  archived: 'dddddddd-4444-4444-8444-444444444444',
}

export function seedLists() {
  return [
    {
      id: LIST_IDS.shopping,
      name: 'Einkauf',
      template: 'shopping',
      icon: 'shopping-cart',
      is_pinned: true,
      sort_order: 0,
    },
    {
      id: LIST_IDS.money,
      name: 'Geld bekommen',
      template: 'money',
      icon: 'user',
      is_pinned: true,
      sort_order: 1,
    },
    {
      id: LIST_IDS.standard,
      name: 'Von zuhause mitbringen',
      template: 'standard',
      icon: 'clipboard-list',
      sort_order: 2,
    },
    {
      id: LIST_IDS.archived,
      name: 'Urlaub 2026',
      template: 'standard',
      icon: 'palmtree',
      is_archived: true,
      archived_at: '2026-08-18T09:00:00.000Z',
      sort_order: 3,
    },
  ]
}

export function seedListItems() {
  const rows = [
    // Einkauf — two categories plus one uncategorised, and one already ticked.
    { list_id: LIST_IDS.shopping, title: 'Äpfel', quantity: 6, unit: 'Stück', category: 'Obst & Gemüse' },
    { list_id: LIST_IDS.shopping, title: 'Milch', quantity: 2, category: 'Milchprodukte' },
    { list_id: LIST_IDS.shopping, title: 'Brot', quantity: 1 },
    {
      list_id: LIST_IDS.shopping,
      title: 'Tomaten',
      quantity: 500,
      unit: 'g',
      category: 'Obst & Gemüse',
      is_done: true,
      done_at: '2026-09-01T10:00:00.000Z',
    },

    // Geld — two open amounts and one settled.
    { list_id: LIST_IDS.money, title: 'Max Mustermann', amount: 25 },
    { list_id: LIST_IDS.money, title: 'Paul Schneider', amount: 12.5 },
    {
      list_id: LIST_IDS.money,
      title: 'Jonas Weber',
      amount: 15,
      is_done: true,
      done_at: '2026-08-31T18:00:00.000Z',
    },

    // Standard — plain entries, one of them done.
    { list_id: LIST_IDS.standard, title: 'Ladekabel' },
    { list_id: LIST_IDS.standard, title: 'Reisepass' },
    { list_id: LIST_IDS.standard, title: 'Zahnbürste' },
    {
      list_id: LIST_IDS.standard,
      title: 'Sonnenbrille',
      is_done: true,
      done_at: '2026-08-30T12:00:00.000Z',
    },

    // The archived list keeps its entries — that is what makes reactivating it
    // give back exactly what was there.
    { list_id: LIST_IDS.archived, title: 'Hotel buchen', is_done: true, done_at: '2026-08-17T09:00:00.000Z' },
    { list_id: LIST_IDS.archived, title: 'Koffer packen' },
  ]

  // sort_order runs per list, the way the app writes it.
  const counters = {}
  return rows.map((row) => {
    counters[row.list_id] = (counters[row.list_id] ?? -1) + 1
    return { ...row, sort_order: counters[row.list_id] }
  })
}
