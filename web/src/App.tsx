import { useEffect, useState } from 'react'
import { fetchHealth, fetchPingDb, type HealthResponse, type PingDbResponse } from '@/api/m0'
import { BodyweightScreen } from '@/features/bodyweight/BodyweightScreen'
import { EntryScreen } from '@/features/entry/EntryScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { SessionsScreen } from '@/features/history/SessionsScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { NutritionScreen } from '@/features/nutrition/NutritionScreen'
import { useRoute, type Route } from '@/lib/route'
import { installUnloadGuard } from '@/lib/unsaved'

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

const NAV: { label: string; href: string; routes: Route['name'][] }[] = [
  { label: 'Week', href: '#/', routes: ['home', 'workout'] },
  { label: 'Bodyweight', href: '#/bodyweight', routes: ['bodyweight'] },
  { label: 'Nutrition', href: '#/nutrition', routes: ['nutrition'] },
  { label: 'History', href: '#/history', routes: ['history', 'sessions'] },
]

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'workout':
      return <EntryScreen key={route.id} workoutId={route.id} />
    case 'bodyweight':
      return <BodyweightScreen />
    case 'nutrition':
      return <NutritionScreen />
    case 'history':
      return <HistoryScreen exerciseId={route.exerciseId} />
    case 'sessions':
      return <SessionsScreen />
    default:
      return <HomeScreen />
  }
}

export default function App() {
  const route = useRoute()
  useEffect(installUnloadGuard, [])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-11 max-w-[1600px] items-center gap-6 px-6">
          <a href="#/" className="text-[14px] font-semibold tracking-tight">
            fitness-lab
          </a>
          <nav aria-label="Main" className="flex gap-1 text-[13px]">
            {NAV.map((item) => {
              const active = item.routes.includes(route.name)
              return (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1 ${
                    active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.label}
                </a>
              )
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-4">
        <Screen route={route} />
      </main>
      <footer className="border-t border-border px-6 py-2 text-[11px] text-muted-foreground">
        <div className="mx-auto max-w-[1600px]">
          <SystemStatus />
        </div>
      </footer>
    </div>
  )
}
