import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredWish, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { syncedSnapshotKey } from '@/features/member/use-synced-space.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { WishlistMineScreen } from './wishlist-mine-screen.tsx'

/*
 * The member's own wishlist (issue #18): every wish creation-ordered with
 * received ones struck through, the add-and-edit sheet over the
 * synchronised partition, and the removal behind its confirm. Mutations go
 * to the API and trigger the sync; the tests mock the endpoints and assert
 * the screens' side of the flow.
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
const apiPost = vi.mocked(api.POST)
const apiPut = vi.mocked(api.PUT)
const apiDelete = vi.mocked(api.DELETE)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function wish(overrides?: Partial<StoredWish>): StoredWish {
  return {
    id: '01900000-0000-7000-8000-000000000301',
    authorId: ME,
    title: 'Налобный фонарь',
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
      {
        entity: 'member',
        member: {
          id: ME,
          name: 'Аня',
          displayName: 'Аня Смирнова',
          role: 'owner',
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      },
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

/**
 * A handle on the providers' query client, so a test can land a sync
 * response mid-render and refresh the snapshot the way the sync engine's
 * notification does: the store's apply and the cache's invalidation are
 * the two halves the screens react to.
 */
function CaptureClient({ capture }: { capture: (client: QueryClient) => void }) {
  capture(useQueryClient())
  return null
}

/** Applies a response and refreshes the screens' snapshot query after it. */
async function landSync(client: QueryClient, result: SyncResult) {
  await applySyncResult(ME, result)
  await client.invalidateQueries({ queryKey: syncedSnapshotKey(ME) })
}

function mockWishCreated(created: StoredWish) {
  apiPost.mockImplementation(async (path: never) => {
    if (path === '/api/v1/wishlist/wishes') {
      return {
        data: created,
        error: undefined,
        response: new Response(null, { status: 201 }),
      }
    }
    throw new Error(`Unexpected POST ${String(path)}`)
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

describe('WishlistMineScreen (the own wishlist)', () => {
  it('renders the wishlist creation-first with received wishes struck through', async () => {
    const lamp = wish()
    const received = wish({
      id: '01900000-0000-7000-8000-000000000302',
      title: 'Сертификат в «Подписные издания»',
      details: undefined,
      link: undefined,
      receivedAt: '2026-09-30T10:00:00.000Z',
      createdAt: '2026-09-26T12:00:00.000Z',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp, received]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Налобный фонарь')).toBeInTheDocument()
    expect(screen.getByText('Сертификат в «Подписные издания»')).toBeInTheDocument()
    // The received wish carries the mark, and its title is struck through.
    expect(screen.getByText('Получено')).toBeInTheDocument()
    const struckTitle = screen.getByText('Сертификат в «Подписные издания»')
    expect(struckTitle).toHaveClass('line-through')
    // The link shows as its domain chip.
    expect(screen.getByText('wildberries.ru')).toBeInTheDocument()
  })

  it('offers the first wish when the list is empty', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Здесь пока ничего нет')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Добавить желание' }).length).toBeGreaterThan(0)
  })

  it('adds a wish through the sheet and reports the addition', async () => {
    const created = wish({
      id: '01900000-0000-7000-8000-000000000399',
      title: 'Термос Stanley',
      details: '1 литр',
      link: 'https://ozon.ru/thermos',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    mockWishCreated(created)
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByText('Здесь пока ничего нет'))
    // The empty state's button opens the sheet (the header and the FAB
    // carry the same action).
    const emptyStateButton = screen.getAllByRole('button', { name: 'Добавить желание' })[0]
    if (emptyStateButton === undefined) throw new Error('The empty state carries no button')
    await user.click(emptyStateButton)
    await screen.findByText('Новое желание')

    await user.type(screen.getByLabelText('Название'), 'Термос Stanley')
    await user.type(screen.getByLabelText('Подсказка'), '1 литр')
    await user.type(screen.getByLabelText('Ссылка'), 'https://ozon.ru/thermos')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/wishlist/wishes', {
        body: { title: 'Термос Stanley', details: '1 литр', link: 'https://ozon.ru/thermos' },
      }),
    )
    expect(await screen.findByText('Желание добавлено в ваш список')).toBeInTheDocument()
  })

  it('edits a wish through the sheet, replacing the whole triple', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: { ...lamp, title: 'Фонарь Petzl', details: undefined },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    const title = screen.getByLabelText('Название')
    await user.clear(title)
    await user.type(title, 'Фонарь Petzl')
    await user.clear(screen.getByLabelText('Подсказка'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/v1/wishlist/wishes/{wishId}', {
        params: { path: { wishId: lamp.id } },
        body: { title: 'Фонарь Petzl', details: undefined, link: lamp.link },
      }),
    )
    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
  })

  it('refuses a save without a real link, and never sends the received mark beside it', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // The mark rides this save, but the link is not a link: nothing is
    // sent, and the field says so.
    await user.click(screen.getByRole('switch', { name: 'Уже получено' }))
    await user.clear(screen.getByLabelText('Ссылка'))
    await user.type(screen.getByLabelText('Ссылка'), 'ozon.ru/thermos')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Начинается с http:// или https://')).toBeInTheDocument()
    expect(apiPut).not.toHaveBeenCalled()
    expect(apiPost).not.toHaveBeenCalled()

    // The corrected save goes through: the triple first, the mark second.
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: { ...lamp, title: lamp.title, link: 'https://ozon.ru/thermos' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}/received') {
        return {
          data: { ...lamp, receivedAt: '2026-10-01T09:30:00.000Z' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    await user.clear(screen.getByLabelText('Ссылка'))
    await user.type(screen.getByLabelText('Ссылка'), 'https://ozon.ru/thermos')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/wishlist/wishes/{wishId}/received', {
        params: { path: { wishId: lamp.id } },
      }),
    )
    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
  })

  it('a refused save changes nothing, and the retry marks the wish exactly once', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // The replace goes first and is refused: the mark is not sent either —
    // a refused save changes nothing, and the sheet stays open.
    let marks = 0
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}/received') {
        marks += 1
        return {
          data: { ...lamp, receivedAt: '2026-10-01T09:30:00.000Z' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: undefined,
          error: { error: { code: 'validation_failed', message: 'Check the fields' } },
          response: new Response(null, { status: 400 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    await user.click(screen.getByRole('switch', { name: 'Уже получено' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(screen.getByText(/Проверьте поля/)).toBeInTheDocument())
    expect(marks).toBe(0)
    expect(screen.queryByText('Сохранено')).not.toBeInTheDocument()

    // The retried save succeeds: the replace lands, then the mark rides
    // once — a later save cannot send it again, the wish the store holds
    // being received already.
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: { ...lamp, receivedAt: '2026-10-01T09:30:00.000Z', link: 'https://ozon.ru/x' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => {
      expect(marks).toBe(1)
      expect(screen.getByText('Сохранено')).toBeInTheDocument()
    })
  })

  it('removes a wish behind its confirm, a true delete with no way back', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    apiDelete.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return { data: undefined, error: undefined, response: new Response(null, { status: 204 }) }
      }
      throw new Error(`Unexpected DELETE ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await user.click(await screen.findByRole('button', { name: 'Удалить желание' }))

    // The confirm stands between: no delete before it.
    expect(await screen.findByText(/исчезнет из вашего списка у всех/)).toBeInTheDocument()
    expect(apiDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith('/api/v1/wishlist/wishes/{wishId}', {
        params: { path: { wishId: lamp.id } },
      }),
    )
    expect(await screen.findByText('Желание удалено')).toBeInTheDocument()
  })

  it('closes the sheet when a sync removes the wish under it', async () => {
    const lamp = wish()
    let client: QueryClient | undefined
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <CaptureClient capture={(c) => (client = c)} />
        <WishlistMineScreen />
      </>,
    )

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // The removal arrives as the sync's tombstone: the sheet closes
    // instead of editing (or, falling back to "new", re-creating) a wish
    // that no longer exists.
    if (client === undefined) throw new Error('The query client never arrived')
    await landSync(client, {
      revision: '8',
      changes: [],
      tombstones: [{ entity: 'wishlist_wish', entityId: lamp.id, audience: 'all' }],
    })

    await waitFor(() => expect(screen.queryByText('Изменить желание')).not.toBeInTheDocument())
    expect(screen.queryByText('Налобный фонарь')).not.toBeInTheDocument()
  })

  it('an untouched switch does not clear the mark another device landed mid-edit', async () => {
    const lamp = wish()
    let client: QueryClient | undefined
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: { ...lamp, receivedAt: '2026-10-01T09:30:00.000Z' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <CaptureClient capture={(c) => (client = c)} />
        <WishlistMineScreen />
      </>,
    )

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // Another device marks the wish received while the sheet is open: the
    // row under the sheet changes, the switch does not move on its own.
    if (client === undefined) throw new Error('The query client never arrived')
    await landSync(client, {
      revision: '8',
      changes: [
        {
          entity: 'wishlist_wish',
          wish: {
            ...lamp,
            receivedAt: '2026-10-01T09:30:00.000Z',
            updatedAt: '2026-10-01T09:30:00.000Z',
          },
        },
      ],
      tombstones: [],
    })

    // The save that never touched the switch sends the triple only: the
    // mark another device landed is neither cleared nor re-marked.
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Сохранено')).toBeInTheDocument())
    expect(apiPut).toHaveBeenCalledTimes(1)
    expect(apiPost).not.toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('an untouched switch does not re-mark a wish another device returned to open', async () => {
    const lamp = wish({ receivedAt: '2026-09-30T10:00:00.000Z' })
    let client: QueryClient | undefined
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: { ...lamp, receivedAt: undefined },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <CaptureClient capture={(c) => (client = c)} />
        <WishlistMineScreen />
      </>,
    )

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // Another device clears the mark while the sheet is open.
    if (client === undefined) throw new Error('The query client never arrived')
    await landSync(client, {
      revision: '8',
      changes: [
        {
          entity: 'wishlist_wish',
          wish: { ...lamp, receivedAt: undefined, updatedAt: '2026-10-01T09:30:00.000Z' },
        },
      ],
      tombstones: [],
    })

    // The untouched switch sends neither the clearing nor, against the row
    // that is now open, the mark again.
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Сохранено')).toBeInTheDocument())
    expect(apiPut).toHaveBeenCalledTimes(1)
    expect(apiPost).not.toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('sends an auto-capitalised link with its scheme lowercased', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/wishlist/wishes/{wishId}') {
        return {
          data: lamp,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // A mobile keyboard's capital first letter is a link all the same: the
    // guard reads the scheme case-insensitively, and the scheme leaves
    // lowercased while the rest of the URL keeps its case.
    await user.clear(screen.getByLabelText('Ссылка'))
    await user.type(screen.getByLabelText('Ссылка'), 'Https://Ozon.ru/X')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/v1/wishlist/wishes/{wishId}', {
        params: { path: { wishId: lamp.id } },
        body: { title: lamp.title, details: lamp.details, link: 'https://Ozon.ru/X' },
      }),
    )
    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
  })

  it('says nothing is downloaded while the wishlist replay has not landed', async () => {
    seedRegistry()
    // A partition whose replay promise names the wishlist (cursor '0').
    await applySyncResult(ME, syncResult([]))
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
        { entity: 'wishlist_wish', wish: wish() },
      ],
      tombstones: [],
    })
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })

  it('says the section is hidden instead of showing the list', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
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
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Раздел скрыт владельцем пространства.')).toBeInTheDocument()
    expect(screen.getByText(/Ничего не удалено/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Добавить желание' })).not.toBeInTheDocument()
  })
})
