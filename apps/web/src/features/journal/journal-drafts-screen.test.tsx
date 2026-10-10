import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, StoredJournalEntryImage, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { seedVersionOnePartition } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalDraftsScreen } from './journal-drafts-screen.tsx'

/** The entry as the wire carries it: photos name what their original is. */
type WireEntry = StoredJournalEntry & {
  images: Array<StoredJournalEntryImage & { originalType: string }>
}

/*
 * The drafts list (issue #15): the author's separate list — every row
 * continues in the editor or shares with the space. Publishing goes to
 * the API and lets the sync land the change, exactly like every journal
 * mutation.
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

const apiPost = vi.mocked(api.POST)
const triggerSyncMock = vi.mocked(triggerSync)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function draft(overrides?: Partial<WireEntry>): WireEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Осенний пикник',
    text: 'Собрались за час: бутерброды, термос, плед и Бублик.',
    state: 'draft',
    images: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  }
}

function syncResult(entries: WireEntry[]): SyncResult {
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
      ...entries.map((row) => ({ entity: 'journal_entry' as const, entry: row })),
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
        displayName: 'Аня',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ME)
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

describe('JournalDraftsScreen', () => {
  it('lists the drafts with their last edit, newest first', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        draft({
          id: '01900000-0000-7000-8000-000000000201',
          updatedAt: '2026-09-20T10:00:00.000Z',
          title: 'Старый черновик',
        }),
        draft(),
      ]),
    )
    renderWithProviders(<JournalDraftsScreen />)

    expect(await screen.findByText('Осенний пикник')).toBeInTheDocument()
    expect(screen.getByText('Старый черновик')).toBeInTheDocument()
    // Newest edit first: Осенний пикник was edited later.
    const first = screen.getByText('Осенний пикник')
    const second = screen.getByText('Старый черновик')
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Дописать' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Действия с черновиком' })).toHaveLength(2)
  })

  it('gives every draft its own list card led by the 38px tile (issue #72)', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        draft({
          id: '01900000-0000-7000-8000-000000000201',
          updatedAt: '2026-09-20T10:00:00.000Z',
          title: 'Старый черновик',
        }),
        draft(),
      ]),
    )
    const { container } = renderWithProviders(<JournalDraftsScreen />)

    await screen.findByText('Осенний пикник')
    // One card per row, in the prototype's 12px stack (drafts.html).
    const firstCard = screen.getByText('Осенний пикник').closest('[data-slot="card"]')
    const secondCard = screen.getByText('Старый черновик').closest('[data-slot="card"]')
    expect(firstCard).not.toBeNull()
    expect(secondCard).not.toBeNull()
    expect(firstCard).not.toBe(secondCard)
    expect(container.querySelectorAll('[data-slot="card"][data-variant="list"]')).toHaveLength(2)
    // The row leads with the 38px tinted tile (the opt-in `icon` media).
    const tile = firstCard?.querySelector('[data-slot="item-media"]')
    expect(tile).toHaveAttribute('data-variant', 'icon')
    // The row body links to the editor (the prototype's `a.body`).
    const bodyLink = screen.getByText('Осенний пикник').closest('a')
    expect(bodyLink).not.toBeNull()
    expect(bodyLink?.getAttribute('href')).toContain('edit')
    // The overflow button is the 36px `icon-sm` round (.btn-icon.btn-sm).
    const trigger = screen.getAllByRole('button', { name: 'Действия с черновиком' })[0]
    expect(trigger).toHaveClass('size-9')
  })

  it('names the number of photos in the row sub line (issue #72)', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        draft({
          images: [
            {
              id: '01900000-0000-7000-8000-000000000301',
              state: 'ready',
              originalType: 'image/jpeg',
            },
            {
              id: '01900000-0000-7000-8000-000000000302',
              state: 'ready',
              originalType: 'image/jpeg',
            },
          ],
        }),
      ]),
    )
    renderWithProviders(<JournalDraftsScreen />)

    await screen.findByText('Осенний пикник')
    // The prototype's sub: «правки … · 2 фото загружено».
    expect(screen.getByText(/2 фото загружено/)).toBeInTheDocument()
  })

  it('publishes a draft through the API and triggers the sync', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([draft()]))
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}/publish') {
        return {
          data: { ...draft(), state: 'published', publishedAt: '2026-10-01T09:00:00.000Z' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalDraftsScreen />)

    // Publishing hides behind the row's overflow menu: one tap must not
    // share a private draft for good (docs/design/screens/drafts.html).
    await user.click(await screen.findByRole('button', { name: 'Действия с черновиком' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Опубликовать сейчас' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: draft().id } },
      }),
    )
    await waitFor(() => expect(triggerSyncMock).toHaveBeenCalled())
    expect(await screen.findByText('Опубликовано в дневнике пространства')).toBeInTheDocument()
  })

  it('one publish in flight does not disable the other rows', async () => {
    seedRegistry()
    const held = draft({
      id: '01900000-0000-7000-8000-000000000201',
      title: 'Долгая правка',
      updatedAt: '2026-09-20T10:00:00.000Z',
    })
    const free = draft({
      id: '01900000-0000-7000-8000-000000000202',
      title: 'Быстрая правка',
    })
    await applySyncResult(ME, syncResult([held, free]))

    let releaseHeld: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    apiPost.mockImplementation(
      async (
        path: never,
        opts?: { params?: { path?: { entryId?: string } } },
      ): Promise<{ data: unknown; error: undefined; response: Response }> => {
        if (path === '/api/v1/journal/entries/{entryId}/publish') {
          const publishedId = opts?.params?.path?.entryId
          if (publishedId === held.id) await gate
          const published = publishedId === held.id ? held : free
          return {
            data: { ...published, state: 'published', publishedAt: '2026-10-01T09:00:00.000Z' },
            error: undefined,
            response: new Response(null, { status: 200 }),
          }
        }
        throw new Error(`Unexpected POST ${String(path)}`)
      },
    )
    const user = userEvent.setup()
    renderWithProviders(<JournalDraftsScreen />)

    // The rows publish independently: while the first publish hangs, the
    // other row keeps its own enabled action, and both toasts land.
    const triggers = await screen.findAllByRole('button', { name: 'Действия с черновиком' })
    expect(triggers).toHaveLength(2)

    // The older edit lists last; its publish hangs in flight.
    await user.click(triggers[1] as HTMLButtonElement)
    await user.click(await screen.findByRole('menuitem', { name: 'Опубликовать сейчас' }))
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: held.id } },
      }),
    )

    // The other row's menu still offers a live action of its own.
    await user.click(triggers[0] as HTMLButtonElement)
    const freeItem = await screen.findByRole('menuitem', { name: 'Опубликовать сейчас' })
    expect(freeItem).toBeEnabled()
    await user.click(freeItem)
    expect(await screen.findByText('Опубликовано в дневнике пространства')).toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledTimes(2)

    // The held publish lands. Its row waits for the sync that removes it,
    // and until then its menu's action stays dark: a second tap cannot
    // re-publish what has already been shared.
    releaseHeld?.()
    await waitFor(() =>
      expect(screen.getAllByText('Опубликовано в дневнике пространства')).toHaveLength(2),
    )
    await user.click(triggers[1] as HTMLButtonElement)
    // Base UI marks the disabled item with aria-disabled on a div.
    expect(await screen.findByRole('menuitem', { name: 'Опубликовать сейчас' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('a refused publish still triggers the sync, so a stale row clears itself', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([draft()]))
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}/publish') {
        return {
          data: undefined,
          error: { error: { code: 'entry_already_published', message: 'Already shared' } },
          response: new Response(null, { status: 409 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalDraftsScreen />)

    await user.click(await screen.findByRole('button', { name: 'Действия с черновиком' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Опубликовать сейчас' }))

    expect(await screen.findByText('Эта запись уже опубликована.')).toBeInTheDocument()
    // The refusal is what carries the refresh: the sync ran although
    // nothing succeeded.
    expect(triggerSyncMock).toHaveBeenCalledTimes(1)
  })

  it('offers the first entry when there are no drafts', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    renderWithProviders(<JournalDraftsScreen />)

    expect(await screen.findByText('Черновиков нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новая запись' })).toBeInTheDocument()
  })

  it('stands the empty state bare, its button without an icon, and hides the lock note with the list (issue #72)', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    renderWithProviders(<JournalDraftsScreen />)

    await screen.findByText('Черновиков нет')
    // The prototype's `.empty` stands on its own — no card around it.
    const empty = document.querySelector('[data-slot="empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.closest('[data-slot="card"]')).toBeNull()
    // The 64px plate carries the 28px glyph (the default empty media).
    const media = empty?.querySelector('[data-slot="empty-icon"]')
    expect(media).toHaveAttribute('data-variant', 'default')
    // The prototype's «Новая запись» button carries no icon.
    const button = screen.getByRole('button', { name: 'Новая запись' })
    expect(button.querySelector('svg')).toBeNull()
    // The lock note rides the list (drafts.html keeps it inside it).
    expect(screen.queryByText(/Черновики хранятся/)).not.toBeInTheDocument()
  })

  it('sets the display heading and the «Черновики» top bar, and shows the lock note with the list (issue #72)', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([draft()]))
    renderWithProviders(<JournalDraftsScreen />)

    await screen.findByText('Осенний пикник')
    // The prototype's h1 is `.display.display-xl` — the display size.
    expect(screen.getByRole('heading', { level: 1, name: 'Мои черновики' })).toHaveClass(
      'text-display',
    )
    // The top bar carries the prototype's data-title, not the h1.
    const topbar = document.querySelector('[data-slot="topbar"]')
    expect(topbar).toHaveTextContent('Черновики')
    expect(topbar).not.toHaveTextContent('Мои черновики')
    // The lock note belongs to the list.
    expect(screen.getByText(/Черновики хранятся/)).toBeInTheDocument()
  })

  it('says that nothing is downloaded instead of claiming there are no drafts', async () => {
    seedRegistry()
    renderWithProviders(<JournalDraftsScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(screen.queryByText('Черновиков нет')).not.toBeInTheDocument()
  })

  it('says the same while the upgrade replay has not landed', async () => {
    seedRegistry()
    // The device upgraded from a version 1 partition: the upgrade wrote
    // the replay promise (cursor '0', the journal named), and the read
    // answers it honestly (ADR-0014).
    await seedVersionOnePartition(ME, { id: SPACE_ID, name: 'Наша семья' })
    renderWithProviders(<JournalDraftsScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(screen.queryByText('Черновиков нет')).not.toBeInTheDocument()
  })
})
