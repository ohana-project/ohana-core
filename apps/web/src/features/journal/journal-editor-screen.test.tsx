import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, StoredJournalEntryImage, SyncResult } from '@/data/local-store.ts'
import { applySyncResult, readMemberSnapshot } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { FakeUploadRequest } from '@/testing/fake-upload.ts'
import { seedVersionOnePartition } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalEditorScreen } from './journal-editor-screen.tsx'

/** The entry as the wire carries it: photos name what their original is. */
type WireEntry = StoredJournalEntry & {
  images: Array<StoredJournalEntryImage & { originalType: string }>
}

/*
 * The editor (issue #15): a new entry starts as a draft and the author can
 * publish it from here; a published entry keeps its state through the edit
 * and offers no way back to draft. Mutations go to the API; settling
 * triggers the sync instead of patching the store by hand.
 *
 * The design parity (issue #71, docs/design/screens/diary-editor.html) is
 * pinned below in its own block: jsdom has no layout, so the prototype's
 * geometry lives in the classes — the same pin the shared ActionBar's
 * test uses — and the clock is pinned to UTC so the saved moment reads
 * the same everywhere.
 */

process.env.TZ = 'UTC'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
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
const apiPut = vi.mocked(api.PUT)
const triggerSyncMock = vi.mocked(triggerSync)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

/**
 * The desktop pair lives in the top bar; the same primary rides the
 * phone's action bar, so publish/save queries scope themselves to the
 * top bar (issue #71).
 */
function topBar() {
  return within(document.querySelector('[data-slot="topbar"]') as HTMLElement)
}

function draft(overrides?: Partial<WireEntry>): WireEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Черновик',
    text: 'Черновой текст',
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
      { memberId: ME, spaceId: SPACE_ID, spaceName: 'Наша семья', name: 'Аня', displayName: 'Аня' },
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

describe('JournalEditorScreen (a new entry)', () => {
  it('creates the draft and publishes it in one submit', async () => {
    seedRegistry()
    const created = draft({ title: 'Осенний пикник', text: 'Собрались за час.' })
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries') {
        return {
          data: created,
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      if (path === '/api/v1/journal/entries/{entryId}/publish') {
        return {
          data: { ...created, state: 'published', publishedAt: '2026-10-01T09:00:00.000Z' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Заголовок'), 'Осенний пикник')
    await user.type(await screen.findByLabelText('Текст записи'), 'Собрались за час.')
    await user.click(topBar().getByRole('button', { name: 'Опубликовать' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries', {
        body: { title: 'Осенний пикник', text: 'Собрались за час.' },
      }),
    )
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: created.id } },
      }),
    )
    await waitFor(() => expect(triggerSyncMock).toHaveBeenCalled())
  })

  it('saves only a draft when the author asks for a draft', async () => {
    seedRegistry()
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries') {
        return {
          data: draft({ title: undefined, text: 'Только текст' }),
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Текст записи'), 'Только текст')
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries', {
        body: { title: undefined, text: 'Только текст' },
      }),
    )
    expect(apiPost).not.toHaveBeenCalledWith(
      '/api/v1/journal/entries/{entryId}/publish',
      expect.anything(),
    )
    expect(await screen.findByText('Черновик сохранён — виден только вам')).toBeInTheDocument()
  })

  it('refuses to submit while the text is blank', async () => {
    seedRegistry()
    renderWithProviders(<JournalEditorScreen />)
    // The top bar exists once the shell's session status settles.
    await screen.findByLabelText('Заголовок')
    expect(topBar().getByRole('button', { name: 'Опубликовать' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить черновик' })).toBeDisabled()
    expect(apiPost).not.toHaveBeenCalled()
    // The editor's first paint is not an accusation: the blank-text error
    // waits for the first edit.
    expect(screen.queryByText('Добавьте текст записи')).not.toBeInTheDocument()
  })

  it('a failed publish keeps the created entry, so the retry makes no second draft', async () => {
    seedRegistry()
    const created = draft({ title: 'Пикник', text: 'Собрались за час.' })
    let creates = 0
    let publishes = 0
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries') {
        creates += 1
        return {
          data: created,
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      if (path === '/api/v1/journal/entries/{entryId}/publish') {
        publishes += 1
        return {
          data: undefined,
          error: { error: { code: 'entry_already_published', message: 'Already shared' } },
          response: new Response(null, { status: 409 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    apiPut.mockImplementation(async (path: '/api/v1/journal/entries/{entryId}') => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: created,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Заголовок'), 'Пикник')
    await user.type(await screen.findByLabelText('Текст записи'), 'Собрались за час.')
    await user.click(topBar().getByRole('button', { name: 'Опубликовать' }))

    // The create landed, the publish refused, and the editor stays on the
    // entry it made instead of pretending nothing happened.
    await waitFor(() => expect(publishes).toBe(1))
    await waitFor(() =>
      expect(screen.getByText('Эта запись уже опубликована.')).toBeInTheDocument(),
    )

    // The retry edits the created entry and publishes it — one draft, ever.
    await user.click(topBar().getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}', {
        params: { path: { entryId: created.id } },
        body: { title: 'Пикник', text: 'Собрались за час.' },
      }),
    )
    await waitFor(() => expect(publishes).toBe(2))
    expect(creates).toBe(1)
  })
})

describe('JournalEditorScreen (editing an entry)', () => {
  it('starts from the stored draft and keeps the draft state on save', async () => {
    seedRegistry()
    const existing = draft()
    await applySyncResult(ME, syncResult([existing]))
    apiPut.mockImplementation(async (path: '/api/v1/journal/entries/{entryId}') => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: { ...existing, text: 'Исправленный текст' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    const titleField = await screen.findByLabelText('Заголовок')
    expect(titleField).toHaveValue('Черновик')

    await user.clear(screen.getByLabelText('Текст записи'))
    await user.type(screen.getByLabelText('Текст записи'), 'Исправленный текст')
    await user.click(topBar().getByRole('button', { name: 'Опубликовать' }))

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}', {
        params: { path: { entryId: existing.id } },
        body: { title: 'Черновик', text: 'Исправленный текст' },
      }),
    )
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: existing.id } },
      }),
    )
  })

  it('a published entry edits without offering a draft state', async () => {
    seedRegistry()
    const published = draft({
      state: 'published',
      publishedAt: '2026-09-21T15:00:00.000Z',
      updatedAt: '2026-09-21T15:00:00.000Z',
    })
    await applySyncResult(ME, syncResult([published]))
    apiPut.mockImplementation(async () => ({
      data: published,
      error: undefined,
      response: new Response(null, { status: 200 }),
    }))
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={published.id} />)

    expect(await screen.findByText('опубликовано')).toBeInTheDocument()
    // No unpublish: the save is the only action for a published entry.
    expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).not.toBeInTheDocument()
    expect(topBar().getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()

    await user.click(topBar().getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalled())
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('says so when the entry is not on this device', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    renderWithProviders(<JournalEditorScreen entryId="01900000-0000-7000-8000-000000000fff" />)

    expect(
      await screen.findByText('Запись не найдена или ещё не синхронизировалась.'),
    ).toBeInTheDocument()
  })

  it('says that nothing is downloaded instead of claiming the entry is gone', async () => {
    seedRegistry()
    renderWithProviders(<JournalEditorScreen entryId="01900000-0000-7000-8000-000000000fff" />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })

  it('edits the draft it holds even while the journal replay is owed', async () => {
    seedRegistry()
    const existing = draft()
    await applySyncResult(ME, syncResult([existing]))
    // The journal hides, re-shows, and the re-show's delta carries the
    // draft again — the replay itself has not landed. A held row is real.
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
          { entity: 'journal_entry', entry: { ...existing, images: existing.images ?? [] } },
        ],
        tombstones: [],
      },
      '8',
    )
    // The precondition is the promise: without it the test would only pin
    // that a stored draft opens.
    expect((await readMemberSnapshot(ME)).pendingReplay).toEqual(['journal'])
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    const titleField = await screen.findByLabelText('Заголовок')
    expect(titleField).toHaveValue('Черновик')
    expect(topBar().getByRole('button', { name: 'Опубликовать' })).toBeEnabled()
  })

  it('says nothing is downloaded while the journal replay has not landed', async () => {
    seedRegistry()
    // The device upgraded from a version 1 partition: the upgrade wrote
    // the replay promise (cursor '0', the journal named), and the read
    // answers it honestly (ADR-0014).
    await seedVersionOnePartition(ME, { id: SPACE_ID, name: 'Наша семья' })
    renderWithProviders(<JournalEditorScreen entryId="01900000-0000-7000-8000-000000000101" />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(
      screen.queryByText('Запись не найдена или ещё не синхронизировалась.'),
    ).not.toBeInTheDocument()
  })

  it('a refused edit still triggers the sync, so a stale row clears itself', async () => {
    seedRegistry()
    const existing = draft()
    await applySyncResult(ME, syncResult([existing]))
    apiPut.mockImplementation(async (path: '/api/v1/journal/entries/{entryId}') => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: undefined,
          error: { error: { code: 'entry_not_found', message: 'Removed elsewhere' } },
          response: new Response(null, { status: 404 }),
        }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    await user.clear(await screen.findByLabelText('Текст записи'))
    await user.type(screen.getByLabelText('Текст записи'), 'Исправленный текст')
    await user.click(topBar().getByRole('button', { name: 'Опубликовать' }))

    expect(
      await screen.findByText('Запись не найдена или ещё не синхронизировалась.'),
    ).toBeInTheDocument()
    // The refusal is what carries the refresh: the sync ran although
    // nothing succeeded.
    expect(triggerSyncMock).toHaveBeenCalledTimes(1)
  })

  it('a refused create still triggers the sync', async () => {
    // section_hidden is the stale sections map answering: the sync is what
    // brings the new map down.
    seedRegistry()
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries') {
        return {
          data: undefined,
          error: { error: { code: 'section_hidden', message: 'Hidden meanwhile' } },
          response: new Response(null, { status: 404 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Текст записи'), 'Текст новой записи')
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))

    expect(await screen.findByText('Раздел скрыт владельцем пространства.')).toBeInTheDocument()
    expect(triggerSyncMock).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it('does not open another member’s entry for editing', async () => {
    seedRegistry()
    const someoneElses = draft({
      authorId: '01900000-0000-7000-8000-000000000009',
      title: 'Чужое',
      text: 'Не моё',
    })
    await applySyncResult(ME, syncResult([someoneElses]))
    renderWithProviders(<JournalEditorScreen entryId={someoneElses.id} />)

    // The route is reachable by URL; the editor refuses before typing into
    // a form the API would turn away with author_required.
    expect(await screen.findByText('Запись может изменить только её автор.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Текст записи')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).not.toBeInTheDocument()
  })
})

describe('JournalEditorScreen (photos, issue #17)', () => {
  beforeEach(() => {
    // jsdom has no blob store; the uploads only need a stable fake handle.
    URL.createObjectURL = vi.fn(() => 'blob:pending-photo')
    URL.revokeObjectURL = vi.fn()
    FakeUploadRequest.instances = []
  })

  it('attaches a picked photo to the saved draft through the API', async () => {
    seedRegistry()
    const row = draft()
    await applySyncResult(ME, syncResult([row]))
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={row.id} />)

    const picker = await filePicker()
    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' })
    await user.upload(picker, file)

    await waitFor(() => {
      const request = FakeUploadRequest.instances.at(-1)
      expect(request?.url).toBe(`/api/v1/journal/entries/${row.id}/images`)
      expect(request?.method).toBe('POST')
      expect(request?.body?.get('file')).toBeInstanceOf(File)
      expect(request?.headers['x-ohana-member']).toBe(ME)
    })
    FakeUploadRequest.instances.at(-1)?.respond(201, {
      id: '01900000-0000-7000-8000-000000000301',
      state: 'processing',
    })
    // The entry with its photo arrives through the sync, as always.
    await waitFor(() => expect(triggerSyncMock).toHaveBeenCalled())
    // The picker is cleared, so the same file can be chosen again.
    expect((picker as HTMLInputElement).value).toBe('')
  })

  it('refuses a photo while the new entry has no text to hold a draft', async () => {
    seedRegistry()
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.upload(await filePicker(), new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))

    // The field says it and the toast repeats it: no draft holds the photo.
    await screen.findAllByText('Добавьте текст записи')
    expect(FakeUploadRequest.instances).toHaveLength(0)
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('creates the draft first when photos are picked on a not-yet-saved entry', async () => {
    seedRegistry()
    const created = draft({ text: 'Собрались за час.' })
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries') {
        return { data: created, error: undefined, response: new Response(null, { status: 201 }) }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Текст записи'), 'Собрались за час.')
    await user.upload(await filePicker(), new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/journal/entries', {
        body: { title: undefined, text: 'Собрались за час.' },
      }),
    )
    await waitFor(() => {
      const request = FakeUploadRequest.instances.at(-1)
      expect(request?.url).toBe(`/api/v1/journal/entries/${created.id}/images`)
    })
  })
})

/** The hidden picker input: the attach tile's button is its only
 *  accessible control (issue #71), so the tests reach the input through it. */
async function filePicker(): Promise<HTMLInputElement> {
  const tile = await screen.findByRole('button', { name: 'Добавить' })
  const input = tile.querySelector('input[type="file"]')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

/*
 * The editor's design parity (issue #71, docs/design/screens/diary-editor.html):
 * the borderless serif title and the 16px/1.65 body with their sr-only
 * labels, the rule between them, the save pair riding the top bar on
 * desktop and the shared action bar on phones, and the photo grid's
 * prototype geometry. jsdom has no layout, so the prototype's values
 * live in the classes — the same pin the shared ActionBar's test uses.
 */
describe('JournalEditorScreen (design parity, issue #71)', () => {
  it('writes on the prototype’s borderless fields, their labels kept for assistive technology', async () => {
    seedRegistry()
    renderWithProviders(<JournalEditorScreen />)

    // The prototype's .editor-title: the h1 step in the display face —
    // 24px serif — with no border, box or visible label.
    const title = await screen.findByLabelText('Заголовок')
    expect(title).toHaveClass('border-0', 'bg-transparent', 'p-0', 'font-display', 'text-h1')
    expect(document.querySelector('label[for="journal-entry-title"]')).toHaveClass('sr-only')

    // The rule the prototype draws between the title and the text.
    expect(document.querySelector('[data-slot="separator"]')).toBeInTheDocument()

    // The prototype's .editor-text: 16px/1.65, no border, no resize.
    const text = screen.getByLabelText('Текст записи')
    expect(text).toHaveClass(
      'border-0',
      'bg-transparent',
      'p-0',
      'text-[16px]',
      'leading-[1.65]',
      'min-h-[200px]',
      'resize-none',
    )
    expect(document.querySelector('label[for="journal-entry-text"]')).toHaveClass('sr-only')
  })

  it('carries the save pair in the top bar on desktop and in the action bar on phones', async () => {
    seedRegistry()
    renderWithProviders(<JournalEditorScreen />)
    await screen.findByLabelText('Заголовок')

    // From 920px up: the prototype's d-only small pair in the top bar.
    expect(topBar().getByRole('button', { name: 'Сохранить черновик' })).toHaveClass('min-h-9')
    expect(topBar().getByRole('button', { name: 'Опубликовать' })).toHaveClass('min-h-9')
    // Below it: the same two in the shared action bar, the primary grown
    // to the remaining width (the prototype's flex:1), the label the
    // prototype's bar carries.
    const bar = document.querySelector('[data-slot="action-bar"]')
    expect(bar).not.toBeNull()
    const barPublish = within(bar as HTMLElement).getByRole('button', { name: 'Опубликовать' })
    expect(barPublish).toHaveClass('flex-1', 'min-w-0')
    expect(within(bar as HTMLElement).getByRole('button', { name: 'В черновики' })).toHaveClass(
      'min-h-11',
    )
  })

  it('shows the saved moment and the photo/character counts the data fills', async () => {
    seedRegistry()
    const existing = draft({ text: 'Черновой текст' })
    await applySyncResult(ME, syncResult([existing]))
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    // The stored entry carries its last edit: the prototype's
    // «СОХРАНЕНО 19:02» over the real updatedAt (pinned to UTC).
    expect(await screen.findAllByText('Сохранено 14:00')).toHaveLength(2)
    // The prototype's «ФОТО: 2 · СИМВОЛОВ: 342» line over the live data —
    // fourteen characters typed, no photos yet.
    expect(screen.getByText('Фото: 0 · Символов: 14')).toBeInTheDocument()
  })

  it('a new entry has no saved moment to show and shows none', async () => {
    seedRegistry()
    renderWithProviders(<JournalEditorScreen />)

    // Nothing is stored yet: no indicator may pretend otherwise (the
    // absence is recorded in docs/design/README.md).
    await screen.findByText('Фото: 0 · Символов: 0')
    expect(screen.queryByText(/Сохранено/)).not.toBeInTheDocument()
  })

  it('lays the photos out as the prototype’s four-column grid with its controls', async () => {
    seedRegistry()
    const image: StoredJournalEntryImage & { originalType: string } = {
      id: '01900000-0000-7000-8000-000000000301',
      state: 'ready',
      originalType: 'image/jpeg',
    }
    const row = draft({ images: [image] })
    await applySyncResult(ME, syncResult([row]))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Blob(['bytes']), { status: 200 })),
    )
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    renderWithProviders(<JournalEditorScreen entryId={row.id} />)

    // Four columns at every width (the prototype's inline repeat(4,1fr)
    // — the build's `tablet:` variant never existed and made no rule),
    // 8px gaps, and the remove control the prototype's 26px round.
    const remove = await screen.findByRole('button', { name: 'Убрать фото' })
    const grid = remove.closest('.grid-cols-4')
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-4', 'gap-2')
    expect(remove).toHaveClass('size-6.5')

    // The attach tile: dashed 1.5px, the 22px camera icon.
    const tile = screen.getByRole('button', { name: 'Добавить' })
    expect(tile).toHaveClass('border-dashed')
    expect(tile.className).toContain('border-[1.5px]')
    expect(tile.querySelector('svg')).toHaveClass('size-[22px]')
  })

  it('rings the upload with its percentage while the bytes travel', async () => {
    seedRegistry()
    const row = draft()
    await applySyncResult(ME, syncResult([row]))
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)
    URL.createObjectURL = vi.fn(() => 'blob:pending')
    URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={row.id} />)

    await user.upload(
      await filePicker(),
      new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' }),
    )
    // The placeholder chip shows the ring at its start…
    expect(await screen.findByText('0%')).toBeInTheDocument()
    // …and the percentage follows the bytes really sent.
    FakeUploadRequest.instances.at(-1)?.upload.onprogress?.({
      lengthComputable: true,
      loaded: 55,
      total: 100,
    })
    await screen.findByText('55%')
    // The ring announces itself, not just its picture.
    expect(screen.getByRole('status', { name: 'Фото загружается…' })).toBeInTheDocument()
  })
})
