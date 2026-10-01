import { screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { seedVersionOnePartition } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalEntryScreen } from './journal-entry-screen.tsx'

/*
 * One entry (issue #15): the deep link answers from the synchronised
 * partition, so it reads the same online and offline — and it says what
 * the device can honestly say while a replay promise (cursor '0',
 * ADR-0014) is still open, instead of calling an entry it cannot see
 * missing.
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

const apiGet = vi.mocked(api.GET)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const MISSING = '01900000-0000-7000-8000-000000000fff'

function entry(): StoredJournalEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Поход к Чёртову креслу',
    text: 'Вид стоит каждого шага.',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
  }
}

function spaceChange(sections: { journal: boolean; calendar: boolean; wishlist: boolean }) {
  return {
    entity: 'space' as const,
    space: {
      id: SPACE_ID,
      name: 'Наша семья',
      timezone: 'Europe/Moscow',
      sections,
    },
  }
}

function syncResult(entries: StoredJournalEntry[]): SyncResult {
  return {
    revision: '7',
    changes: [
      spaceChange({ journal: true, calendar: true, wishlist: true }),
      ...entries.map((row) => ({ entity: 'journal_entry' as const, entry: row })),
    ],
    tombstones: [],
  }
}

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      { memberId: ME, spaceId: SPACE_ID, spaceName: 'Наша семья', name: 'Аня', displayName: 'Аня' },
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

describe('JournalEntryScreen', () => {
  it('renders the entry with its author and edit affordance', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(
      await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Вид стоит каждого шага.')).toBeInTheDocument()
    // The author's own entry offers the edit.
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeInTheDocument()
  })

  it('says the entry is missing under a cursor that has read the journal', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={MISSING} />)

    expect(await screen.findByText('Записи нет')).toBeInTheDocument()
    expect(
      screen.getByText('Возможно, она удалена или ещё не успела синхронизироваться.'),
    ).toBeInTheDocument()
  })

  it('says nothing is downloaded while the journal replay has not landed', async () => {
    seedRegistry()
    // The device upgraded from a version 1 partition: the upgrade wrote
    // the replay promise (cursor '0', the journal named), and the read
    // answers it honestly (ADR-0014).
    await seedVersionOnePartition(ME, { id: SPACE_ID, name: 'Наша семья' })
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={entry().id} />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(screen.queryByText('Записи нет')).not.toBeInTheDocument()
  })

  it('shows the entry it holds even while the journal replay is owed', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    // The journal hides (the rows go), re-shows, and the re-show's delta
    // carries an entry published meanwhile — the replay itself has not
    // landed. A held row is real; the screen shows it.
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
    await applySyncResult(
      ME,
      {
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
          { entity: 'journal_entry', entry: row },
        ],
        tombstones: [],
      },
      '8',
    )
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(
      await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Пока нечего читать без сети')).not.toBeInTheDocument()
  })

  it('reads the stored entry while another section replays', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    // The calendar is hidden and re-shown: the replay promise names the
    // calendar, and the journal's stored rows stay readable.
    await applySyncResult(ME, {
      revision: '8',
      changes: [spaceChange({ journal: true, calendar: false, wishlist: true })],
      tombstones: [],
    })
    await applySyncResult(ME, {
      revision: '9',
      changes: [spaceChange({ journal: true, calendar: true, wishlist: true })],
      tombstones: [],
    })
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(
      await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Пока нечего читать без сети')).not.toBeInTheDocument()
  })
})
