import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, StoredJournalEntryImage, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { seedVersionOnePartition } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalScreen } from './journal-screen.tsx'

/** The entry as the wire carries it: photos name what their original is. */
type WireEntry = StoredJournalEntry & {
  images: Array<StoredJournalEntryImage & { originalType: string }>
}

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

function entry(overrides?: Partial<WireEntry>): WireEntry {
  return {
    id: `01900000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
    authorId: ME,
    title: 'Запись',
    text: 'Текст записи',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
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

function mockQuietSync(trash: unknown[] = []) {
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
    if (path === '/api/v1/journal/trash') {
      return {
        data: { entries: trash },
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

  it('groups the feed under sticky month labels, newest month first', async () => {
    const nextId = memberCounter()
    const september = entry({
      id: nextId(),
      title: 'Поход к Чёртову креслу',
      publishedAt: '2026-09-21T14:00:00.000Z',
    })
    const august = entry({
      id: nextId(),
      title: 'Мишке шесть!',
      publishedAt: '2026-08-30T14:00:00.000Z',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([august, september]))
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    // The prototype's month labels (diary.html): «Сентябрь 2026», then
    // «Август 2026», each once, before its month's cards.
    expect(await screen.findByText('Поход к Чёртову креслу')).toBeInTheDocument()
    expect(screen.getByText('Сентябрь 2026')).toBeInTheDocument()
    expect(screen.getByText('Август 2026')).toBeInTheDocument()
    const labels = screen
      .getAllByText(/2026$/)
      .filter((node) => node.textContent === 'Сентябрь 2026' || node.textContent === 'Август 2026')
    expect(labels).toHaveLength(2)
    expect(labels[0]?.textContent).toBe('Сентябрь 2026')
    // The September label precedes the August one and both precede no
    // card of a later month (the feed's own order is covered above).
    expect(labels[0]?.compareDocumentPosition(labels[1] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('carries the prototype meta row and the padded card (issue #69)', async () => {
    const photos = [
      {
        id: '01900000-0000-7000-8000-000000000201',
        state: 'ready' as const,
        originalType: 'image/jpeg',
      },
      {
        id: '01900000-0000-7000-8000-000000000202',
        state: 'ready' as const,
        originalType: 'image/jpeg',
      },
    ]
    const hike = entry({
      title: 'Поход к Чёртову креслу',
      text: '12 километров, черника у самой тропы.',
      publishedAt: '2026-09-21T14:00:00.000Z',
      images: photos,
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([hike]))
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Поход к Чёртову креслу')).toBeInTheDocument()
    // The one-line meta row (diary.html): author, then the day and the
    // photo count in one line — rendered uppercase by the meta styles.
    expect(screen.getByText('21 сентября · Фото ×2')).toBeInTheDocument()
    // The prototype's `.card.card-pad`: the card carries its own padding,
    // the content sets its rhythm.
    const card = screen.getByText('Поход к Чёртову креслу').closest('[data-slot="card"]')
    expect(card).toHaveAttribute('data-variant', 'padded')
    // The photo strip is full width with no per-photo counter — the count
    // lives in the meta row now.
    expect(screen.queryByText('Фото ×2', { exact: true })).not.toBeInTheDocument()
  })

  it('counts the trash on the corner row when the server has answered', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([entry()]))
    // The trash is online-only data (issue #16): the badge and the dated
    // line are the server's answer, never a local claim.
    mockQuietSync([
      {
        id: '01900000-0000-7000-8000-000000000301',
        authorId: DIMA,
        text: 'Чужая запись в корзине',
        previousState: 'published',
        trashedAt: '2026-10-01T10:15:00.000Z',
        purgeAt: '2026-10-31T10:15:00.000Z',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:15:00.000Z',
      },
      {
        id: '01900000-0000-7000-8000-000000000302',
        authorId: ME,
        title: 'Моя запись в корзине',
        text: 'Своя запись в корзине',
        previousState: 'draft',
        trashedAt: '2026-10-02T10:15:00.000Z',
        purgeAt: '2026-11-01T10:15:00.000Z',
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:15:00.000Z',
      },
    ])
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Запись')).toBeInTheDocument()
    // The sub line names the earliest permanent-deletion date, and the
    // prototype's count badge rides the trash row's title (diary.html).
    expect(await screen.findByText('записи удалятся окончательно 31 октября')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('keeps the generic trash line while the trash list has not answered', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([entry()]))
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
      // The trash request fails — the device is offline. No badge, no
      // date: the row says only what is always true.
      return {
        data: undefined,
        error: { error: { code: 'unreachable', message: 'Offline' } },
        response: new Response(null, { status: 503 }),
      }
    })
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Запись')).toBeInTheDocument()
    expect(screen.getByText('Корзина')).toBeInTheDocument()
    expect(
      screen.getByText('Удалённые записи ждут здесь до окончательного удаления.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^записи удалятся/)).not.toBeInTheDocument()
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
    // The prototype's empty state stands bare (issue #69): no card around
    // it, its button after the text.
    const title = screen.getByText('В дневнике пока пусто')
    expect(title.closest('[data-slot="card"]')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Написать первую запись' })
    expect(title.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('says nothing is downloaded while the upgrade replay has not landed', async () => {
    seedRegistry()
    // The device upgraded from a version 1 partition: the upgrade wrote
    // the replay promise (cursor '0', the journal named), and the read
    // answers it honestly (ADR-0014).
    await seedVersionOnePartition(ME, { id: SPACE_ID, name: 'Наша семья' })
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })

  it('hides the drafts corner while the journal replay is still owed', async () => {
    seedRegistry()
    const draft = entry({ title: 'Черновик', state: 'draft', publishedAt: undefined })
    // The owner hid the journal and re-showed it; the re-show delta carried
    // the author's draft while writing the replay promise (cursor '0',
    // ADR-0014). The row is real, but it is a fraction of the section.
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
            sections: { journal: false, calendar: true, wishlist: true },
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
        { entity: 'journal_entry', entry: draft },
      ],
      tombstones: [],
    })
    mockQuietSync()
    renderWithProviders(<JournalScreen />)

    // The feed column and the drafts corner say the same thing: without
    // the replay, nothing of the section is downloaded yet.
    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(screen.queryByText('Мои черновики')).not.toBeInTheDocument()
  })

  it('keeps the feed readable while another section replays', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([entry()]))
    // The owner hides and re-shows the calendar: the re-show writes the
    // replay promise (cursor '0') but leaves the journal's rows alone.
    await applySyncResult(ME, {
      revision: '8',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: true, calendar: false, wishlist: true },
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
    renderWithProviders(<JournalScreen />)

    // The stored entries are real (the server filtered them): they stay
    // readable while the cursor still says '0'.
    expect(await screen.findByText('Запись')).toBeInTheDocument()
    expect(screen.queryByText('Пока нечего читать без сети')).not.toBeInTheDocument()
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
