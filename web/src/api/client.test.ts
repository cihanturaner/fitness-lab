import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './client'

describe('api client', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('says plainly when the local server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const failure = await api.entry('w1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).message).toMatch(/could not be reached/)
  })

  it('reports a non-JSON error body by its status instead of a parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('Internal Server Error', { status: 500 }))))
    const failure = await api.entry('w1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).message).toMatch(/500/)
  })
})
