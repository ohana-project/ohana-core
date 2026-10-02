import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type { StoredCalendarEvent, SyncResult } from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { syncedSnapshotKey } from '@/features/member/use-synced-space.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { CalendarScreen } from './calendar-screen.tsx'
import { EventEditorScreen } from './event-editor-screen.tsx'
import { EventScreen } from './event-screen.tsx'

/*
 * The calendar screens (issue #20): the month and agenda views read the
 * synchronised partition — the same answer online and offline — the editor
 * sends the wall time for the API to compose, defaulting the zone to the
 * space's, and the event screen keeps the edit and the delete for the
 * creator and the owners. The tests mock the endpoints and assert the
 * screens' side of the flow. The device is pinned to UTC, so the local
 * answers are deterministic.
 */

process.env.TZ = 'UTC'

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
const apiPost = vi.mocked(api.POST)
const apiDelete = vi.mocked(api.DELETE)

const ME = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

// 2026-10-01 is a Thursday; the month view shows September behind it.
const NOW = new Date('2026-10-01T12:00:00.000Z')

function timedEvent(overrides?: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: '01900000-0000-7000-8000-000000000401',
    creatorId: ME,
    title: 'Миша — зубной врач',
    allDay: false,
    // 18:00 in Moscow is 15:00 in UTC — the device's local time here.
    startsAt: '2026-10-02T15:00:00.000Z',
    endsAt: '2026-10-02T16:00:00.000Z',
    timezone: 'Europe/Moscow',
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

function allDayEvent(overrides?: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: '01900000-0000-7000-8000-000000000402',
    creatorId: '01900000-0000-7000-8000-000000000002',
    title: 'День рождения Люды',
    allDay: true,
    date: '2026-10-19',
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

function syncResult(events: StoredCalendarEvent[]): SyncResult {
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
        member: {
          id: '01900000-0000-7000-8000-000000000002',
          name: 'Дима',
          role: 'regular',
          createdAt: '2026-08-14T10:00:00.000Z',
        },
      },
      ...events.map((event) => ({ entity: 'calendar_event' as const, event })),
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

function CaptureClient({ capture }: { capture: (client: QueryClient) => void }) {
  const client = useQueryClient()
  useEffect(() => {
    capture(client)
  }, [client, capture])
  return null
}

async function landSync(client: QueryClient, result: SyncResult) {
  await applySyncResult(ME, result)
  await client.invalidateQueries({ queryKey: syncedSnapshotKey(ME) })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mockQuietSync()
})

afterEach(async () => {
  vi.useRealTimers()
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('CalendarScreen (the month and the agenda)', () => {
  it('shows the month heading, the space zone, and the agenda groups', async () => {
    const doctor = timedEvent()
    const birthday = allDayEvent()
    seedRegistry()
    await applySyncResult(ME, syncResult([doctor, birthday]))
    renderWithProviders(
      <>
        <CalendarScreen />
        <CaptureClient capture={() => {}} />
      </>,
    )

    // The month the device sits in, and the space's zone hint.
    expect(await screen.findByText('Октябрь 2026')).toBeInTheDocument()
    expect(await screen.findByText('Часовой пояс пространства: Moscow (UTC+3)')).toBeInTheDocument()

    // The agenda: tomorrow's appointment shows the device-local time with
    // the event's own zone as the indication beside it.
    expect(await screen.findByText('Миша — зубной врач')).toBeInTheDocument()
    expect(screen.getByText('15:00 – 16:00 · 18:00 – 19:00 · Moscow (UTC+3)')).toBeInTheDocument()
    // The all-day event keeps its plain date and never shows a time.
    expect(screen.getByText('День рождения Люды')).toBeInTheDocument()
    expect(screen.getByText('весь день · 19 октября')).toBeInTheDocument()
    // The agenda reads day by day: tomorrow's group first, the birthday's
    // own day after it — the all-day kind never jumps the queue.
    expect(screen.getByText('Завтра')).toBeInTheDocument()
    const groups = screen.getAllByText(/^(Завтра|19 октября)$/)
    expect(groups[0]).toHaveTextContent('Завтра')
    expect(groups[1]).toHaveTextContent('19 октября')
  })

  it("opens a day sheet with that day's events from the month grid", async () => {
    const doctor = timedEvent()
    seedRegistry()
    await applySyncResult(ME, syncResult([doctor]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<CalendarScreen />)

    await screen.findByText('Миша — зубной врач')
    // The 2nd of October holds the appointment; tapping the day opens the
    // sheet the prototype draws.
    await user.click(screen.getByRole('button', { name: /2 октября, 1 событие/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('2 октября')).toBeInTheDocument()
    expect(within(sheet).getByText('Миша — зубной врач')).toBeInTheDocument()
  })

  it('says so when nothing is downloaded, and when the calendar holds nothing', async () => {
    seedRegistry()
    renderWithProviders(<CalendarScreen />)
    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()

    // An honest empty calendar, a partition having landed whole: the
    // apply and the snapshot invalidation re-render the screen, the way
    // the sync engine's notification does.
    let client: QueryClient | undefined
    renderWithProviders(
      <>
        <CalendarScreen />
        <CaptureClient capture={(captured) => (client = captured)} />
      </>,
    )
    await waitFor(() => expect(client).toBeDefined())
    await landSync(client as QueryClient, syncResult([]))
    expect(await screen.findByText('Событий пока нет')).toBeInTheDocument()
  })
})

describe('EventEditorScreen (a new event)', () => {
  it('posts the wall time and lets the API apply the space’s zone', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events') {
        return {
          data: timedEvent(),
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Ужин у бабушки')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    const [path, options] = apiPost.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(path).toBe('/api/v1/calendar/events')
    // The date defaults to today and the times to the evening. The zone
    // field shows the space's but was never touched, so it is not sent —
    // the API applies the space's zone itself, and a zone the space
    // changes between opening the form and saving still wins.
    expect(options.body).toEqual({
      title: 'Ужин у бабушки',
      allDay: false,
      date: '2026-10-01',
      startTime: '18:00',
      endTime: '21:00',
    })
  })

  it('a zone the member picked is sent; the space’s stays for the API', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events') {
        return {
          data: timedEvent(),
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Созвон со школой')
    await user.selectOptions(screen.getByLabelText('Часовой пояс'), 'Asia/Novosibirsk')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    const [, options] = apiPost.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(options.body).toMatchObject({ timezone: 'Asia/Novosibirsk' })
  })

  it('an all-day event sends its date and no time at all', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events') {
        return {
          data: allDayEvent(),
          error: undefined,
          response: new Response(null, { status: 201 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'День рождения Люды')
    await user.click(screen.getByRole('switch', { name: 'Весь день' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    const [, options] = apiPost.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(options.body).toEqual({
      title: 'День рождения Люды',
      allDay: true,
      date: '2026-10-01',
    })
  })

  it('a backwards pair of times is refused before anything is sent', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Вечеринка')
    await user.clear(screen.getByLabelText('Конец'))
    await user.type(screen.getByLabelText('Конец'), '17:00')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(screen.getByText('Конец должен быть позже начала')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })
})

describe('EventScreen (one event)', () => {
  it('shows the device-local time, the origin zone, and the creator', async () => {
    const doctor = timedEvent({
      creatorId: '01900000-0000-7000-8000-000000000002',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([doctor]))
    renderWithProviders(<EventScreen eventId={doctor.id} />)

    expect(await screen.findByText('Миша — зубной врач')).toBeInTheDocument()
    // The date line, the local time first, the origin zone beside it.
    expect(screen.getByText('пятница, 2 октября 2026 г.')).toBeInTheDocument()
    expect(screen.getAllByText('15:00 – 16:00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('18:00 – 19:00 · Moscow (UTC+3)').length).toBeGreaterThan(0)
    expect(screen.getByText('1 час')).toBeInTheDocument()
    expect(screen.getByText('Дима')).toBeInTheDocument()
    // Аня is an owner: the event is Дима's, the moderation is hers.
    expect(screen.getByRole('link', { name: /Изменить/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Удалить/ })).toBeInTheDocument()
  })

  it('a regular member who is not the creator reads without the edit and delete', async () => {
    const doctor = timedEvent({ creatorId: '01900000-0000-7000-8000-000000000002' })
    // Аня regular: the same event, no moderation controls.
    window.localStorage.clear()
    seedRegistry()
    const result = syncResult([doctor])
    result.changes = result.changes.map((change) =>
      change.entity === 'member' && change.member.id === ME
        ? { entity: 'member', member: { ...change.member, role: 'regular' as const } }
        : change,
    )
    await applySyncResult(ME, result)
    renderWithProviders(<EventScreen eventId={doctor.id} />)

    expect(await screen.findByText('Миша — зубной врач')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Изменить/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument()
  })

  it('the delete stands behind its confirm and removes the event', async () => {
    const doctor = timedEvent()
    seedRegistry()
    await applySyncResult(ME, syncResult([doctor]))
    apiDelete.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}') {
        return { data: undefined, error: undefined, response: new Response(null, { status: 204 }) }
      }
      throw new Error(`Unexpected DELETE ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventScreen eventId={doctor.id} />)

    await screen.findByText('Миша — зубной врач')
    await user.click(screen.getByRole('button', { name: /Удалить/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Удалить «Миша — зубной врач»?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalled())
    const [path, options] = apiDelete.mock.calls.at(-1) as unknown as [
      string,
      { params: { path: { eventId: string } } },
    ]
    expect(path).toBe('/api/v1/calendar/events/{eventId}')
    expect(options.params.path.eventId).toBe(doctor.id)
  })
})
