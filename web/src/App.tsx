import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
        className="press flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-sunken hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <span className={`size-1.5 rounded-full ${tone}`} aria-hidden />
        {summary}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 animate-in rounded-[14px] bg-popover p-3.5 text-[12px] leading-[18px] shadow-[var(--shadow-raised)] fade-in slide-in-from-top-1 duration-150">
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
  // Two plates on a bar, drawn white on an emerald tile: the product mark, not an icon glyph.
  return (
    <span className="flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-[0_1px_2px_rgb(15_63_48/0.3),inset_0_1px_0_rgb(255_255_255/0.18)]">
      <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
        <rect x="1" y="4" width="4" height="12" rx="1.5" fill="currentColor" />
        <rect x="15" y="4" width="4" height="12" rx="1.5" fill="currentColor" />
        <rect x="5" y="9" width="10" height="2" rx="1" fill="currentColor" opacity="0.7" />
      </svg>
    </span>
  )
}

const NAV: { label: string; href: string; routes: Route['name'][] }[] = [
  { label: 'Week', href: '#/', routes: ['home', 'workout'] },
  { label: 'Bodyweight', href: '#/bodyweight', routes: ['bodyweight'] },
  { label: 'Nutrition', href: '#/nutrition', routes: ['nutrition'] },
  { label: 'History', href: '#/history', routes: ['history', 'sessions'] },
  { label: 'Settings', href: '#/settings', routes: ['settings'] },
]

/** A pill navigation whose emerald indicator slides to the active screen. */
function MainNav({ active }: { active: Route['name'] }) {
  const list = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const current = NAV.findIndex((item) => item.routes.includes(active))

  useLayoutEffect(() => {
    const measure = () => {
      const link = list.current?.querySelector<HTMLElement>('[aria-current="page"]')
      setIndicator(link ? { left: link.offsetLeft, width: link.offsetWidth } : null)
    }
    measure()
    // Webfonts can change the pill widths after the first layout.
    void document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [current])

  return (
    <nav aria-label="Main" className="flex items-center">
      <div ref={list} className="relative flex items-center gap-0.5 rounded-full bg-sunken/80 p-1 shadow-[inset_0_0_0_1px_rgb(16_52_38/0.05)]">
        {indicator && (
          <span
            aria-hidden
            className="absolute top-1 bottom-1 rounded-full bg-gradient-to-b from-emerald-600 to-emerald-700 shadow-[0_1px_2px_rgb(15_63_48/0.3),0_6px_14px_-6px_rgb(27_104_79/0.6)] transition-[left,width] duration-300 ease-[var(--ease-out)]"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
        {NAV.map((item, index) => {
          const isActive = index === current
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`press relative z-10 flex h-8 items-center rounded-full px-3.5 text-[14px] font-medium transition-colors duration-200 ${
                isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              } ${isActive && !indicator ? 'bg-emerald-700' : ''}`}
            >
              {item.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

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
    <div className="flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-20 border-b border-white/60 bg-white/65 shadow-[0_1px_0_rgb(16_52_38/0.04),0_8px_24px_-18px_rgb(16_52_38/0.25)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 w-full max-w-[1360px] items-center gap-8 px-10">
          <a href="#/" className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em]">
            <Mark />
            Fitness Lab
          </a>
          <MainNav active={route.name} />
          <div className="ml-auto flex items-center gap-3">
            <span className="num text-[13px] font-medium text-muted-foreground">{formatShortDate(localDate())}</span>
            <SystemStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-10 pt-9 pb-20">
        <Screen route={route} />
      </main>
    </div>
  )
}
