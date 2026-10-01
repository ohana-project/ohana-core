import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot, type SyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { SpaceHomeScreen } from './space-home.tsx'

/*
 * The home reads the member's local store (issue #14): the greeting, the
 * section navigation, and the members come from the synchronised
 * partition; the sync engine runs on mount and its status drives the
 * shell's indicator. A device with nothing downloaded says so instead of
 * showing empty sections, and signing out deletes the partition.
 *
 * Each test uses its own member id: the engine's status lives in a
 * module-level map keyed by member, and a stale answer from another test
 * must never be readable here.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
}))

const apiGet = vi.mocked(api.GET)
const apiDelete = vi.mocked(api.DELETE)

let memberCounter = 0

interface World {
  memberId: string
  me: {
    member: { id: string; name: string; displayName: string; role: 'owner'; createdAt: string }
    space: { id: string; name: string }
    needsOnboarding: boolean
  }
}

const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const MISHA = '01900000-0000-7000-8000-000000000002'

function makeWorld(): World {
  const memberId = `01900000-0000-7000-8000-${String(++memberCounter).padStart(12, '0')}`
  return {
    memberId,
    me: {
      member: {
        id: memberId,
        name: 'Аня',
        displayName: 'Аня Смирнова',
        role: 'owner',
        createdAt: '2026-08-12T10:00:00.000Z',
      },
      space: { id: SPACE_ID, name: 'Наша семья' },
      needsOnboarding: false,
    },
  }
}

function syncResultFor(world: World, overrides?: Partial<SyncResult>): SyncResult {
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
          id: world.memberId,
          name: 'Аня',
          displayName: 'Аня Смирнова',
          role: 'owner',
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      },
      {
        entity: 'member',
        member: {
          id: MISHA,
          name: 'Миша',
          role: 'regular',
          createdAt: '2026-08-14T10:00:00.000Z',
        },
      },
    ],
    tombstones: [],
    ...overrides,
  }
}

function seedRegistry(world: World) {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: world.memberId,
        spaceId: SPACE_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', world.memberId)
}

function mockResponses(world: World, sync: SyncResult | (() => Promise<SyncResult> | SyncResult)) {
  console.log('mockResponses installed for', world.memberId)
  // eslint-disable-next-line
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return { data: world.me, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/sync') {
      return {
        data: typeof sync === 'function' ? await sync() : sync,
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

function chipState(container: HTMLElement): string | undefined {
  return (
    container.querySelector('[data-slot="sync-status"]')?.getAttribute('data-state') ?? undefined
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(async () => {
  // The engine holds no handles between tests, but a database an in-flight
  // apply just created would otherwise leak into the next factory.
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('SpaceHomeScreen', () => {
  it('greets the member and renders the space from the local store', async () => {
    const world = makeWorld()
    seedRegistry(world)
    mockResponses(world, syncResultFor(world))
    renderWithProviders(<SpaceHomeScreen />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    // The home answers from the store once the first sync has landed.
    expect(await screen.findByText('Свежее в дневнике')).toBeInTheDocument()
    // Both shells render in jsdom (no active media query), so the section
    // navigation exists twice: the desktop sidebar and the mobile tab bar.
    expect(screen.getAllByRole('navigation', { name: 'Разделы' }).length).toBeGreaterThan(0)
    for (const section of ['Главная', 'Дневник', 'Календарь', 'Вишлисты']) {
      expect(screen.getAllByRole('button', { name: section }).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Ближайшие события')).toBeInTheDocument()
    expect(screen.getByText('Участники')).toBeInTheDocument()
    expect(screen.getByText('Миша')).toBeInTheDocument()
    // The sync ran on mount, from revision 0, naming its member.
    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '0' }, header: { 'x-ohana-member': world.memberId } },
    })
  })

  it('hides a hidden section from the navigation and the home columns', async () => {
    const world = makeWorld()
    seedRegistry(world)
    const hidden = syncResultFor(world)
    hidden.changes = hidden.changes.map((change) =>
      change.entity === 'space'
        ? {
            entity: 'space',
            space: {
              ...change.space,
              sections: { journal: false, calendar: true, wishlist: true },
            },
          }
        : change,
    )
    await applySyncResult(world.memberId, hidden)
    mockResponses(world, {
      ...hidden,
      revision: '8',
      changes: hidden.changes.filter((change) => change.entity === 'space'),
    })

    const { container } = renderWithProviders(<SpaceHomeScreen />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    await screen.findByText('Ближайшие события')
    // The hidden journal is nowhere — navigation and home column — while
    // the visible calendar stays.
    expect(screen.queryAllByRole('button', { name: 'Дневник' })).toHaveLength(0)
    expect(screen.queryByText('Свежее в дневнике')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Календарь' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Вишлисты' }).length).toBeGreaterThan(0)
    await waitFor(() => expect(chipState(container)).toBe('synced'))
  })

  it('says that nothing is available offline when nothing is downloaded', async () => {
    const world = makeWorld()
    seedRegistry(world)
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: world.me, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') throw new TypeError('Network request failed')
      throw new Error(`Unexpected GET ${String(path)}`)
    })

    const { container } = renderWithProviders(<SpaceHomeScreen />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    // The empty device does not pretend the space is empty: no sections,
    // no member list — the notice instead, and the failure in the chip.
    expect(screen.getByText('Пока нечего читать без сети')).toBeInTheDocument()
    expect(screen.queryByText('Свежее в дневнике')).not.toBeInTheDocument()
    expect(screen.queryByText('Ближайшие события')).not.toBeInTheDocument()
    expect(screen.queryByText('Участники')).not.toBeInTheDocument()
    await waitFor(() => expect(chipState(container)).toBe('unreachable'))
  })

  it('keeps reading the space from local data when the API is unreachable', async () => {
    const world = makeWorld()
    seedRegistry(world)
    await applySyncResult(world.memberId, syncResultFor(world))
    // The probe and the sync never come back: the retained sign-in reads on.
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me' || path === '/api/v1/sync') {
        throw new TypeError('Network request failed')
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })

    renderWithProviders(<SpaceHomeScreen />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    expect(screen.getByText('Свежее в дневнике')).toBeInTheDocument()
    expect(screen.getByText('Миша')).toBeInTheDocument()
  })

  it('signs out through the user menu and deletes the member’s local data', async () => {
    const world = makeWorld()
    seedRegistry(world)
    await applySyncResult(world.memberId, syncResultFor(world))
    mockResponses(world, syncResultFor(world))
    apiDelete.mockResolvedValue({
      data: world.memberId,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderWithProviders(<SpaceHomeScreen />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // The session probe and the first sync settle before the menu opens,
    // so no re-render replaces the trigger under the pointer mid-interaction.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    apiGet.mockClear()
    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    // The menu mounts into a portal; under jsdom it can land outside the
    // a11y tree, so the item is clicked by its text.
    await user.click(await screen.findByText('Выйти'))

    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/me/session',
      expect.objectContaining({
        params: { header: { 'x-ohana-member': world.memberId } },
      }),
    )
    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')).toEqual([])

    // The synchronised partition is gone with the sign-out (issue #14).
    await vi.waitFor(async () => {
      const snapshot = await readMemberSnapshot(world.memberId)
      expect(snapshot.revision).toBeUndefined()
      expect(snapshot.members).toEqual([])
    })
    // The signed-out member's cached data is cleared, not refetched: the
    // header is pinned and the session is gone, so the request could only
    // be refused.
    expect(apiGet).not.toHaveBeenCalledWith('/api/v1/sync', {
      params: expect.objectContaining({ header: { 'x-ohana-member': world.memberId } }),
    })
  })

  it('keeps the sign-in and explains itself when sign-out fails', async () => {
    const world = makeWorld()
    seedRegistry(world)
    mockResponses(world, syncResultFor(world))
    apiDelete.mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithProviders(<SpaceHomeScreen />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // The session probe and the first sync settle before the menu opens.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    await user.click(await screen.findByText('Выйти'))

    expect(
      await screen.findByText('Не получилось выйти — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    // The failed sign-out keeps the registry entry for a retry.
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(world.memberId)
  })
})
