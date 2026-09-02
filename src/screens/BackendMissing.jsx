import { DatabaseZap } from 'lucide-react'

// The build has no Supabase project, so there is nowhere safe to put personal
// data. The app says so and stops — it does not quietly open a second, private
// database in this browser, which is exactly what the old localStorage
// fallback did and why the same tasks never showed up on the next device.
export default function BackendMissing() {
  return (
    <div className="flex min-h-screen flex-col justify-center px-6">
      <div className="rounded-card border border-subtle bg-bg-card p-6">
        <div className="grid h-12 w-12 place-items-center rounded-btn bg-danger/10 text-danger">
          <DatabaseZap size={22} />
        </div>
        <h1 className="mt-4 text-section font-bold text-text-primary">Keine Datenbank verbunden</h1>
        <p className="mt-2 text-ui leading-relaxed text-text-secondary">
          Diese Version wurde ohne Zugang zur Datenbank gebaut. Damit deine Aufgaben und Termine
          nicht nur auf diesem Gerät liegen, speichert die App hier bewusst nichts.
        </p>
        <div className="mt-5 rounded-btn bg-bg-elevated p-4">
          <p className="text-label font-semibold text-text-primary">Was fehlt</p>
          <ul className="mt-2 space-y-1 text-label text-text-secondary">
            <li className="font-mono">VITE_SUPABASE_URL</li>
            <li className="font-mono">VITE_SUPABASE_ANON_KEY</li>
          </ul>
          <p className="mt-3 text-caption leading-relaxed text-text-muted">
            Beide Werte sind öffentlich und gehören als Repository-Variablen in den Build
            (Settings → Secrets and variables → Actions → Variables), lokal in die Datei{' '}
            <span className="font-mono">.env</span>. Details in{' '}
            <span className="font-mono">supabase/README.md</span>.
          </p>
        </div>
      </div>
    </div>
  )
}
