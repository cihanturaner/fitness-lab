import { useEffect, useRef, useState } from 'react'
import { fetchHealth, fetchPingDb, type HealthResponse, type PingDbResponse } from '@/api/m0'
import { BodyweightScreen } from '@/features/bodyweight/BodyweightScreen'
import { EntryScreen } from '@/features/entry/EntryScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { SessionsScreen } from '@/features/history/SessionsScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { NutritionScreen } from '@/features/nutrition/NutritionScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { formatShortDate, localDate } from '@/lib/format'
import { useRoute, type Route } from '@/lib/route'
import { installUnloadGuard } from '@/lib/unsaved'

type SystemState =
  | { state: 'checking' }
  | { state: 'ok'; health: HealthResponse; db: PingDbResponse }
  | { state: 'error'; message: string }

function SystemStatus() {
  const [system, setSystem] = useState<SystemState>({ state: 'checking' })
  const panel = useRef<HTMLDetailsElement>(null)

  // A popover closes when the lifter clicks elsewhere or presses Escape.
  useEffect(() => {
    const close = (event: Event) => {
      const details = panel.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !details.contains(event.target as Node)) {
        details.open = false
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

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

  const tone =
    system.state === 'ok' ? 'bg-ok' : system.state === 'error' ? 'bg-destructive' : 'bg-faint animate-pulse'
  const summary = system.state === 'error' ? 'Offline' : 'Local'
  return (
    // A native disclosure: the diagnostics stay in the DOM (and in reach of a screen reader)
    // while closed, and never take permanent space on the page.
    <details ref={panel} className="group relative">
      <summary
        aria-label="Local server status"
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-sunken hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <span className={`size-1.5 rounded-full ${tone}`} aria-hidden />
        {summary}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 animate-in rounded-lg border border-border bg-popover p-3 text-[12px] leading-[18px] shadow-[0_8px_24px_-8px_rgb(22_25_28/0.18)] fade-in slide-in-from-top-1 duration-150">
        {system.state === 'checking' && <p className="text-muted-foreground">Checking the local server…</p>}
        {system.state === 'error' && (
          <p className="text-destructive">Local server unreachable: {system.message}</p>
        )}
        {system.state === 'ok' && (
          <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Server</dt>
            <dd data-testid="health-status">{system.health.status}</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd data-testid="health-version">{system.health.version}</dd>
            <dt className="text-muted-foreground">Database</dt>
            <dd>
              <span data-testid="db-source">{system.db.source}</span>{' '}
              <span data-testid="db-version">{system.db.sqlite_version}</span>
            </dd>
          </dl>
        )}
        <p className="mt-2 border-t border-border pt-2 text-muted-foreground">
          Runs on this machine only. Nothing leaves it.
        </p>
      </div>
    </details>
  )
}

function Mark() {
  // Two plates on a bar: the product mark, drawn, not an icon-font glyph.
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      <rect x="1" y="4" width="4" height="12" rx="1.5" fill="currentColor" />
      <rect x="15" y="4" width="4" height="12" rx="1.5" fill="currentColor" />
      <rect x="5" y="9" width="10" height="2" rx="1" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

const NAV: { label: string; href: string; routes: Route['name'][] }[] = [
  { label: 'Week', href: '#/', routes: ['home', 'workout'] },
  { label: 'Bodyweight', href: '#/bodyweight', routes: ['bodyweight'] },
  { label: 'Nutrition', href: '#/nutrition', routes: ['nutrition'] },
  { label: 'History', href: '#/history', routes: ['history', 'sessions'] },
  { label: 'Settings', href: '#/settings', routes: ['settings'] },
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
    case 'settings':
      return <SettingsScreen />
    default:
      return <HomeScreen key={route.week ?? 'current'} week={route.week} />
  }
}

export default function App() {
  const route = useRoute()
  useEffect(installUnloadGuard, [])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-[1360px] items-stretch gap-10 px-10">
          <a href="#/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            <Mark />
            Fitness Lab
          </a>
          <nav aria-label="Main" className="flex items-stretch gap-1">
            {NAV.map((item) => {
              const active = item.routes.includes(route.name)
              return (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center px-3 text-[14px] font-medium transition-colors ${
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-foreground transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                  />
                </a>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="num text-[13px] text-muted-foreground">{formatShortDate(localDate())}</span>
            <SystemStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-10 pt-8 pb-16">
        <Screen route={route} />
      </main>
    </div>
  )
}
