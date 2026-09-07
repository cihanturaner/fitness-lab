import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const HEALTH = { status: 'ok', service: 'fitness-lab', version: '0.1.0' }
const PING_DB = {
  status: 'ok',
  source: 'sqlite',
  row_id: 1,
  token: 'sqlite-roundtrip-ok',
  created_at: '2026-09-07T19:08:24+00:00',
  sqlite_version: '3.53.4',
}

function mockApi(overrides: { health?: unknown; pingDb?: unknown; failPingDb?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/health')) {
      return new Response(JSON.stringify(overrides.health ?? HEALTH), { status: 200 })
    }
    if (url.endsWith('/api/ping-db')) {
      if (overrides.failPingDb) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify(overrides.pingDb ?? PING_DB), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('M0 page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders both the health and the SQLite-backed responses', async () => {
    mockApi()

    render(<App />)

    expect(await screen.findByTestId('health-status')).toHaveTextContent('ok')
    expect(screen.getByTestId('health-service')).toHaveTextContent('fitness-lab')
    expect(await screen.findByTestId('db-source')).toHaveTextContent('sqlite')
    expect(screen.getByTestId('db-token')).toHaveTextContent('sqlite-roundtrip-ok')
    expect(screen.getByTestId('db-version')).toHaveTextContent('3.53.4')
  })

  it('surfaces a failing endpoint instead of pretending it succeeded', async () => {
    mockApi({ failPingDb: true })

    render(<App />)

    expect(await screen.findByTestId('db-message')).toHaveTextContent('HTTP 500')
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('re-queries both endpoints when the button is pressed', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()

    render(<App />)
    await screen.findByTestId('db-token')
    const callsAfterMount = fetchMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Re-run checks' }))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 2))
  })
})
