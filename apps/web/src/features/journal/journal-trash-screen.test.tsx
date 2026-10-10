import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredMemberProfile, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalTrashScreen } from './journal-trash-screen.tsx'

/*
 * The trash view (issue #16): the trashed entries with their deletion
 * dates, restore one tap away for those who may — the author, or the
 * space's owner for an entry trashed from published. The rows are
 * online-only data, so the test mocks the API at the client's level; a
 * restore goes to the API and lets the sync land the change.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode; to?: string }) => (
    <a href={rest.to}>{children}</a>
  ),
  useNavigate: () => async () => {},
  Navigate: () => null,
}))

vi.mock('@/data/sync-engine.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/sync-engine.ts')>()),
  triggerSync: vi.fn(),
}))

const apiGet = vi.mocked(api.GET)
const apiPost = vi.mocked(api.POST)
const triggerSyncMock = vi.mocked(triggerSync)

const ME = '01900000-0000-7000-8000-000000000001'
const STRANGER = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function profile(role: 'owner' | 'regular', id: string, name: string): StoredMemberProfile {
  return { id, name, role, createdAt: '2026-08-12T10:00:00.000Z' }
}

function trashedRow(overrides?: {
  id?: string
  authorId?: string
  title?: string
  previousState?: 'draft' | 'published'
}): {
  id: string
  authorId: string
  title?: string
  text: string
  previousState: 'draft' | 'published'
  trashedAt: string
  purgeAt: string
  createdAt: string
  updatedAt: string
} {
  return {
    id: overrides?.id ?? '01900000-0000-7000-8000-000000000101',
    authorId: overrides?.authorId ?? ME,
    title: overrides?.title ?? 'Осенний пикник',
    text: 'Собрались за час: бутерброды, термос, плед и Бублик.',
    previousState: overrides?.previousState ?? 'draft',
    trashedAt: '2026-09-12T09:00:00.000Z',
    purgeAt: '2026-10-12T09:00:00.000Z',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-12T09:00:00.000Z',
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
        displayName: 'Аня',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ME)
}

async function seedPartition(profiles: StoredMemberProfile[]) {
  await applySyncResult(ME, {
    revision: '5',
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
      ...profiles.map((row) => ({ entity: 'member' as const, member: row })),
    ],
    tombstones: [],
  } satisfies SyncResult)
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

describe('JournalTrashScreen', () => {
  it('lists the trashed entries with their deletion dates and a restore action', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: { entries: [trashedRow({ previousState: 'draft' })] },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    expect(await screen.findByText('Осенний пикник')).toBeInTheDocument()
    expect(screen.getByText(/удалено 12 сентября · исчезнет окончательно 12 октября/))
    expect(screen.getByRole('button', { name: 'Восстановить' })).toBeEnabled()
    // The list carries trashed drafts only their author may see, so the
    // request names its member explicitly (architecture.md, web rules).
    expect(apiGet).toHaveBeenCalledWith('/api/v1/journal/trash', {
      params: { header: { 'x-ohana-member': ME } },
    })
  })

  it('gives every trashed entry its own list card and closes with the banner (issue #72)', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: {
            entries: [
              trashedRow({ id: '01900000-0000-7000-8000-000000000201', previousState: 'draft' }),
              trashedRow({
                id: '01900000-0000-7000-8000-000000000202',
                previousState: 'published',
                title: 'Поход к Чёртову креслу',
              }),
            ],
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    await screen.findByText('Осенний пикник')
    // One card per row, in the prototype's 12px stack (trash.html).
    const firstCard = screen.getByText('Осенний пикник').closest('[data-slot="card"]')
    const secondCard = screen.getByText('Поход к Чёртову креслу').closest('[data-slot="card"]')
    expect(firstCard).not.toBeNull()
    expect(secondCard).not.toBeNull()
    expect(firstCard).not.toBe(secondCard)
    // The banner stands in the same stack, the prototype's 16px below it.
    const banner = document.querySelector('[data-slot="banner"]')
    expect(banner).toHaveTextContent('Восстановить запись можно в один шаг')
    expect(banner).toHaveClass('mb-4')
    // The prototype's h1 is `.display.display-xl` — the display size.
    expect(screen.getByRole('heading', { level: 1, name: 'Корзина' })).toHaveClass('text-display')
  })

  it('fades a restored row out where it stood before the list closes over it (issue #72)', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    const row = trashedRow({ previousState: 'draft' })
    let restored = false
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: { entries: restored ? [] : [row] },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}/restore') {
        restored = true
        return {
          data: {
            id: row.id,
            authorId: ME,
            text: row.text,
            state: 'draft',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalTrashScreen />)

    await user.click(await screen.findByRole('button', { name: 'Восстановить' }))
    expect(await screen.findByText('Восстановлено — запись снова в дневнике')).toBeInTheDocument()
    // The row fades out where it stood (trash.html's exit, on the card
    // the prototype animates): still mounted although the refetch has
    // already dropped it, and silent to assistive technology while it goes.
    const title = screen.getByText('Осенний пикник')
    expect(title.closest('[data-slot="card"]')).toHaveAttribute('aria-hidden', 'true')
    // The fade runs its course and the row leaves.
    await waitFor(() => expect(screen.queryByText('Осенний пикник')).not.toBeInTheDocument(), {
      timeout: 1500,
    })
  })

  it('restores through the API, refreshes the list, and triggers the sync', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    const row = trashedRow({ previousState: 'draft' })
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: { entries: [row] },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}/restore') {
        return {
          data: {
            id: row.id,
            authorId: ME,
            text: row.text,
            state: 'draft',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalTrashScreen />)

    await user.click(await screen.findByRole('button', { name: 'Восстановить' }))
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/restore', {
        params: { path: { entryId: row.id } },
      }),
    )
    expect(await screen.findByText('Восстановлено — запись снова в дневнике')).toBeInTheDocument()
    // The trash list is online-only data: the mutation re-probes it (the
    // mount's first read was before the restore), and the sync lands the
    // entry back into the synchronised partition.
    await waitFor(() => expect(triggerSyncMock).toHaveBeenCalled())
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(1))
  })

  it('offers restore to the author alone for a trashed draft, and to the owner for a published one', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня'), profile('regular', STRANGER, 'Дима')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: {
            entries: [
              trashedRow({
                id: '01900000-0000-7000-8000-000000000201',
                authorId: STRANGER,
                title: 'Чужой черновик',
                previousState: 'draft',
              }),
              trashedRow({
                id: '01900000-0000-7000-8000-000000000202',
                authorId: STRANGER,
                title: 'Чужая публикация',
                previousState: 'published',
              }),
            ],
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    // The owner sees both rows; only the ex-published one restores.
    await screen.findByText('Чужой черновик')
    expect(screen.getByText('Чужая публикация')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Восстановить' })).toHaveLength(1)
  })

  it('hides the restore action from a regular member reading another member’s trashed entry', async () => {
    seedRegistry()
    await seedPartition([profile('regular', ME, 'Вера')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: {
            entries: [
              trashedRow({
                authorId: STRANGER,
                title: 'Чужая публикация',
                previousState: 'published',
              }),
            ],
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    await screen.findByText('Чужая публикация')
    expect(screen.queryByRole('button', { name: 'Восстановить' })).not.toBeInTheDocument()
  })

  it('answers an empty trash with the empty state', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: { entries: [] },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument()
    // The prototype's empty state stands bare — no card around it.
    const empty = document.querySelector('[data-slot="empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.closest('[data-slot="card"]')).toBeNull()
  })

  it('says the server could not be reached and offers a retry', async () => {
    seedRegistry()
    await seedPartition([profile('owner', ME, 'Аня')])
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/trash') {
        return {
          data: undefined,
          error: { error: { code: 'unauthorized', message: 'No session' } },
          response: new Response(null, { status: 401 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<JournalTrashScreen />)

    expect(await screen.findByText('Не получилось загрузить')).toBeInTheDocument()
    expect(screen.queryByText('Корзина пуста')).not.toBeInTheDocument()
  })
})
