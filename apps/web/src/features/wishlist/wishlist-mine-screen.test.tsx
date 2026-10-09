import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { useEffect } from 'react'
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
  // The back link rides aria-label; the mock carries it like the real
  // Link does.
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to?: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
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
  const client = useQueryClient()
  useEffect(() => {
    capture(client)
  }, [client, capture])
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

  it('shows the whole hostname, however long, wrapping instead of hiding its end', async () => {
    const long = wish({
      id: '01900000-0000-7000-8000-000000000304',
      title: 'Сертификат',
      details: undefined,
      link: 'https://ozon.ru.account-check.example.net/gift',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([long]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Сертификат')).toBeInTheDocument()
    // The chip never truncates: every label of the hostname stays on the
    // card, the row wrapping it instead — no cut can hide where the link
    // resolves. The classes pin the wrapping: a span that truncated or
    // shrank would keep the text in the DOM and pass this test green.
    const chip = screen.getByText('ozon.ru.account-check.example.net')
    expect(chip).toHaveClass('break-all')
    expect(chip).not.toHaveClass('truncate')
    const anchor = chip.closest('a')
    expect(anchor).not.toHaveClass('truncate')
    expect(anchor).toHaveAttribute('href', long.link)
    expect(anchor).toHaveAttribute('title', long.link)
  })

  it('resolves a userinfo lookalike to the host that answers, not the prefix', async () => {
    const lookalike = wish({
      id: '01900000-0000-7000-8000-000000000306',
      title: 'Подарок',
      details: undefined,
      link: 'https://ozon.ru@evil.net/x',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([lookalike]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Подарок')).toBeInTheDocument()
    expect(screen.getByText('evil.net')).toBeInTheDocument()
    expect(screen.queryByText('ozon.ru@evil.net')).not.toBeInTheDocument()
  })

  it('shows a link without a parseable hostname as it is', async () => {
    // The contract admits a percent in the host, the browser refuses it:
    // one of the cases the fallback really sees.
    const link = 'https://exa%mple.com/a/b'
    const odd = wish({
      id: '01900000-0000-7000-8000-000000000305',
      title: 'Открытка',
      details: undefined,
      link,
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([odd]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Открытка')).toBeInTheDocument()
    // No hostname to show: the raw link is the chip, wrapping like any
    // other.
    expect(screen.getByText(link)).toBeInTheDocument()
  })

  it('falls back to the raw link when the hostname strips to nothing', async () => {
    const bare = wish({
      id: '01900000-0000-7000-8000-000000000307',
      title: 'Шарф',
      details: undefined,
      link: 'https://www./x',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([bare]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Шарф')).toBeInTheDocument()
    // `www.` strips to an empty hostname: a lone globe with an
    // unlabelled target is not the answer, the raw link is.
    expect(screen.getByText(bare.link as string)).toBeInTheDocument()
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
    expect(await screen.findByText('Желание добавлено')).toBeInTheDocument()
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
    expect(await screen.findByText('Желание обновлено')).toBeInTheDocument()
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
    expect(await screen.findByText('Желание обновлено')).toBeInTheDocument()
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
    expect(screen.queryByText('Желание обновлено')).not.toBeInTheDocument()

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
      expect(screen.getByText('Желание обновлено')).toBeInTheDocument()
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
    expect(await screen.findByText('Удалить желание?')).toBeInTheDocument()
    // The confirm names what the removal does to the reservations the
    // author never saw (the prototype's copy, issue #68).
    expect(screen.getByText(/Брони, если были, снимутся/)).toBeInTheDocument()
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
    // The sheet answers to the dialog role — the absence assertions below
    // would pass vacuously if it never did.
    expect(screen.getByRole('dialog')).toBeInTheDocument()

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
    // The sheet must be gone, not fallen back to "new" — an editor that
    // offered to re-create the removed wish would pass a title-only check.
    expect(screen.queryByText('Новое желание')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    // The row's pill proves the mid-edit sync reached the component —
    // otherwise the save would pass on a stale wish for the wrong reason.
    expect(await screen.findByText('Получено')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Желание обновлено')).toBeInTheDocument())
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
    // that is now open, the mark again. The pill's disappearance proves
    // the mid-edit sync reached the component first.
    await waitFor(() => expect(screen.queryByText('Получено')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Желание обновлено')).toBeInTheDocument())
    expect(apiPut).toHaveBeenCalledTimes(1)
    expect(apiPost).not.toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('a moved switch reads the mark that landed mid-edit, and sends no mark again', async () => {
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

    // Another device marks the wish received mid-edit; the member, seeing
    // the row change, moves the switch to received all the same.
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
    // The row's pill proves the mid-edit sync reached the component.
    expect(await screen.findByText('Получено')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Уже получено' }))

    // The save sends the triple only: the mark already sits on the row the
    // sheet reads live, so the moved switch does not send it a second time.
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Желание обновлено')).toBeInTheDocument())
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
    expect(await screen.findByText('Желание обновлено')).toBeInTheDocument()
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

describe('the own wishlist follows its prototype (issue #68)', () => {
  it('opens with the heading, the visibility line, the surprise note and the footer line', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    await screen.findByText('Налобный фонарь')

    // The prototype's header: the display heading with the muted
    // visibility line — the real last-updated moment beside «Виден семье».
    expect(screen.getByRole('heading', { level: 1, name: 'Мой вишлист' })).toHaveClass(
      'text-display-lg',
    )
    expect(screen.getByText(/Виден семье · обновлено/)).toBeInTheDocument()

    // The prototype's venue-note: the author never sees the reservations.
    const note = document.querySelector('[data-slot="note-block"]')
    expect(note).not.toBeNull()
    expect(note).toHaveTextContent('Близкие могут забронировать ваши желания')

    // The prototype's closing meta line (uppercase is the line's own
    // styling, not the copy).
    const footer = screen.getByText('Ваш список не виден в других пространствах')
    expect(footer).toHaveClass('font-mono', 'uppercase')

    // The prototype's `.m-only` back arrow rides the top bar; the top-bar
    // `d-only` action and the FAB have left with the demo chrome.
    expect(screen.getByRole('link', { name: 'Назад' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="fab"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Добавить желание' })).toHaveLength(1)
  })

  it('closes the list with the 52px dashed add tile, the last element, and it opens the sheet', async () => {
    const lamp = wish()
    const second = wish({
      id: '01900000-0000-7000-8000-000000000308',
      title: 'Поездка на Байкал',
      details: 'мечта — копим вместе',
      link: undefined,
      createdAt: '2026-09-26T12:00:00.000Z',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp, second]))
    mockQuietSync()
    mockWishCreated(
      wish({
        id: '01900000-0000-7000-8000-000000000399',
        title: 'Термос Stanley',
        details: undefined,
        link: undefined,
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await screen.findByText('Поездка на Байкал')

    // The prototype's `.attach-tile` overrides: full width, the 52px
    // floor, the dashed 1.5px hairline at the prototype's mid radius —
    // and accent on hover.
    const tile = screen.getByRole('button', { name: 'Добавить желание' })
    expect(tile).toHaveClass('min-h-13', 'w-full', 'border-dashed', 'rounded-md')
    // The tile stands after the wishes: new ones insert above it, the way
    // the prototype inserts before it.
    const lastWishTitle = screen.getByText('Поездка на Байкал')
    expect(
      lastWishTitle.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(tile)
    expect(await screen.findByText('Новое желание')).toBeInTheDocument()
  })

  it('shows the empty state bare, its primary button below the text', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    renderWithProviders(<WishlistMineScreen />)

    expect(await screen.findByText('Здесь пока ничего нет')).toBeInTheDocument()
    // The prototype's copy: the quiet reservation is the point.
    expect(
      screen.getByText(
        'Добавьте первое желание — близкие увидят его и смогут тихо забронировать подарок.',
      ),
    ).toBeInTheDocument()

    // Bare: no card wraps the empty state, and the button sits in the
    // content slot — never inside the round icon plate.
    const empty = document.querySelector('[data-slot="empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.closest('[data-slot="card"]')).toBeNull()
    const addButton = screen.getByRole('button', { name: 'Добавить желание' })
    expect(addButton.closest('[data-slot="empty-icon"]')).toBeNull()
    expect(addButton.closest('[data-slot="empty-content"]')).not.toBeNull()
  })

  it('opens the sheet in the prototype field order, the hint a single line, no close control', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Добавить желание' }))
    await screen.findByText('Новое желание')

    // The prototype's order: title, then the link, then the hint.
    const title = screen.getByLabelText('Название')
    const link = screen.getByLabelText('Ссылка')
    const hint = screen.getByLabelText('Подсказка')
    expect(title.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(link.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The hint is the prototype's single-line input, not the old textarea.
    expect(hint.tagName).toBe('INPUT')
    // The prototype's sheet-sub, promising what the author never sees.
    expect(
      screen.getByText('Видно семье; брони вы не увидите — сюрприз сохранится'),
    ).toBeInTheDocument()

    // The prototype's sheet has no close X: Esc and the scrim close it.
    expect(document.querySelector('[data-slot="sheet-close"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /закрыть/i })).not.toBeInTheDocument()
    // A new wish carries one button — the removal belongs to an edit.
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить желание' })).not.toBeInTheDocument()

    // The prototype saves on Enter from any input.
    mockWishCreated(
      wish({
        id: '01900000-0000-7000-8000-000000000398',
        title: 'Термос Stanley',
        details: undefined,
        link: undefined,
      }),
    )
    await user.type(title, 'Термос Stanley')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/wishlist/wishes', {
        body: { title: 'Термос Stanley', details: undefined, link: undefined },
      }),
    )
  })

  it('edits with the received switch row at body size and the two buttons', async () => {
    const lamp = wish()
    seedRegistry()
    await applySyncResult(ME, syncResult([lamp]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<WishlistMineScreen />)

    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByText('Изменить желание')

    // The switch row's title is at the body size — the prototype sets no
    // `small` on it; only its hint line takes the small size.
    const switchTitle = screen.getByText('Уже получено')
    expect(switchTitle).toHaveClass('font-medium')
    expect(switchTitle).not.toHaveClass('text-sm')
    expect(screen.getByText('В списке появится отметка «получено»')).toHaveClass('text-sm')

    // The prototype's two buttons: the primary save and the danger removal.
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить желание' })).toBeInTheDocument()
  })
})
