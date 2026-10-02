import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot } from '@/data/local-store.ts'
import { onMemberRefused, triggerSync } from '@/data/sync-engine.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import {
  forgetMember,
  memberSessionQueryKey,
  useMemberSessionStatus,
  useMemberSyncActive,
  useRedeemedSignIn,
} from './use-member-session.ts'
import { useSyncLifecycle } from './use-synced-space.ts'

const ME = {
  member: {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Аня',
    role: 'owner' as const,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
  needsOnboarding: false,
}

vi.mock('@/data/api.ts', () => ({ api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } }))

/*
 * Adding a sign-in is a cache-boundary event (ADR-0005): another member's
 * sign-in must leave no cached answer of the previous member in place,
 * while the same member's extra device session only refreshes the probe.
 * The probe captures the providers' query client so the test can seed,
 * inspect, and invalidate the cache directly; useRedeemedSignIn itself
 * never calls the API.
 */

const SPACE = { id: 's-1', name: 'Наша семья' }
const PROFILES_KEY = ['member', 'm-1', 'profiles'] as const
const PROFILES = [{ id: 'm-1', name: 'Аня' }]

let probeClient: ReturnType<typeof useQueryClient> | undefined

function client(): ReturnType<typeof useQueryClient> {
  if (probeClient === undefined) throw new Error('The probe never mounted')
  return probeClient
}

function SignInProbe({ member }: { member: { id: string; name: string } }) {
  const signIn = useRedeemedSignIn()
  probeClient = useQueryClient()
  return (
    <button type="button" onClick={() => void signIn(member, SPACE)}>
      sign-in
    </button>
  )
}

describe('useRedeemedSignIn cache boundaries', () => {
  beforeEach(() => {
    window.localStorage.clear()
    probeClient = undefined
  })

  it('wipes the previous member’s cached answers when another member signs in', async () => {
    window.localStorage.setItem('ohana.activeMember', 'm-1')
    const user = userEvent.setup()
    renderWithProviders(<SignInProbe member={{ id: 'm-2', name: 'Аня' }} />)

    client().setQueryData(PROFILES_KEY, PROFILES)
    expect(client().getQueryData(PROFILES_KEY)).toEqual(PROFILES)
    await user.click(screen.getByRole('button', { name: 'sign-in' }))

    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBe('m-2'))
    expect(client().getQueryData(PROFILES_KEY)).toBeUndefined()
  })

  it('keeps member-scoped data and refreshes the probe when the same member signs in again', async () => {
    window.localStorage.setItem('ohana.activeMember', 'm-1')
    const user = userEvent.setup()
    renderWithProviders(<SignInProbe member={{ id: 'm-1', name: 'Аня' }} />)

    client().setQueryData(PROFILES_KEY, PROFILES)
    client().setQueryData(memberSessionQueryKey, { status: 'signed-in' })
    await user.click(screen.getByRole('button', { name: 'sign-in' }))

    await vi.waitFor(() =>
      expect(client().getQueryState(memberSessionQueryKey)?.isInvalidated).toBe(true),
    )
    expect(client().getQueryData(PROFILES_KEY)).toEqual(PROFILES)
  })
})

describe('forgetMember', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clears the departing member’s data and resets everything else', () => {
    const queryClient = new QueryClient()
    const profilesOf = (memberId: string) => ['member', memberId, 'profiles'] as const
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([{ memberId: 'm-1', spaceId: 's-1', spaceName: 'С', name: 'Аня' }]),
    )
    queryClient.setQueryData(profilesOf('m-1'), [{ id: 'm-1' }])
    queryClient.setQueryData(profilesOf('m-2'), [{ id: 'm-2' }])
    queryClient.setQueryData(memberSessionQueryKey, { status: 'signed-in' })

    // The photo previews are the one cached API response (issue #17): the
    // sign-out deletes their cache whole.
    const deleteCache = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('caches', { delete: deleteCache, open: vi.fn() })

    forgetMember(queryClient, 'm-1')

    // The forgotten member's answers are cleared outright.
    expect(queryClient.getQueryData(profilesOf('m-1'))).toBeUndefined()
    expect(window.localStorage.getItem('ohana.sessions')).toBe('[]')
    // Everything else is reset for whoever is active now: no cached answer
    // survives the boundary.
    expect(queryClient.getQueryData(memberSessionQueryKey)).toBeUndefined()
    expect(queryClient.getQueryData(profilesOf('m-2'))).toBeUndefined()
    expect(deleteCache).toHaveBeenCalledWith('journal-photos')
    vi.unstubAllGlobals()
  })
})

describe('the member session probe', () => {
  const MEMBER = '01900000-0000-7000-8000-000000000001'
  const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
  const apiGet = vi.mocked(api.GET)

  const STORED = {
    revision: '7',
    changes: [
      {
        entity: 'space' as const,
        space: {
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      {
        entity: 'member' as const,
        member: {
          id: MEMBER,
          name: 'Аня',
          role: 'owner' as const,
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      },
    ],
    tombstones: [],
  }

  function SessionProbe() {
    const session = useMemberSessionStatus()
    probeClient = useQueryClient()
    // The gate carries the sync lifecycle beside the probe in the real
    // route; the tests exercise them together through the same predicate.
    useSyncLifecycle(useMemberSyncActive())
    return <span data-testid="session">{JSON.stringify(session)}</span>
  }

  function seedRegistry() {
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([
        { memberId: MEMBER, spaceId: SPACE_ID, spaceName: 'Наша семья', name: 'Аня' },
      ]),
    )
    window.localStorage.setItem('ohana.activeMember', MEMBER)
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    window.localStorage.clear()
    probeClient = undefined
    vi.clearAllMocks()
  })

  it('reads on from the local store when the server is unavailable (5xx)', async () => {
    seedRegistry()
    await applySyncResult(MEMBER, STORED)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unexpected', message: 'Bad gateway' } },
      response: new Response(null, { status: 503 }),
    })

    renderWithProviders(<SessionProbe />)

    await vi.waitFor(() => {
      const session = JSON.parse(screen.getByTestId('session').textContent ?? 'null') as Record<
        string,
        unknown
      >
      expect(session.status).toBe('signed-in')
    })
  })

  it('reads on from the local store when the request never reaches the API', async () => {
    seedRegistry()
    await applySyncResult(MEMBER, STORED)
    apiGet.mockRejectedValue(new TypeError('Network request failed'))

    renderWithProviders(<SessionProbe />)

    await vi.waitFor(() => {
      const session = JSON.parse(screen.getByTestId('session').textContent ?? 'null') as Record<
        string,
        unknown
      >
      expect(session.status).toBe('signed-in')
    })
  })

  it('forgets the member and their partition when the API refuses the session', async () => {
    seedRegistry()
    await applySyncResult(MEMBER, STORED)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'A member session is required' } },
      response: new Response(null, { status: 401 }),
    })

    renderWithProviders(<SessionProbe />)

    await vi.waitFor(() => {
      const session = JSON.parse(screen.getByTestId('session').textContent ?? 'null') as Record<
        string,
        unknown
      >
      expect(session.status).toBe('signed-out')
    })
    // The refused sign-in does not linger: the registry entry and the
    // synchronised partition are gone, so an offline open cannot resurrect
    // the space (issue #14).
    expect(window.localStorage.getItem('ohana.activeMember')).toBeNull()
    const snapshot = await readMemberSnapshot(MEMBER)
    expect(snapshot.revision).toBeUndefined()
  })

  it('a sign-out forgets a sync in flight, so its answer is never applied', async () => {
    seedRegistry()
    const stale = { ...STORED, revision: '5' }
    await applySyncResult(MEMBER, stale)
    let releaseRequest: (() => void) | undefined
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    let sessionRevoked = false
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        if (sessionRevoked) {
          return {
            data: undefined,
            error: { error: { code: 'unauthorized', message: 'A member session is required' } },
            response: new Response(null, { status: 401 }),
          }
        }
        return { data: ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') {
        await request
        return { data: STORED, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<SessionProbe />)
    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
        params: { query: { since: '5' }, header: { 'x-ohana-member': MEMBER } },
      }),
    )

    // The member signs out while the sync request is in the air: the
    // forget bumps the engine's generation, so the answer of a departed
    // member is never written back.
    forgetMember(client(), MEMBER)
    sessionRevoked = true
    releaseRequest?.()
    // The registry entry is gone at once; the probe, reset in place, waits
    // on the spinner path until it is observed again.
    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBeNull())
    // Let the released request's microtasks play out: a macrotask runs
    // only after every pending microtask, so the run's continuation has
    // fully settled before the partition is read. The answer of the
    // departed member must never resurrect the deleted one.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const snapshot = await readMemberSnapshot(MEMBER)
    expect(snapshot.revision).toBeUndefined()
    expect(snapshot.members).toEqual([])
  })

  it('the root listener cleans up a refusal with no session hook mounted', async () => {
    seedRegistry()
    await applySyncResult(MEMBER, STORED)
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/sync') {
        return {
          data: undefined,
          error: { error: { code: 'unauthorized', message: 'A member session is required' } },
          response: new Response(null, { status: 401 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    // No probe, no gate — only the providers with their root listener and
    // a screen that holds the query client (issue #14: the cleanup runs no
    // matter which screen is open).
    function ClientOnly() {
      probeClient = useQueryClient()
      return null
    }
    renderWithProviders(<ClientOnly />)
    client().setQueryData(['member', MEMBER, 'profiles'], [{ id: MEMBER }])

    await triggerSync(MEMBER)

    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBeNull())
    expect(client().getQueryData(['member', MEMBER, 'profiles'])).toBeUndefined()
    const snapshot = await readMemberSnapshot(MEMBER)
    expect(snapshot.revision).toBeUndefined()
  })

  it('the engine refusing the sync (401) forgets the member through the root listener', async () => {
    seedRegistry()
    await applySyncResult(MEMBER, STORED)
    let releaseRequest: (() => void) | undefined
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') {
        await request
        return {
          data: undefined,
          error: { error: { code: 'unauthorized', message: 'A member session is required' } },
          response: new Response(null, { status: 401 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })

    renderWithProviders(<SessionProbe />)
    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
        params: expect.objectContaining({ header: { 'x-ohana-member': MEMBER } }),
      }),
    )
    // The sync is held in the air while a cached answer of the member is
    // put in place, so the refusal is what must clear it.
    client().setQueryData(['member', MEMBER, 'profiles'], [{ id: MEMBER }])
    releaseRequest?.()

    // The refusal travels to the root listener, which cleans the member up
    // exactly like a sign-out: registry, partition, and cached answers.
    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBeNull())
    expect(client().getQueryData(['member', MEMBER, 'profiles'])).toBeUndefined()
    const snapshot = await readMemberSnapshot(MEMBER)
    expect(snapshot.revision).toBeUndefined()
  })

  it('a failing refusal listener does not stop the others from cleaning up', async () => {
    const received: string[] = []
    const stopFirst = onMemberRefused(() => {
      throw new Error('the first listener is broken')
    })
    const stopSecond = onMemberRefused((who) => received.push(who))

    seedRegistry()
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') {
        return {
          data: undefined,
          error: { error: { code: 'unauthorized', message: 'A member session is required' } },
          response: new Response(null, { status: 401 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<SessionProbe />)

    await vi.waitFor(() => expect(received).toEqual([MEMBER]))
    stopFirst()
    stopSecond()
  })
})
