import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot, type SyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { MemberSessionGate } from './member-session-gate.tsx'
import { SpaceHomeScreen } from './space-home.tsx'
import { memberSessionQueryKey } from './use-member-session.ts'

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

// The home screen's answers are pinned to UTC, whatever zone the machine
// that runs them sits in: the agenda's window runs from the device's day.
process.env.TZ = 'UTC'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  // The gate redirects through Navigate; the tests decide the session
  // state, so it never renders.
  Navigate: () => null,
  // The home columns link into the journal, the calendar and the
  // wishlists; a stand-in href built from the `to`, the params and the
  // search, so the tests can assert where a row or a link leads.
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children?: React.ReactNode
    to?: string
    params?: Record<string, string | undefined>
    search?: { date?: string }
  }) => {
    let href = to ?? ''
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value ?? '')
    }
    return <a href={`${href}${search?.date ? `?date=${search.date}` : ''}`}>{children}</a>
  },
}))

const apiGet = vi.mocked(api.GET)
const apiDelete = vi.mocked(api.DELETE)

/**
 * The home as its route mounts it: the session gate around the screen,
 * because the gate carries the member area's one sync lifecycle (issue
 * #14) — a bare screen would never sync.
 */
let homeClient: QueryClient | undefined

function HomeRoute() {
  homeClient = useQueryClient()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <SpaceHomeScreen />
    </MemberSessionGate>
  )
}

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
  homeClient = undefined
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
    renderWithProviders(<HomeRoute />)

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
    // The Members block the earlier build appended is gone: the prototype's
    // home carries only the two columns (issue #65).
    expect(screen.queryByText('Участники')).not.toBeInTheDocument()
    expect(screen.queryByText('Миша')).not.toBeInTheDocument()
    // Both section headers carry their «see all» link (issue #65).
    expect(screen.getByRole('link', { name: 'Весь дневник' })).toHaveAttribute('href', '/journal')
    expect(screen.getByRole('link', { name: 'Весь календарь' })).toHaveAttribute(
      'href',
      '/calendar',
    )
    // With no entries in the partition the journal column says so.
    expect(
      screen.getByText('Здесь появятся записи — походы, обеды, маленькие победы.'),
    ).toBeInTheDocument()
    // The sync ran on mount, from revision 0, naming its member.
    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '0' }, header: { 'x-ohana-member': world.memberId } },
    })
    // The home mounts the snapshot query twice — its own, and the
    // navigation's — but the gate's single lifecycle runs the engine once.
    expect(apiGet.mock.calls.filter((call) => call[0] === '/api/v1/sync')).toHaveLength(1)

    // A probe refetch (stale-time expiry, invalidation) reports pending
    // while in flight; the lifecycle is keyed on the probe's settled data,
    // so the refetch must not tear the sync down and start it again. The
    // second probe answer is held back, so the pending state is proven on
    // screen instead of being raced past.
    if (homeClient === undefined) throw new Error('The home client never mounted')
    let releaseMe: (() => void) | undefined
    const meGate = new Promise<void>((resolve) => {
      releaseMe = resolve
    })
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        await meGate
        return { data: world.me, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') {
        return {
          data: syncResultFor(world),
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    void homeClient.invalidateQueries({ queryKey: memberSessionQueryKey })
    // The gate renders its spinner while the probe is in flight — the
    // pending state the old, render-status keying would have reacted to.
    await vi.waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Аня Смирнова/ })).toBeNull(),
    )
    releaseMe?.()
    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    // A macrotask lets the effect commit, and a partition read issued after
    // the engine's own resolves after it: a restarted lifecycle would have
    // made its second /sync call by the time this returns.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await readMemberSnapshot(world.memberId)
    expect(apiGet.mock.calls.filter((call) => call[0] === '/api/v1/sync')).toHaveLength(1)
  })

  it('shows the space’s two monograms and the space name in the top bar (issue #62)', async () => {
    // The shell data comes from the one builder (useMemberShell): the
    // stack is the first two active members' monograms — never empty, and
    // never the viewer alone — and the home's top-bar title is the space
    // name, like the prototype's `data-title` on home.html. The ids stay
    // clear of MISHA's: the store is keyed by id, and a collision would
    // silently merge two members into one row.
    const memberId = '01900000-0000-7000-8000-0000000000a1'
    const dimaId = '01900000-0000-7000-8000-0000000000d1'
    const me = {
      member: {
        id: memberId,
        name: 'Аня',
        displayName: 'Аня Смирнова',
        role: 'owner' as const,
        createdAt: '2026-08-12T10:00:00.000Z',
      },
      space: { id: SPACE_ID, name: 'Наша семья' },
      needsOnboarding: false,
    }
    const sync: SyncResult = {
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
        { entity: 'member', member: me.member },
        {
          entity: 'member',
          member: {
            id: dimaId,
            name: 'Дима',
            role: 'regular',
            createdAt: '2026-08-14T10:00:00.000Z',
          },
        },
      ],
      tombstones: [],
    }
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([
        {
          memberId,
          spaceId: SPACE_ID,
          spaceName: 'Наша семья',
          name: 'Аня',
          displayName: 'Аня Смирнова',
        },
      ]),
    )
    window.localStorage.setItem('ohana.activeMember', memberId)
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: me, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/sync') {
        return { data: sync, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    const { container } = renderWithProviders(<HomeRoute />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()

    const topbar = container.querySelector('[data-slot="topbar"]')
    if (topbar === null) throw new Error('The member shell never rendered its top bar')
    expect(topbar.textContent).toContain('Наша семья')
    const switcher = topbar.querySelector('[data-slot="topbar-space"]')
    if (switcher === null) throw new Error('The top bar never rendered its space switcher')
    // The partition read lands a beat after the greeting; the stack grows
    // from the viewer's stand-in to the space's first two members, the
    // owner leading, like the prototype's shell.
    await vi.waitFor(() => {
      const monograms = [...switcher.querySelectorAll('[data-slot="avatar"]')].map(
        (avatar) => avatar.textContent,
      )
      expect(monograms).toEqual(['А', 'Д'])
    })
  })

  it('a calendar awaiting its replay says nothing is downloaded in the events column', async () => {
    // A re-show or the store upgrade wrote the replay promise paired with
    // the cursor of 0 (ADR-0014): the rows the store holds are a fraction
    // of the calendar, and the column says so rather than showing them
    // (issue #20). The promise is written the way the store's own apply
    // writes it, and the sync the gate would mount is held open, so the
    // frame under test cannot resolve beneath the assertions.
    const world = makeWorld()
    seedRegistry(world)
    const withEvent = syncResultFor(world)
    withEvent.changes.push({
      entity: 'calendar_event',
      event: {
        id: '01900000-0000-7000-8000-000000000421',
        creatorId: world.memberId,
        title: 'Ужин у бабушки',
        allDay: true,
        // Far enough ahead to stay upcoming for the life of this test.
        date: '2200-01-01',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      },
    } as never)
    await applySyncResult(world.memberId, withEvent)

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`ohana.sync.${world.memberId}`)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Opening the store failed'))
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['meta'], 'readwrite')
      tx.objectStore('meta').put({ key: 'cursor', revision: '0' })
      tx.objectStore('meta').put({ key: 'pendingReplay', sections: ['calendar'] })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Writing the promise failed'))
    })
    db.close()

    // The gate's on-mount sync never lands: a run that applied would clear
    // the promise, and the column would honestly show the rows again.
    mockResponses(world, () => new Promise<SyncResult>(() => {}))
    renderWithProviders(<HomeRoute />)

    await screen.findByText('Пока нечего читать без сети')
    expect(screen.queryByText('Ужин у бабушки')).not.toBeInTheDocument()
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

    const { container } = renderWithProviders(<HomeRoute />)

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

    const { container } = renderWithProviders(<HomeRoute />)

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

    renderWithProviders(<HomeRoute />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    // The partition read runs beside the identity assembly; both answer
    // from the local store.
    expect(await screen.findByText('Свежее в дневнике')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Весь дневник' })).toBeInTheDocument()
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
    const { container } = renderWithProviders(<HomeRoute />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // The session probe and the sync runs settle before the menu opens, so
    // no re-render replaces the trigger under the pointer mid-interaction.
    await vi.waitFor(() => expect(chipState(container)).toBe('synced'))
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
    renderWithProviders(<HomeRoute />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // The session probe and the sync runs settle before the menu opens.
    await vi.waitFor(() => expect(screen.getByText('Свежее в дневнике')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    await user.click(await screen.findByText('Выйти'))

    expect(
      await screen.findByText('Не получилось выйти — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    // The failed sign-out keeps the registry entry for a retry.
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(world.memberId)
  })
})

describe('SpaceHomeScreen (a series occurrence in the events column, issue #21)', () => {
  // The agenda's window runs from the device's today, so the clock is
  // pinned and the expected occurrence computed from the pinned day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('an occurrence links by its series and original date, not by its composite id', async () => {
    const world = makeWorld()
    seedRegistry(world)
    const withSeries = syncResultFor(world)
    withSeries.changes.push({
      entity: 'calendar_event',
      event: {
        id: '01900000-0000-7000-8000-000000000431',
        creatorId: world.memberId,
        title: 'Утренняя зарядка',
        allDay: true,
        // A weekly Monday series whose first occurrence is the pinned
        // today: the window always holds it.
        date: '2026-10-05',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
        recurrence: { frequency: 'weekly' },
      },
    } as never)
    await applySyncResult(world.memberId, withSeries)
    mockResponses(world, withSeries)

    renderWithProviders(<HomeRoute />)

    // The links carry the series' id and each occurrence's date: the
    // occurrence's own id (`eventId:date`) is not an event address.
    const links = await screen.findAllByRole('link', { name: /Утренняя зарядка/ })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute(
      'href',
      '/calendar/01900000-0000-7000-8000-000000000431?date=2026-10-05',
    )
    for (const link of links) {
      expect(link).toHaveAttribute(
        'href',
        expect.stringMatching(
          /^\/calendar\/01900000-0000-7000-8000-000000000431\?date=\d{4}-\d{2}-\d{2}$/,
        ),
      )
    }
  })
})

describe('SpaceHomeScreen (the design-parity columns, issue #65)', () => {
  // The soon window and the birthday note run from the device's today,
  // so the clock is pinned: 2026-10-05, a Monday at noon UTC.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const LYUDA = '01900000-0000-7000-8000-0000000000d3'
  const HIKE = '01900000-0000-7000-8000-000000000101'
  const COOK = '01900000-0000-7000-8000-000000000102'
  const OLD = '01900000-0000-7000-8000-000000000103'

  function entry(
    id: string,
    overrides?: Partial<{ title: string; state: 'draft' | 'published'; publishedAt: string }>,
  ) {
    return {
      id,
      authorId: MISHA,
      title: 'Запись',
      text: 'Текст записи',
      state: 'published' as const,
      publishedAt: '2026-09-21T14:00:00.000Z',
      images: [],
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T14:00:00.000Z',
      ...overrides,
    }
  }

  function wish(id: string, received = false) {
    return {
      id,
      authorId: LYUDA,
      title: `Желание ${id.slice(-2)}`,
      receivedAt: received ? '2026-09-30T10:00:00.000Z' : undefined,
      createdAt: '2026-09-26T12:00:00.000Z',
      updatedAt: '2026-09-26T12:00:00.000Z',
    }
  }

  function event(
    id: string,
    overrides?: Partial<{
      title: string
      allDay: boolean
      date: string | undefined
      startsAt: string
      endsAt: string
    }>,
  ) {
    return {
      id,
      creatorId: MISHA,
      title: 'Событие',
      allDay: true,
      date: '2026-10-15',
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      ...overrides,
    }
  }

  /** The world's sync with Люда added — the note's near birthday names
   *  her, as the prototype's demo does. */
  function syncWith(
    world: World,
    extra: Array<{ entity: string } & Record<string, unknown>>,
  ): SyncResult {
    const sync = syncResultFor(world)
    sync.changes.push({
      entity: 'member',
      member: {
        id: LYUDA,
        name: 'Люда',
        role: 'regular',
        createdAt: '2026-08-15T10:00:00.000Z',
      },
    } as never)
    sync.changes.push(...(extra as never[]))
    return sync
  }

  async function renderSeeded(world: World, sync: SyncResult) {
    seedRegistry(world)
    await applySyncResult(world.memberId, sync)
    mockResponses(world, sync)
    return renderWithProviders(<HomeRoute />)
  }

  it('renders the two most recent published entries as entry cards, the draft staying home', async () => {
    const world = makeWorld()
    const sync = syncWith(world, [
      {
        entity: 'journal_entry',
        entry: entry(HIKE, {
          title: 'Поход к Чёртову креслу',
          publishedAt: '2026-10-02T09:00:00.000Z',
        }),
      },
      {
        entity: 'journal_entry',
        entry: entry(COOK, {
          title: 'Вареники с бабушкой',
          publishedAt: '2026-09-21T14:00:00.000Z',
        }),
      },
      // An older published entry and a draft stay off the home: the
      // prototype's column shows the two freshest cards.
      {
        entity: 'journal_entry',
        entry: entry(OLD, { title: 'Старая запись', publishedAt: '2026-09-01T09:00:00.000Z' }),
      },
      {
        entity: 'journal_entry',
        entry: entry('01900000-0000-7000-8000-000000000104', { title: 'Черновик', state: 'draft' }),
      },
    ])
    await renderSeeded(world, sync)

    expect(await screen.findByText('Свежее в дневнике')).toBeInTheDocument()
    const hike = screen.getByRole('link', { name: /Поход к Чёртову креслу/ })
    expect(hike).toHaveAttribute('href', `/journal/${HIKE}`)
    expect(screen.getByRole('link', { name: /Вареники с бабушкой/ })).toHaveAttribute(
      'href',
      `/journal/${COOK}`,
    )
    expect(screen.queryByText('Старая запись')).not.toBeInTheDocument()
    expect(screen.queryByText('Черновик')).not.toBeInTheDocument()
    // Entries are in, so the column's empty state is not.
    expect(
      screen.queryByText('Здесь появятся записи — походы, обеды, маленькие победы.'),
    ).not.toBeInTheDocument()
  })

  it("lays the screen out as the prototype's 1.55fr / 1fr grid from 920px", async () => {
    const world = makeWorld()
    const { container } = await renderSeeded(world, syncResultFor(world))

    await screen.findByText('Свежее в дневнике')
    // The prototype's `.home-grid`: a 28px column below 920px, the
    // 1.55fr / 1fr grid with a 40px gap and the journal first above.
    const grid = container.querySelector('[class*="grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]"]')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('gap-7')
    expect(grid?.className).toContain('desktop:gap-10')
    // The greeting is the display size, the prototype's `.display-xl`.
    const heading = screen.getByRole('heading', { level: 1, name: /Аня Смирнова/ })
    expect(heading.className).toContain('text-display')
  })

  it('marks a near all-day event with the soon pill; the other rows keep the chevron', async () => {
    const world = makeWorld()
    const sync = syncWith(world, [
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000201', { title: 'День рождения Люды' }),
      },
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000202', {
          title: 'Миша — зубной врач',
          allDay: false,
          date: undefined,
          startsAt: '2026-10-06T11:30:00.000Z',
          endsAt: '2026-10-06T12:30:00.000Z',
        }),
      },
      // All-day but beyond the soon window: the calendar is a month and
      // more ahead, the pill is for the near ones.
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000203', {
          title: 'Далёкий поход',
          date: '2026-12-20',
        }),
      },
    ])
    await renderSeeded(world, sync)

    const birthday = await screen.findByRole('link', { name: /День рождения Люды/ })
    const pill = birthday.querySelector('[data-slot="badge"]')
    expect(pill).not.toBeNull()
    expect(pill?.textContent).toBe('скоро')
    // The timed row keeps the plain trailing chevron.
    const dentist = screen.getByRole('link', { name: /Миша — зубной врач/ })
    expect(dentist.querySelector('[data-slot="badge"]')).toBeNull()
    const far = screen.getByRole('link', { name: /Далёкий поход/ })
    expect(far.querySelector('[data-slot="badge"]')).toBeNull()
  })

  it('shows the birthday note for a near birthday and links it to the wishlists', async () => {
    const world = makeWorld()
    const sync = syncWith(world, [
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000201', { title: 'День рождения Люды' }),
      },
      { entity: 'wishlist_wish', wish: wish('01900000-0000-7000-8000-000000000301') },
      { entity: 'wishlist_wish', wish: wish('01900000-0000-7000-8000-000000000302') },
      // A received wish is no longer an idea to give.
      { entity: 'wishlist_wish', wish: wish('01900000-0000-7000-8000-000000000303', true) },
    ])
    await renderSeeded(world, sync)

    // The note names the event as its creator titled it, with the date
    // and the open ideas really in that member's list.
    expect(
      await screen.findByText('День рождения Люды — 15 октября, через 10 дней.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('В списке уже 2 идеи — забронируйте подарок, пока не разобрали.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть вишлисты' })).toHaveAttribute(
      'href',
      '/wishlist',
    )
  })

  it('keeps quiet while no member birthday is near, saying so about the empty events', async () => {
    const world = makeWorld()
    // Only a timed event tomorrow and the reader's own birthday — the
    // reader's birthday is nobody's errand to run (issue #66's rule).
    const sync = syncWith(world, [
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000202', {
          title: 'Ужин у бабушки',
          allDay: false,
          date: undefined,
          startsAt: '2026-10-06T15:00:00.000Z',
          endsAt: '2026-10-06T18:00:00.000Z',
        }),
      },
      {
        entity: 'calendar_event',
        event: event('01900000-0000-7000-8000-000000000204', { title: 'День рождения Ани' }),
      },
    ])
    await renderSeeded(world, sync)

    expect(await screen.findByRole('link', { name: /Ужин у бабушки/ })).toBeInTheDocument()
    expect(screen.queryByText('Открыть вишлисты')).not.toBeInTheDocument()
  })

  it('says the events column is empty when nothing is coming', async () => {
    const world = makeWorld()
    await renderSeeded(world, syncResultFor(world))

    expect(
      await screen.findByText('Здесь появятся события — дни рождения, врачи, ужины.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Открыть вишлисты')).not.toBeInTheDocument()
  })
})
