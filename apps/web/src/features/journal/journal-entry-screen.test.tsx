import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, StoredJournalEntryImage, SyncResult } from '@/data/local-store.ts'
import { applySyncResult, readMemberSnapshot } from '@/data/local-store.ts'
import { seedVersionOnePartition } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { toastManager } from '@/ui/toast.tsx'
import { JournalEntryScreen } from './journal-entry-screen.tsx'

/** The entry as the wire carries it: photos name what their original is. */
type WireEntry = StoredJournalEntry & {
  images: Array<StoredJournalEntryImage & { originalType: string }>
}

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

function entry(): WireEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Поход к Чёртову креслу',
    text: 'Вид стоит каждого шага.',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
    images: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
  }
}

function olderEntry(): WireEntry {
  return {
    id: '01900000-0000-7000-8000-000000000102',
    authorId: ME,
    title: 'Вареники с бабушкой',
    text: 'Тесто как у мамы.',
    state: 'published',
    publishedAt: '2026-09-14T10:00:00.000Z',
    images: [],
    createdAt: '2026-09-14T09:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
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

function syncResult(entries: WireEntry[]): SyncResult {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

afterEach(async () => {
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('JournalEntryScreen', () => {
  it('renders the entry with its author, and the author edits from the top-bar menu (issue #70)', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(
      await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Вид стоит каждого шага.')).toBeInTheDocument()
    // The menu is the top bar's overflow button (the prototype's
    // data-topbar-actions, every width); the meta row carries no buttons.
    const menu = await screen.findByRole('button', { name: 'Меню записи' })
    await user.click(menu)
    expect(await screen.findByRole('menuitem', { name: 'Редактировать' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Поделиться…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Скопировать ссылку' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Удалить запись' })).toBeInTheDocument()
  })

  it('offers the share and the copy to a member who may not act, delete to one who may', async () => {
    seedRegistry()
    // Дима's published entry: Аня is the space's owner, so the removal is
    // hers to offer — but the edit is not.
    const row = { ...entry(), authorId: '01900000-0000-7000-8000-000000000002' }
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' })
    await user.click(await screen.findByRole('button', { name: 'Меню записи' }))
    expect(await screen.findByRole('menuitem', { name: 'Поделиться…' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Скопировать ссылку' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Удалить запись' })).toBeInTheDocument()
  })

  it('copies the entry link and says so', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    // The user-event setup stubs the clipboard itself; the mock replaces
    // it, the way the invite screen's tests pin their copy.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    await user.click(await screen.findByRole('button', { name: 'Меню записи' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Скопировать ссылку' }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/journal/${row.id}`)
    expect(await screen.findByText('Ссылка на запись скопирована')).toBeInTheDocument()
  })

  it('shares through the platform where there is a sheet, and copies where there is not', async () => {
    seedRegistry()
    const row = entry()
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
    const user = userEvent.setup()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    const openShare = async () => {
      await user.click(await screen.findByRole('button', { name: 'Меню записи' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Поделиться…' }))
    }

    await openShare()
    // The sheet carries the entry's address; no toast doubles it.
    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledWith({
        title: 'Поход к Чёртову креслу',
        url: `${window.location.origin}/journal/${row.id}`,
      })
    })
    expect(screen.queryByText('Ссылка на запись скопирована')).not.toBeInTheDocument()

    // Without the API at all the share lands on the clipboard instead.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    delete (window.navigator as { share?: unknown }).share
    await openShare()
    expect(await screen.findByText('Ссылка на запись скопирована')).toBeInTheDocument()

    // The user's own cancel of a sheet is not a failure to report.
    const cancelled = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'))
    Object.defineProperty(window.navigator, 'share', {
      value: cancelled,
      configurable: true,
    })
    await openShare()
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
    expect(screen.getAllByText('Ссылка на запись скопирована')).toHaveLength(1)
  })

  it("names the feed's next entry in the footer, and omits the line from the feed's last", async () => {
    seedRegistry()
    const row = entry()
    const older = olderEntry()
    await applySyncResult(ME, syncResult([row, older]))
    mockQuietSync()
    // The feed reads newest first: the entry from the 21st is followed by
    // the one from the 14th.
    const first = renderWithProviders(<JournalEntryScreen entryId={row.id} />)
    expect(await screen.findByText(/Следующая: «Вареники с бабушкой»/)).toBeInTheDocument()
    first.unmount()

    // From the feed's last entry there is no next, and the line is gone.
    renderWithProviders(<JournalEntryScreen entryId={older.id} />)
    await screen.findByRole('heading', { name: 'Вареники с бабушкой' })
    expect(screen.queryByText(/Следующая:/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Все записи' })).toBeInTheDocument()
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
    // And the top bar carries no menu: share and copy would hand out the
    // address of an entry the partition says is not there.
    expect(screen.queryByRole('button', { name: 'Меню записи' })).not.toBeInTheDocument()
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
    // The precondition is the promise: without it the test would only pin
    // that a stored entry shows.
    expect((await readMemberSnapshot(ME)).pendingReplay).toEqual(['journal'])
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

  it('shows the photo gallery and opens the lightbox on a tap (issue #17)', async () => {
    seedRegistry()
    // jsdom has no blob store and no layout engine; the photo bytes are a
    // blob the test hands out, the way the API would.
    URL.createObjectURL = vi.fn(() => 'blob:photo-preview')
    URL.revokeObjectURL = vi.fn()
    // A fresh response per call: a Response's body can be read once.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(new Blob(['bytes']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const row = {
      ...entry(),
      images: [
        {
          id: '01900000-0000-7000-8000-000000000201',
          state: 'ready' as const,
          width: 800,
          height: 600,
          originalType: 'image/jpeg',
        },
      ],
    }
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(
      await screen.findByRole('heading', { name: 'Поход к Чёртову креслу' }),
    ).toBeInTheDocument()
    // The pill counts the photos; the gallery asks for the feed preview.
    expect(screen.getByText('Фото ×1')).toBeInTheDocument()
    const photo = await screen.findByRole('button', { name: 'Фото 1 из 1' })
    const feedUrl =
      '/api/v1/journal/entries/' +
      row.id +
      '/images/01900000-0000-7000-8000-000000000201/variants/feed'
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === feedUrl)).toBe(true)
    })

    // The tap opens the lightbox on the viewer derivative, upgrading to
    // the original. The caption is two-sided: the entry names the photo
    // on the left, the original's state sits on the right.
    await photo.click()
    const fullUrl = feedUrl.replace('/feed', '/full')
    const originalUrl = feedUrl.replace('/feed', '/original')
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === fullUrl)).toBe(true)
      expect(fetchMock.mock.calls.some(([url]) => url === originalUrl)).toBe(true)
    })
    const caption = await screen.findByText(/Поход к Чёртову креслу · 21 сентября/)
    expect(caption).toBeInTheDocument()
    expect(await screen.findByText('Оригинал', { exact: true })).toBeInTheDocument()

    // Esc closes, and the focus comes back to the tile that opened it.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Закрыть' }), {
      key: 'Escape',
    })
    await vi.waitFor(() => {
      expect(screen.queryByText('Оригинал', { exact: true })).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(photo)
  })

  it('closes on a press on the scrim and keeps a press on the photo', async () => {
    seedRegistry()
    URL.createObjectURL = vi.fn(() => 'blob:photo-preview')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(new Blob(['bytes']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const row = {
      ...entry(),
      images: [
        {
          id: '01900000-0000-7000-8000-000000000204',
          state: 'ready' as const,
          width: 800,
          height: 600,
          originalType: 'image/jpeg',
        },
      ],
    }
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    const user = userEvent.setup()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    const openViewer = async () => {
      await user.click(await screen.findByRole('button', { name: 'Фото 1 из 1' }))
      return screen.findByRole('dialog', { name: /Поход к Чёртову креслу · 21 сентября/ })
    }

    // The popup fills the viewport, so a press on the visible scrim is a
    // press on the popup's own padding — the lightbox must read it as the
    // scrim's dismiss.
    let viewer = await openViewer()
    fireEvent.click(viewer)
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // The photo's own press keeps the viewer open, whatever the bubble.
    viewer = await openViewer()
    fireEvent.click(within(viewer).getByRole('img'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // And the round glass X still dismisses, like the prototype's.
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('offers a HEIC original as a download instead of undisplayable bytes', async () => {
    seedRegistry()
    URL.createObjectURL = vi.fn(() => `blob:photo-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
    // A fresh response per call: a Response's body can be read once.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(new Blob(['bytes']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const row = {
      ...entry(),
      images: [
        {
          id: '01900000-0000-7000-8000-000000000203',
          state: 'ready' as const,
          width: 800,
          height: 600,
          originalType: 'image/heic',
        },
      ],
    }
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    const photo = await screen.findByRole('button', { name: 'Фото 1 из 1' })
    await photo.click()

    // The original's bytes are never fetched on open: the viewer
    // derivative is what shows, and the HEIC goes through the explicit
    // download, named for its id.
    await screen.findByText('Скачать оригинал')
    const imageId = '01900000-0000-7000-8000-000000000203'
    const originalUrl = `/api/v1/journal/entries/${row.id}/images/${imageId}/variants/original`
    expect(fetchMock.mock.calls.some(([url]) => url === originalUrl)).toBe(false)

    await screen.getByText('Скачать оригинал').click()
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === originalUrl)).toBe(true)
    })
    expect(URL.createObjectURL).toHaveBeenCalled()
    // The blob outlives the click on purpose: revoking it in the same tick
    // fails the save on WebKit, which resolves the download afterwards.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    // A refused download names the API's answer instead of doing nothing.
    // Base UI's toasts do not paint in jsdom; the manager's queue is what
    // the assertion can honestly pin.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'image_not_found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    // The pending download disables the button; only its end re-enables it.
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Скачать оригинал' })).toBeEnabled()
    })
    const addToast = vi.spyOn(toastManager, 'add')
    fireEvent.click(screen.getByRole('button', { name: 'Скачать оригинал' }))
    await vi.waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Фотография не найдена.' }),
      )
    })
    addToast.mockRestore()
  })

  it('shows the processing placeholder of a photo the worker has not finished', async () => {
    seedRegistry()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const row = {
      ...entry(),
      images: [
        {
          id: '01900000-0000-7000-8000-000000000202',
          state: 'processing' as const,
          originalType: 'image/jpeg',
        },
      ],
    }
    await applySyncResult(ME, syncResult([row]))
    mockQuietSync()
    renderWithProviders(<JournalEntryScreen entryId={row.id} />)

    expect(await screen.findByRole('status', { name: 'Фото обрабатывается' })).toBeInTheDocument()
    // And no byte was asked for: there is no derivative yet.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
