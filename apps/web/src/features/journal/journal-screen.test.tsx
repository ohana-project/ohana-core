import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalScreen } from './journal-screen.tsx'

/*
 * The shared feed (issue #15): published entries newest first, every card
 * naming its author, paginated for reading; the drafts corner counts the
 * member's own drafts. Everything reads the local store, so the same
 * render answers offline — the sync in these tests answers with nothing
 * new and the assertions run against the seeded partition.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  // The feed's cards and the drafts row are links; the tests decide by text.
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

function memberCounter(): () => string {
  let next = 0
  return () => `01900000-0000-7000-8000-${String(++next).padStart(12, '0')}`
}

function entry(overrides?: Partial<StoredJournalEntry>): StoredJournalEntry {
  return {
    id: `01900000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
    authorId: ME,
    title: 'Запись',
    text: 'Текст записи',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
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
      {
        entity: 'member',
        member: { id: DIMA, name: 'Дима', role: 'regular', createdAt: '2026-08-14T10:00:00.000Z' },
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

describe('JournalScreen (the shared feed)', () => {
  it('renders published entries newest first with author attribution', async () => {
    const nextId = memberCounter()
    const older = entry({
      id: nextId(),
      authorId: DIMA,
      title: 'Вареники с бабушкой',
      text: 'Тесто как у мамы, вчера получилось с первого раза.',
      publishedAt: '2026-09-14T14:00:00.000Z',
    })
    const newer = entry({
      id: nextId(),
      title: 'Поход к Чёртову креслу',
      text: 'Вид стоит каждого шага.',
      publishedAt: '2026-09-21T14:00:00.000Z',
    })
    const draft = entry({
      id: nextId(),
      title: 'Черновик',
      text: 'Никому не показан',
      state: 'draft',
      publishedAt: undefined,
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([older, newer, draft]))
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Поход к Чёртову креслу')).toBeInTheDocument()
    // Newest first; the aside's heading is the section's, not a card's.
    const cards = screen.getAllByRole('heading').filter((heading) => heading.tagName === 'H3')
    expect(cards.map((card) => card.textContent)).toEqual([
      'Поход к Чёртову креслу',
      'Вареники с бабушкой',
    ])
    // The author's display name from the synced profiles, and Дима's name.
    expect(screen.getAllByText('Аня Смирнова').length).toBeGreaterThan(0)
    expect(screen.getByText('Дима')).toBeInTheDocument()
    // The author's draft is on this device, but never in the feed.
    expect(screen.queryByText('Черновик')).not.toBeInTheDocument()
    // The drafts corner counts it.
    expect(screen.getByText('Мои черновики')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('pages the feed twenty entries at a time', async () => {
    const nextId = memberCounter()
    const many = Array.from({ length: 25 }, (_, index) =>
      entry({
        id: nextId(),
        title: `Запись ${index + 1}`,
        text: `Текст ${index + 1}`,
        publishedAt: new Date(
          Date.parse('2026-09-01T10:00:00.000Z') + index * 60_000,
        ).toISOString(),
      }),
    )
    seedRegistry()
    await applySyncResult(ME, syncResult(many))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Запись 25')).toBeInTheDocument()
    expect(screen.queryByText('Запись 5')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Показать ещё' }))

    await waitFor(() => expect(screen.getByText('Запись 5')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('says that nothing is available offline when nothing is downloaded', async () => {
    seedRegistry()
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })

  it('offers the first entry when the space simply has none yet', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('В дневнике пока пусто')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Написать первую запись' })).toBeInTheDocument()
  })

  it('says nothing is downloaded while the upgrade replay has not landed', async () => {
    seedRegistry()
    // A store upgrade wrote the replay promise: cursor '0', entries store
    // not filled yet. "The journal is empty" would be a claim the device
    // cannot make (ADR-0014).
    await applySyncResult(ME, {
      revision: '0',
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
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })

  it('says the section is hidden instead of showing a feed for it', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([entry()]))
    // The owner hides the journal: the map lands with the next sync and
    // the client drops the section's rows in the same apply (ADR-0011).
    await applySyncResult(ME, {
      revision: '8',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: false, calendar: true, wishlist: true },
          },
        },
      ],
      tombstones: [],
    })
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    // The shell answers a direct URL or a stale tab with the hidden state,
    // not with an empty feed, and offers no way to write into a hidden
    // section.
    expect(await screen.findByText('Раздел скрыт владельцем пространства.')).toBeInTheDocument()
    expect(screen.getByText(/Ничего не удалено/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Новая запись' })).not.toBeInTheDocument()
  })
})
