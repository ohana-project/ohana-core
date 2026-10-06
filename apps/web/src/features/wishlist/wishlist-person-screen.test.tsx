import { screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredMemberProfile, StoredWish, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { WishlistPersonScreen } from './wishlist-person-screen.tsx'

/*
 * One member's wishlist (issue #18): the open wishes they are hoping for —
 * a received wish has left the open wishes (issue #18). Everything reads
 * the local store, so the same render answers offline.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode; to?: string }) => (
    <a href={rest.to}>{children}</a>
  ),
  useNavigate: () => async () => {},
  Navigate: () => null,
}))

const apiGet = vi.mocked(api.GET)

const ME = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
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
]

function wish(overrides?: Partial<StoredWish>): StoredWish {
  return {
    id: '01900000-0000-7000-8000-000000000301',
    authorId: DIMA,
    title: 'Налобный фонарь Petzl Actik Core',
    details: 'чтобы ходить в горы в темноте',
    link: 'https://www.wildberries.ru/catalog/lamp',
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

describe('WishlistPersonScreen (one member wishlist)', () => {
  it('renders the open wishes of the member with their details and links', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish(),
        wish({
          id: '01900000-0000-7000-8000-000000000302',
          title: 'Термос Stanley Quest, 1 л',
          details: undefined,
          link: 'https://ozon.ru/thermos',
          createdAt: '2026-09-26T12:00:00.000Z',
        }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    expect(await screen.findByText('Налобный фонарь Petzl Actik Core')).toBeInTheDocument()
    expect(screen.getByText('Термос Stanley Quest, 1 л')).toBeInTheDocument()
    // The details travel with the wish; the links read as their domains.
    expect(screen.getByText('чтобы ходить в горы в темноте')).toBeInTheDocument()
    expect(screen.getByText('wildberries.ru')).toBeInTheDocument()
    expect(screen.getByText('ozon.ru')).toBeInTheDocument()

    // The prototype's header (issue #67): the member's name is the screen's
    // serif heading, and the list is open to the space — the note block and
    // the mono footer line say so.
    expect(screen.getByRole('heading', { level: 1, name: 'Дима' })).toBeInTheDocument()
    const note = document.querySelector('[data-slot="note-block"]')
    expect(note).not.toBeNull()
    expect(note).toHaveTextContent('Дима не видит брони и вашего избранного')
    expect(screen.getByText('Список видят Аня Смирнова и Дима')).toBeInTheDocument()
  })

  it('leaves received wishes out of the open list', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish(),
        wish({
          id: '01900000-0000-7000-8000-000000000303',
          title: 'Уже получено',
          receivedAt: '2026-09-30T10:00:00.000Z',
        }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    expect(await screen.findByText('Налобный фонарь Petzl Actik Core')).toBeInTheDocument()
    expect(screen.queryByText('Уже получено')).not.toBeInTheDocument()
    expect(screen.queryByText('Получено')).not.toBeInTheDocument()
  })

  it('says the list is empty when the member has not wished for anything', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    expect(await screen.findByText('Список пока пуст')).toBeInTheDocument()
    // The name stays nominative (Russian genitive is not something the
    // copy can inflect), and the empty text stands without it.
    expect(screen.getByText('Вишлист — Дима')).toBeInTheDocument()
    expect(screen.getByText('Пока желаний нет — загляните позже.')).toBeInTheDocument()
  })

  it('says nothing is downloaded while the wishlist replay has not landed', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    // Hide and re-show the wishlist: the re-show writes the replay promise
    // (cursor '0', ADR-0014), and the row left behind is a fraction.
    await applySyncResult(ME, {
      revision: '8',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: true, calendar: true, wishlist: false },
          },
        },
      ],
      tombstones: [],
    })
    await applySyncResult(ME, {
      revision: '9',
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
      ],
      tombstones: [],
    })
    mockQuietSync()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })
})
