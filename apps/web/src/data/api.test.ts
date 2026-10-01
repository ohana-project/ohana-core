import { createClient, type paths } from '@ohana/api-client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ohanaMemberMiddleware } from '@/data/api.ts'

/*
 * The X-Ohana-Member middleware (architecture.md, request lifecycle): the
 * active member is the default on every request, never an override. A
 * request that already names its member — a query pinned to one member's
 * cache key — keeps that name even when another member is active by the
 * time the request goes out. The real middleware runs through a real
 * client (baseUrl makes the URLs parseable under jsdom, where the app's
 * own relative client would rely on the browser's document origin); the
 * unit tests that mock the api module never exercise any of this.
 */

const FAMILY = '01900000-0000-7000-8000-000000000001'
const DACHA = '01900000-0000-7000-8000-000000000002'

describe('the X-Ohana-Member middleware', () => {
  const fetchMock = vi.fn()

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  function useFetch() {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  }

  function clientWithMiddleware() {
    const client = createClient<paths>({ baseUrl: 'http://ohana.local' })
    client.use(ohanaMemberMiddleware())
    return client
  }

  test('names the active member when the request carries no member', async () => {
    useFetch()
    window.localStorage.setItem('ohana.activeMember', FAMILY)

    await clientWithMiddleware().GET('/api/v1/me')

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get('x-ohana-member')).toBe(FAMILY)
  })

  test('keeps an explicit member over the active one', async () => {
    useFetch()
    window.localStorage.setItem('ohana.activeMember', DACHA)

    await clientWithMiddleware().GET('/api/v1/me/sessions', {
      params: { header: { 'x-ohana-member': FAMILY } },
    })

    const request = fetchMock.mock.calls[0]?.[0] as Request
    // A refetch racing a switch answers for the key's member, never for
    // whoever became active meanwhile.
    expect(request.headers.get('x-ohana-member')).toBe(FAMILY)
  })

  test('names no member when none is active and none is given', async () => {
    useFetch()

    await clientWithMiddleware().GET('/api/v1/me')

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get('x-ohana-member')).toBeNull()
  })
})
