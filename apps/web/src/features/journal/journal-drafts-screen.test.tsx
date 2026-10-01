import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalDraftsScreen } from './journal-drafts-screen.tsx'

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

function draft(overrides?: Partial<StoredJournalEntry>): StoredJournalEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Осенний пикник',
    text: 'Собрались за час: бутерброды, термос, плед и Бублик.',
    state: 'draft',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  }
}

function syncResult(entries: StoredJournalEntry[]): SyncResult {
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
    expect(screen.getAllByRole('button', { name: 'Опубликовать' })).toHaveLength(2)
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

    await user.click(await screen.findByRole('button', { name: 'Опубликовать' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: draft().id } },
      }),
    )
    await waitFor(() => expect(triggerSyncMock).toHaveBeenCalled())
    expect(await screen.findByText('Опубликовано в дневнике семьи')).toBeInTheDocument()
  })

  it('offers the first entry when there are no drafts', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    renderWithProviders(<JournalDraftsScreen />)

    expect(await screen.findByText('Черновиков нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новая запись' })).toBeInTheDocument()
  })
})
