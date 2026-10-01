import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import {
  forgetMember,
  memberSessionQueryKey,
  useMemberSessionStatus,
  useRedeemedSignIn,
} from './use-member-session.ts'

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

    forgetMember(queryClient, 'm-1')

    // The forgotten member's answers are cleared outright.
    expect(queryClient.getQueryData(profilesOf('m-1'))).toBeUndefined()
    expect(window.localStorage.getItem('ohana.sessions')).toBe('[]')
    // Everything else is reset for whoever is active now: no cached answer
    // survives the boundary.
    expect(queryClient.getQueryData(memberSessionQueryKey)).toBeUndefined()
    expect(queryClient.getQueryData(profilesOf('m-2'))).toBeUndefined()
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
    const { readMemberSnapshot } = await import('@/data/local-store.ts')
    const snapshot = await readMemberSnapshot(MEMBER)
    expect(snapshot.revision).toBeUndefined()
  })
})
