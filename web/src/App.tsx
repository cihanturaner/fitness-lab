import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchHealth, fetchPingDb, type HealthResponse, type PingDbResponse } from '@/api/m0'

type Probe<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string }

const LOADING = { state: 'loading' } as const

function toProbe<T>(promise: Promise<T>): Promise<Probe<T>> {
  return promise.then(
    (data) => ({ state: 'ok', data }) as const,
    (error: unknown) =>
      ({ state: 'error', message: error instanceof Error ? error.message : String(error) }) as const,
  )
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId} className="font-mono text-foreground">
        {value}
      </span>
    </div>
  )
}

function StatusBadge({ probe }: { probe: Probe<unknown> }) {
  if (probe.state === 'loading') return <Badge variant="secondary">checking…</Badge>
  if (probe.state === 'error') return <Badge variant="destructive">failed</Badge>
  return <Badge>ok</Badge>
}

export default function App() {
  const [health, setHealth] = useState<Probe<HealthResponse>>(LOADING)
  const [pingDb, setPingDb] = useState<Probe<PingDbResponse>>(LOADING)

  const runChecks = useCallback(() => {
    void toProbe(fetchHealth()).then(setHealth)
    void toProbe(fetchPingDb()).then(setPingDb)
  }, [])

  const rerunChecks = useCallback(() => {
    setHealth(LOADING)
    setPingDb(LOADING)
    runChecks()
  }, [runChecks])

  useEffect(runChecks, [runChecks])

  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">fitness-lab</h1>
            <Badge variant="outline">M0 · walking skeleton</Badge>
          </div>
          <p className="text-muted-foreground">
            Technical feasibility page. It proves the React → FastAPI → SQLite chain runs
            end-to-end on this machine. No fitness features live here.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card data-testid="health-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>FastAPI health</CardTitle>
              <StatusBadge probe={health} />
            </CardHeader>
            <CardContent className="text-sm">
              {health.state === 'ok' ? (
                <>
                  <Row label="status" value={health.data.status} testId="health-status" />
                  <Row label="service" value={health.data.service} testId="health-service" />
                  <Row label="version" value={health.data.version} testId="health-version" />
                </>
              ) : (
                <p data-testid="health-message" className="font-mono text-muted-foreground">
                  {health.state === 'loading' ? 'loading…' : health.message}
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="db-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>SQLite round-trip</CardTitle>
              <StatusBadge probe={pingDb} />
            </CardHeader>
            <CardContent className="text-sm">
              {pingDb.state === 'ok' ? (
                <>
                  <Row label="source" value={pingDb.data.source} testId="db-source" />
                  <Row label="token" value={pingDb.data.token} testId="db-token" />
                  <Row label="sqlite" value={pingDb.data.sqlite_version} testId="db-version" />
                  <Row label="row created" value={pingDb.data.created_at} testId="db-created-at" />
                </>
              ) : (
                <p data-testid="db-message" className="font-mono text-muted-foreground">
                  {pingDb.state === 'loading' ? 'loading…' : pingDb.message}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Button onPress={rerunChecks}>Re-run checks</Button>
        </div>
      </div>
    </main>
  )
}
