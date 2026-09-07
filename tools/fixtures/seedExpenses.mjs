// Demo rows for the test harness only — they are NOT shipped with the app.
// tools/smoke.mjs feeds them to its stubbed Supabase backend, so an expense the
// smoke test sees on screen is an expense that came over the wire.
//
// Between them the four expenses cover every state the overview has to render:
// both input currencies, two different stored rates (so a currency switch has
// to convert each row with its own), and dates that exercise all three date
// labels — Heute, Gestern and a concrete date.
//
// The numbers are chosen to divide cleanly, so the expected totals are readable
// in the assertions rather than being a rounding artefact:
//
//   EUR:  3,30 + 288,00 + 120,00 +  22,50 =  433,80 €
//   AUD:  5,50 + 480,00 + 240,00 +  45,00 =  770,50 AU$

const day = (offset) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - offset)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export function seedExpenses() {
  return [
    {
      id: 'e1111111-1111-4111-8111-111111111111',
      title: 'Kaffee',
      original_amount: 5.5,
      original_currency: 'AUD',
      transaction_date: day(0),
      exchange_rate_aud_eur: 0.6,
      created_at: '2026-09-07T08:00:00.000Z',
    },
    {
      id: 'e2222222-2222-4222-8222-222222222222',
      title: 'Miete September',
      original_amount: 480,
      original_currency: 'AUD',
      transaction_date: day(1),
      exchange_rate_aud_eur: 0.6,
      created_at: '2026-09-06T09:00:00.000Z',
    },
    {
      // Paid from the German account, so it was entered in EUR — and it is the
      // row that proves the switch converts in both directions.
      id: 'e3333333-3333-4333-8333-333333333333',
      title: 'Flug nach Melbourne',
      original_amount: 120,
      original_currency: 'EUR',
      transaction_date: day(5),
      exchange_rate_aud_eur: 0.5,
      created_at: '2026-09-02T10:00:00.000Z',
    },
    {
      // Same currency as the first, a different stored rate: 45 AUD here are
      // 22,50 € while 5,50 AUD there are 3,30 €.
      id: 'e4444444-4444-4444-8444-444444444444',
      title: 'Surfbrett-Miete',
      original_amount: 45,
      original_currency: 'AUD',
      transaction_date: day(30),
      exchange_rate_aud_eur: 0.5,
      created_at: '2026-08-08T11:00:00.000Z',
    },
  ]
}
