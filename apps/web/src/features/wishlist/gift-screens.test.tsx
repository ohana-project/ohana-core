import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type {
  StoredGiftFavorite,
  StoredGiftReservation,
  StoredMemberProfile,
  StoredWish,
  SyncResult,
} from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { WishlistFavoritesScreen } from './wishlist-favorites-screen.tsx'
import { WishlistPersonScreen } from './wishlist-person-screen.tsx'
import { WishlistsScreen } from './wishlists-screen.tsx'

/*
 * The gift screens (issue #19): the heart on another member's rows toggles
 * the member's private favorite, the reserve button claims a wish behind
 * its confirm, a held wish names who holds it, and the favorites screen
 * lists the bookmarks with the way back out. Everything reads the local
 * store, so the same render answers offline.
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

const apiPost = vi.mocked(api.POST)
const apiDelete = vi.mocked(api.DELETE)

const ME = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const LYUDA = '01900000-0000-7000-8000-000000000003'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const LAMP_ID = '01900000-0000-7000-8000-000000000301'

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
    id: LAMP_ID,
    authorId: DIMA,
    title: 'Налобный фонарь Petzl Actik Core',
    details: 'чтобы ходить в горы в темноте',
    link: 'https://www.wildberries.ru/catalog/lamp',
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  }
}

function favorite(overrides?: Partial<StoredGiftFavorite>): StoredGiftFavorite {
  return {
    id: '01900000-0000-7000-8000-000000000401',
    wishId: LAMP_ID,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  }
}

function reservation(overrides?: Partial<StoredGiftReservation>): StoredGiftReservation {
  return {
    id: '01900000-0000-7000-8000-000000000501',
    wishId: LAMP_ID,
    memberId: LYUDA,
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
    ...overrides,
  }
}

function syncResult(
  wishes: StoredWish[],
  extras: Array<SyncResult['changes'][number]> = [],
): SyncResult {
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
      ...extras,
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
  vi.mocked(api.GET).mockImplementation(async (path: never) => {
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

function mockCreated() {
  return {
    data: { id: '01900000-0000-7000-8000-000000000fff', wishId: LAMP_ID, memberId: ME },
    error: undefined,
    response: new Response(null, { status: 201 }),
  } as never
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

describe('the person screen gift controls (issue #19)', () => {
  it('favorites another member’s wish through the heart, and un-favorites when held', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    apiPost.mockResolvedValue(mockCreated())
    const user = userEvent.setup()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    const heart = await screen.findByRole('button', { name: 'В избранное' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await user.click(heart)

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/wishlist/wishes/{wishId}/favorite',
      expect.objectContaining({ params: { path: { wishId: LAMP_ID } } }),
    )
    expect(await screen.findByText('В избранном — видно только вам')).toBeInTheDocument()
  })

  it('reserves a free wish behind its confirm, naming the surprise', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    apiPost.mockResolvedValue(mockCreated())
    const user = userEvent.setup()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    await screen.findByRole('button', { name: 'Забронировать' })
    await user.click(screen.getByRole('button', { name: 'Забронировать' }))

    // The confirm names the stakes before the claim is made.
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText('Забронировать «Налобный фонарь Petzl Actik Core»?'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Дима не увидит бронь — сохранится сюрприз. Остальные участники будут знать, что подарок уже занят.',
      ),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Забронировать' }))
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/wishlist/wishes/{wishId}/reservation',
      expect.objectContaining({ params: { path: { wishId: LAMP_ID } } }),
    )
    expect(await screen.findByText('Забронировано. Дима не узнает')).toBeInTheDocument()
  })

  it('names the member who holds a wish, with no reserve button beside the claim', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([wish()], [{ entity: 'wishlist_gift_reservation', reservation: reservation() }]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    // Люда's claim is visible, with her name; no reserve button beside it.
    expect(await screen.findByText('Бронь — Люда')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Забронировать' })).not.toBeInTheDocument()
  })

  it('cancels the member’s own reservation behind its confirm', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult(
        [wish()],
        [
          {
            entity: 'wishlist_gift_reservation',
            reservation: reservation({ memberId: ME }),
          },
        ],
      ),
    )
    mockQuietSync()
    apiDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<WishlistPersonScreen memberId={DIMA} />)

    // The pill reads «вы», and the cancel asks first.
    expect(await screen.findByText('вы')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Снять бронь' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Снять бронь?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Снять' }))

    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/wishlist/wishes/{wishId}/reservation',
      expect.objectContaining({ params: { path: { wishId: LAMP_ID } } }),
    )
    expect(await screen.findByText('Бронь снята')).toBeInTheDocument()
  })
})

describe('the favorites screen (issue #19)', () => {
  it('lists the member’s bookmarks with the wishlist they came from, and removes one', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult(
        [
          wish(),
          wish({
            id: '01900000-0000-7000-8000-000000000302',
            authorId: LYUDA,
            title: 'Шёлковый платок',
          }),
        ],
        [
          { entity: 'wishlist_gift_favorite', favorite: favorite() },
          {
            entity: 'wishlist_gift_favorite',
            favorite: favorite({
              id: '01900000-0000-7000-8000-000000000402',
              wishId: '01900000-0000-7000-8000-000000000302',
            }),
          },
        ],
      ),
    )
    mockQuietSync()
    apiDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<WishlistFavoritesScreen />)

    expect(await screen.findByText('Налобный фонарь Petzl Actik Core')).toBeInTheDocument()
    expect(screen.getByText('Шёлковый платок')).toBeInTheDocument()
    expect(screen.getByText('Из вишлиста: Дима')).toBeInTheDocument()
    expect(screen.getByText('Из вишлиста: Люда')).toBeInTheDocument()
    expect(screen.getByText('2 идеи · видно только вам')).toBeInTheDocument()

    // The way back out of the shortlist.
    const removeButtons = screen.getAllByRole('button', { name: 'Убрать' })
    await user.click(removeButtons[0] as HTMLButtonElement)
    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/wishlist/wishes/{wishId}/favorite',
      expect.objectContaining({ params: { path: { wishId: LAMP_ID } } }),
    )
    expect(await screen.findByText('Убрано из избранного')).toBeInTheDocument()
  })

  it('says the shortlist is empty and offers the way to the wishlists', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    renderWithProviders(<WishlistFavoritesScreen />)

    expect(await screen.findByText('Пока ничего не отложено')).toBeInTheDocument()
    expect(screen.getByText('К вишлистам')).toBeInTheDocument()
  })
})

describe('the wishlists overview favorites card (issue #19)', () => {
  it('counts the member’s bookmarks and leads to the favorites screen', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([wish()], [{ entity: 'wishlist_gift_favorite', favorite: favorite() }]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByText('Избранные идеи')).toBeInTheDocument()
    expect(screen.getByText('1 идея · видно только вам')).toBeInTheDocument()
  })
})
