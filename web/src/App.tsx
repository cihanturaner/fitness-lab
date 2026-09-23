import { useEffect, useState } from 'react'
import { fetchHealth, fetchPingDb, type HealthResponse, type PingDbResponse } from '@/api/m0'
import { EntryScreen } from '@/features/entry/EntryScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { useRoute } from '@/lib/route'

type SystemState =
  | { state: 'checking' }
  | { state: 'ok'; health: HealthResponse; db: PingDbResponse }
  | { state: 'error'; message: string }

function SystemStatus() {
  const [system, setSystem] = useState<SystemState>({ state: 'checking' })

  useEffect(() => {
    let live = true
    Promise.all([fetchHealth(), fetchPingDb()]).then(
      ([health, db]) => live && setSystem({ state: 'ok', health, db }),
      (error: unknown) =>
        live &&
        setSystem({ state: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      live = false
    }
  }, [])

  if (system.state === 'checking') return <span>Checking the local server…</span>
  if (system.state === 'error') {
    return <span className="text-destructive">Local server unreachable: {system.message}</span>
  }
  return (
    <span className="num">
      Local server <span data-testid="health-status">{system.health.status}</span>, version{' '}
      <span data-testid="health-version">{system.health.version}</span>. Database{' '}
      <span data-testid="db-source">{system.db.source}</span>{' '}
      <span data-testid="db-version">{system.db.sqlite_version}</span>, on this machine only.
    </span>
  )
}

export default function App() {
  const route = useRoute()

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-6 px-6">
          <a href="#/" className="text-[15px] font-semibold tracking-tight">
            fitness-lab
          </a>
          <nav className="text-sm text-muted-foreground">
            <a href="#/" className="hover:text-foreground">
              Program
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8">
        {route.name === 'workout' ? <EntryScreen key={route.id} workoutId={route.id} /> : <HomeScreen />}
      </main>
      <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        <div className="mx-auto max-w-[1440px]">
          <SystemStatus />
        </div>
      </footer>
    </div>
  )
}
