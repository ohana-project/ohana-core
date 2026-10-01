import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredJournalEntry, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { JournalEditorScreen } from './journal-editor-screen.tsx'

/*
 * The editor (issue #15): a new entry starts as a draft and the author can
 * publish it from here; a published entry keeps its state through the edit
 * and offers no way back to draft. Mutations go to the API; settling
 * triggers the sync instead of patching the store by hand.
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
const apiPatch = vi.mocked(api.PATCH)
const triggerSyncMock = vi.mocked(triggerSync)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function draft(overrides?: Partial<StoredJournalEntry>): StoredJournalEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ME,
    title: 'Черновик',
    text: 'Черновой текст',
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
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))

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

    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeDisabled()
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
    apiPatch.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: created,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PATCH ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen />)

    await user.type(await screen.findByLabelText('Заголовок'), 'Пикник')
    await user.type(await screen.findByLabelText('Текст записи'), 'Собрались за час.')
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))

    // The create landed, the publish refused, and the editor stays on the
    // entry it made instead of pretending nothing happened.
    await waitFor(() => expect(publishes).toBe(1))
    await waitFor(() =>
      expect(screen.getByText('Эта запись уже опубликована.')).toBeInTheDocument(),
    )

    // The retry edits the created entry and publishes it — one draft, ever.
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}', {
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
    apiPatch.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: { ...existing, text: 'Исправленный текст' },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PATCH ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    const titleField = await screen.findByLabelText('Заголовок')
    expect(titleField).toHaveValue('Черновик')

    await user.clear(screen.getByLabelText('Текст записи'))
    await user.type(screen.getByLabelText('Текст записи'), 'Исправленный текст')
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/api/v1/journal/entries/{entryId}', {
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
    apiPatch.mockImplementation(async () => ({
      data: published,
      error: undefined,
      response: new Response(null, { status: 200 }),
    }))
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={published.id} />)

    expect(await screen.findByText('опубликовано')).toBeInTheDocument()
    // No unpublish: the save is the only action for a published entry.
    expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
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

  it('a refused edit still triggers the sync, so a stale row clears itself', async () => {
    seedRegistry()
    const existing = draft()
    await applySyncResult(ME, syncResult([existing]))
    apiPatch.mockImplementation(async (path: never) => {
      if (path === '/api/v1/journal/entries/{entryId}') {
        return {
          data: undefined,
          error: { error: { code: 'entry_not_found', message: 'Removed elsewhere' } },
          response: new Response(null, { status: 404 }),
        }
      }
      throw new Error(`Unexpected PATCH ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<JournalEditorScreen entryId={existing.id} />)

    await user.clear(await screen.findByLabelText('Текст записи'))
    await user.type(screen.getByLabelText('Текст записи'), 'Исправленный текст')
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))

    expect(
      await screen.findByText('Запись не найдена или ещё не синхронизировалась.'),
    ).toBeInTheDocument()
    // The refusal is what carries the refresh: the sync ran although
    // nothing succeeded.
    expect(triggerSyncMock).toHaveBeenCalledTimes(1)
  })

  it('a refused create still triggers the sync', async () => {
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
