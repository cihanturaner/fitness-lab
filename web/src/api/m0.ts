/** Typed client for the two M0 technical endpoints. */

export type HealthResponse = {
  status: string
  service: string
  version: string
}

export type PingDbResponse = {
  status: string
  source: string
  row_id: number
  token: string
  created_at: string
  sqlite_version: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`${path} responded with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health')
}

export function fetchPingDb(): Promise<PingDbResponse> {
  return getJson<PingDbResponse>('/api/ping-db')
}
