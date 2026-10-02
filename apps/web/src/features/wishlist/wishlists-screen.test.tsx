import { screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredMemberProfile, StoredWish, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { WishlistsScreen } from './wishlists-screen.tsx'

/*
 * The wishlists overview (issue #18): the member's own list beside the
 * other members' lists, counted by open wishes — a received wish has left
 * the open count (issue #18). Everything reads the local store, so the
 * same render answers offline.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  // The overview's cards and rows are links; the params interpolate into
  // the href so the tests can assert where each row leads.
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode
    to?: string
    params?: Record<string, string>
  }) => <a href={to?.replace('$memberId', params?.memberId ?? '$memberId')}>{children}</a>,
  useNavigate: () => async () => {},
  Navigate: () => null,
}))

const apiGet = vi.mocked(api.GET)

const ME = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const LYUDA = '01900000-0000-7000-8000-000000000003'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const PROFILES: StoredMemberProfile[] = [
  {
    id: ME,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  { id: DIMA, name: 'Дима', role: 'regular', createdAt: '2026-08-14T10:00:00.000Z' },
  { id: LYUDA, name: 'Люда', role: 'regular', createdAt: '2026-08-15T10:00:00.000Z' },
]

function wish(overrides?: Partial<StoredWish>): StoredWish {
  return {
    id: '01900000-0000-7000-8000-000000000301',
    authorId: ME,
    title: 'Налобный фонарь',
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  }
}

function syncResult(wishes: StoredWish[]): SyncResult {
  return {
    revision: '7',
    changes: [
      {
        entity: 'space',
        space: {
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      ...PROFILES.map((member) => ({ entity: 'member' as const, member })),
      ...wishes.map((row) => ({ entity: 'wishlist_wish' as const, wish: row })),
    ],
    tombstones: [],
  }
}

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ME,
        spaceId: SPACE_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ME)
}

function mockQuietSync() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return {
        data: {
          member: {
            id: ME,
            name: 'Аня',
            displayName: 'Аня Смирнова',
            role: 'owner',
            createdAt: '2026-08-12T10:00:00.000Z',
          },
          space: { id: SPACE_ID, name: 'Наша семья' },
          needsOnboarding: false,
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    if (path === '/api/v1/sync') {
      return {
        data: { revision: '7', changes: [], tombstones: [] },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(async () => {
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('WishlistsScreen (the overview)', () => {
  it('counts the own list and the other members open wishes', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish({ id: '01900000-0000-7000-8000-000000000311' }),
        wish({
          id: '01900000-0000-7000-8000-000000000312',
          title: 'Полученный подарок',
          receivedAt: '2026-09-30T10:00:00.000Z',
        }),
        wish({
          id: '01900000-0000-7000-8000-000000000313',
          authorId: DIMA,
          title: 'Термос',
        }),
        wish({
          id: '01900000-0000-7000-8000-000000000314',
          authorId: DIMA,
          title: 'Ушедшее желание',
          receivedAt: '2026-09-29T10:00:00.000Z',
        }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    // The own card counts open wishes only: one open, one received.
    expect(await screen.findByText('1 желание · 1 получено')).toBeInTheDocument()
    // Дима's row counts his one open wish; the received one left it. The
    // own card's count reads "1 желание · 1 получено" as one line, so the
    // bare count text is the row's alone.
    expect(screen.getByText('Дима')).toBeInTheDocument()
    expect(screen.getAllByText('1 желание')).toHaveLength(1)
    // Люда has no wishes at all.
    expect(screen.getByText('Люда')).toBeInTheDocument()
    expect(screen.getByText('0 желаний')).toBeInTheDocument()
  })

  it('links the own card and every member row into the section', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish({ id: '01900000-0000-7000-8000-000000000311' }),
        wish({ id: '01900000-0000-7000-8000-000000000313', authorId: DIMA, title: 'Термос' }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Дима')
    const links = screen.getAllByRole('link')
    const targets = links.map((link) => link.getAttribute('href'))
    expect(targets).toContain('/wishlist/mine')
    expect(targets).toContain(`/wishlist/${DIMA}`)
    expect(targets).toContain(`/wishlist/${LYUDA}`)
  })

  it('says the space has no other members yet', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    // A fresh partition carries only Аня: strip the other profiles out.
    await applySyncResult(ME, {
      revision: '8',
      changes: [],
      tombstones: PROFILES.filter((profile) => profile.id !== ME).map((profile) => ({
        entity: 'member' as const,
        entityId: profile.id,
        audience: 'all' as const,
      })),
    })
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByText('Пока вы одни в пространстве')).toBeInTheDocument()
  })

  it('says that nothing is available offline when nothing is downloaded', async () => {
    seedRegistry()
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })
})
