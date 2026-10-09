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
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
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
const apiPut = vi.mocked(api.PUT)
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

    // The month the device sits in, and the space's zone hint below the
    // card.
    expect(await screen.findByText('Октябрь 2026')).toBeInTheDocument()
    expect(await screen.findByText('Часовой пояс пространства: Moscow (UTC+3)')).toBeInTheDocument()

    // The agenda: tomorrow's appointment shows the device-local time with
    // the event's own zone as the indication beside it.
    expect(await screen.findByText('Миша — зубной врач')).toBeInTheDocument()
    expect(screen.getByText('15:00 – 16:00 · 18:00 – 19:00 · Moscow (UTC+3)')).toBeInTheDocument()
    // The all-day event keeps its plain date and never shows a time.
    expect(screen.getByText('День рождения Люды')).toBeInTheDocument()
    // The agenda reads «Сегодня» first — always present, a muted row when
    // the day holds nothing —, then tomorrow's group, then the month the
    // remaining days fall in (issue #73).
    expect(screen.getByText('Сегодня · 1 октября')).toBeInTheDocument()
    expect(screen.getByText('Событий нет — хороший день для дневника')).toBeInTheDocument()
    const labels = screen.getAllByText(/^(Сегодня · 1 октября|Завтра · 2 октября|Октябрь)$/)
    expect(labels).toHaveLength(3)
    expect(labels[0]).toHaveTextContent('Сегодня · 1 октября')
    expect(labels[1]).toHaveTextContent('Завтра · 2 октября')
    expect(labels[2]).toHaveTextContent('Октябрь')
    // The month group's row leads with its day, the prototype's dated
    // subtitle; the all-day kind drops the date its prefix now carries.
    expect(screen.getByText(/пн, 19 октября · весь день/)).toBeInTheDocument()
  })

  it('the month group rows lead with their day, and only those rows do', async () => {
    const tomorrow = timedEvent({
      id: '01900000-0000-7000-8000-000000000408',
      title: 'Завтрашний врач',
      startsAt: '2026-10-02T14:00:00.000Z',
      endsAt: '2026-10-02T15:00:00.000Z',
    })
    const first = timedEvent({
      id: '01900000-0000-7000-8000-000000000406',
      title: 'Первое собрание',
      startsAt: '2026-10-05T15:00:00.000Z',
      endsAt: '2026-10-05T16:00:00.000Z',
    })
    const second = timedEvent({
      id: '01900000-0000-7000-8000-000000000407',
      title: 'Второе собрание',
      startsAt: '2026-10-12T16:00:00.000Z',
      endsAt: '2026-10-12T17:00:00.000Z',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([tomorrow, first, second]))
    renderWithProviders(<CalendarScreen />)

    await screen.findByText('Первое собрание')
    // Two timed rows in one month card: each names its own day. The date
    // prefix is the description's own text node, the time line the span
    // inside it.
    expect(screen.getByText(/пн, 5 октября ·/)).toBeInTheDocument()
    expect(screen.getByText(/пн, 12 октября ·/)).toBeInTheDocument()
    // Tomorrow's row keeps the bare time line — its group label names the
    // day. The row itself is the scope (its link): a dated prefix would be
    // a direct text node of the description, invisible to a whole-document
    // query.
    const tomorrowRow = screen.getByText('Завтрашний врач').closest('a')
    expect(tomorrowRow).not.toHaveTextContent('2 октября · 14:00')
    expect(tomorrowRow).toHaveTextContent('14:00 – 15:00 · 17:00 – 18:00 · Moscow (UTC+3)')
  })

  it('the month grid follows the prototype: the today cell, the dots, the dimmed out days', async () => {
    const now = timedEvent({
      id: '01900000-0000-7000-8000-000000000403',
      title: 'Сегодняшняя встреча',
      startsAt: '2026-10-01T15:00:00.000Z',
      endsAt: '2026-10-01T16:00:00.000Z',
    })
    const doctor = timedEvent()
    const birthday = allDayEvent()
    const past = allDayEvent({
      id: '01900000-0000-7000-8000-000000000404',
      title: 'Прошедшая дача',
      date: '2026-09-30',
    })
    const crowd = [1, 2, 3, 4].map((n) =>
      timedEvent({
        id: `01900000-0000-7000-8000-00000000050${n}`,
        title: `Встреча ${n}`,
        startsAt: `2026-10-15T1${n}:00:00.000Z`,
        endsAt: `2026-10-15T1${n}:30:00.000Z`,
      }),
    )
    seedRegistry()
    await applySyncResult(ME, syncResult([now, doctor, birthday, past, ...crowd]))
    renderWithProviders(<CalendarScreen />)

    await screen.findByText('Миша — зубной врач')

    // Today holds an event: its cell is the 7% accent tint and the
    // number sits in the filled accent circle (issue #73).
    const todayCell = screen.getByRole('button', { name: /1 октября, 1 событие/ })
    expect(todayCell).toHaveClass('bg-primary-faint')
    expect(todayCell.firstChild).toHaveClass('bg-primary', 'text-primary-foreground')

    // The timed event's dot is accent, the all-day one warn.
    const doctorCell = screen.getByRole('button', { name: /2 октября, 1 событие/ })
    expect(doctorCell.querySelector('i')).toHaveClass('bg-primary')
    const birthdayCell = screen.getByRole('button', { name: /19 октября, 1 событие/ })
    expect(birthdayCell.querySelector('i')).toHaveClass('bg-warn')

    // A day with four events shows three dots, the fourth and later hidden.
    const crowdCell = screen.getByRole('button', { name: /15 октября, 4 события/ })
    expect(crowdCell.querySelectorAll('i')).toHaveLength(3)

    // An out-of-month past day dims: its number at the prototype's muted
    // 45%, its dot at 0.4.
    const outCell = screen.getByRole('button', { name: /30 сентября, 1 событие/ })
    expect(outCell.firstElementChild).toHaveClass('text-muted-faint')
    expect(outCell.querySelector('i')).toHaveClass('opacity-40')

    // A day without events is a plain cell, never a button (the day
    // sheet's door is a day with events).
    expect(screen.queryByRole('button', { name: /7 октября/ })).not.toBeInTheDocument()
    expect(screen.getByText('9', { exact: true }).parentElement).toHaveClass('aspect-square')

    // Every cell is square with the prototype's gaps.
    expect(todayCell).toHaveClass('aspect-square', 'gap-[7px]')
  })

  it('navigating to a past month dims its past days at half opacity', async () => {
    const past = timedEvent({
      id: '01900000-0000-7000-8000-000000000405',
      title: 'Собрание',
      startsAt: '2026-09-25T17:00:00.000Z',
      endsAt: '2026-09-25T18:00:00.000Z',
    })
    seedRegistry()
    await applySyncResult(ME, syncResult([past]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<CalendarScreen />)

    await screen.findByText('Октябрь 2026')
    // The month navigation is the prototype's desktop-only `.cal-nav`.
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(await screen.findByText('Сентябрь 2026')).toBeInTheDocument()

    // The 25th is a past in-month day: its dot carries the half opacity,
    // the neighbouring out days keep their own dim. The heading renders
    // while the synchronised snapshot is still pending, so the cell waits
    // for the grid to grow the day's events.
    const cell = await screen.findByRole('button', { name: /25 сентября, 1 событие/ })
    expect(cell.querySelector('i')).toHaveClass('opacity-50')
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
    // An honest empty calendar, a partition having landed whole: the
    // agenda still opens with «Сегодня» — always present, its muted row
    // saying the day holds nothing (issue #73).
    expect(await screen.findByText('Сегодня · 1 октября')).toBeInTheDocument()
    expect(screen.getByText('Событий нет — хороший день для дневника')).toBeInTheDocument()
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

  it('blank times and a blank date are refused in the form, not by the server', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Вечеринка')
    await user.clear(screen.getByLabelText('Начало'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Укажите время начала и конца')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Начало'), '18:00')
    await user.clear(screen.getByLabelText('Дата'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Выберите дату')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
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

describe('EventEditorScreen (an edit)', () => {
  it('an edit keeps the event’s own zone even when the picker is untouched', async () => {
    seedRegistry()
    const doctor = timedEvent() // 18:00 wall in Europe/Moscow
    await applySyncResult(ME, syncResult([doctor]))
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}') {
        return { data: doctor, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen eventId={doctor.id} />)

    // A title-only edit: the wall times show in the event's own zone, and
    // the PUT carries that zone — an untouched picker never re-zones the
    // event into the space's.
    await user.clear(await screen.findByLabelText('Название'))
    await user.type(screen.getByLabelText('Название'), 'Миша — зубной врач, кабинет 4')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPut).toHaveBeenCalled())
    const [, options] = apiPut.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(options.body).toMatchObject({
      title: 'Миша — зубной врач, кабинет 4',
      allDay: false,
      startTime: '18:00',
      endTime: '19:00',
      timezone: 'Europe/Moscow',
    })
  })

  it('an all-day event becoming timed leaves the zone to the API’s default', async () => {
    seedRegistry()
    const birthday = allDayEvent()
    await applySyncResult(ME, syncResult([birthday]))
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}') {
        return { data: birthday, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen eventId={birthday.id} />)

    // The switch flips to timed; the picker shows the space's zone and is
    // never touched. The event has no zone of its own, so the PUT sends
    // none — the API composes against the space's zone as it stands.
    await user.click(await screen.findByRole('switch', { name: 'Весь день' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPut).toHaveBeenCalled())
    const [, options] = apiPut.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(options.body).toMatchObject({ allDay: false, startTime: '18:00', endTime: '21:00' })
    expect(options.body).not.toHaveProperty('timezone')
  })

  it('timed → all-day → timed keeps the event’s own times', async () => {
    seedRegistry()
    const doctor = timedEvent()
    await applySyncResult(ME, syncResult([doctor]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen eventId={doctor.id} />)

    const allDay = await screen.findByRole('switch', { name: 'Весь день' })
    await screen.findByLabelText('Начало')
    await user.click(allDay)
    await user.click(allDay)

    // The fields the member never touched come back as they were.
    expect(screen.getByLabelText('Начало')).toHaveValue('18:00')
    expect(screen.getByLabelText('Конец')).toHaveValue('19:00')
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

describe('EventEditorScreen (repeating, issue #21)', () => {
  it('a new event carries the recurrence the form picked', async () => {
    seedRegistry()
    apiPost.mockResolvedValue({
      data: timedEvent(),
      error: undefined,
      response: new Response(null, { status: 201 }),
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Ужин у бабушки')
    await user.selectOptions(screen.getByLabelText('Повтор'), 'weekly')
    await user.type(screen.getByLabelText('Дата окончания'), '2027-01-31')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    const [, options] = apiPost.mock.calls.at(-1) as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(options.body).toMatchObject({
      recurrence: { frequency: 'weekly', until: '2027-01-31' },
    })
  })

  it('an until date before the event’s own is refused in the form', async () => {
    seedRegistry()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventEditorScreen />)

    await user.type(await screen.findByLabelText('Название'), 'Ужин у бабушки')
    await user.selectOptions(screen.getByLabelText('Повтор'), 'monthly')
    await user.type(screen.getByLabelText('Дата окончания'), '2020-01-01')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(
      screen.getByText('Дата окончания не может быть раньше первого события'),
    ).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('the series editor is seeded from the series’ own rule', async () => {
    seedRegistry()
    const series = timedEvent({ recurrence: { frequency: 'weekly', until: '2027-01-02' } })
    await applySyncResult(ME, syncResult([series]))
    renderWithProviders(<EventEditorScreen eventId={series.id} />)

    expect(await screen.findByLabelText('Повтор')).toHaveValue('weekly')
    expect(screen.getByLabelText('Дата окончания')).toHaveValue('2027-01-02')
  })

  it('an occurrence edit sends the original date and no rule of its own', async () => {
    seedRegistry()
    const series = timedEvent({ recurrence: { frequency: 'weekly' } })
    await applySyncResult(ME, syncResult([series]))
    apiPut.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}/occurrences/{originalDate}') {
        return { data: series, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected PUT ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // 2026-10-09 is the next Friday after the series' first occurrence.
    renderWithProviders(<EventEditorScreen eventId={series.id} occurrenceDate="2026-10-09" />)

    await user.clear(await screen.findByLabelText('Название'))
    await user.type(screen.getByLabelText('Название'), 'Ужин в кафе')
    // A single occurrence has no rule of its own: the repeat fields are
    // not here, the zone field still is.
    expect(screen.queryByLabelText('Повтор')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Часовой пояс')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(apiPut).toHaveBeenCalled())
    const [path, options] = apiPut.mock.calls.at(-1) as unknown as [
      string,
      {
        params: { path: { eventId: string; originalDate: string } }
        body: Record<string, unknown>
      },
    ]
    expect(path).toBe('/api/v1/calendar/events/{eventId}/occurrences/{originalDate}')
    expect(options.params.path).toEqual({ eventId: series.id, originalDate: '2026-10-09' })
    expect(options.body).not.toHaveProperty('recurrence')
  })
})

describe('EventScreen (a series, issue #21)', () => {
  const series = () =>
    timedEvent({
      recurrence: { frequency: 'weekly' },
    })

  it('shows the series line, and asks what the edit is for', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([series()]))
    renderWithProviders(<EventScreen eventId={series().id} />)

    expect(await screen.findByText('Каждую неделю')).toBeInTheDocument()
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: /Изменить/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Что изменить?')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Только это событие' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Всю серию' })).toBeInTheDocument()
  })

  it('the delete asks what to cancel, and the occurrence’s cancel hits the occurrence route', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([series()]))
    apiDelete.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}/occurrences/{originalDate}') {
        return { data: undefined, error: undefined, response: new Response(null, { status: 204 }) }
      }
      throw new Error(`Unexpected DELETE ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventScreen eventId={series().id} occurrenceDate="2026-10-09" />)

    await screen.findByText('Миша — зубной врач')
    // The occurrence the link named: its own date line.
    expect(screen.getByText('пятница, 9 октября 2026 г.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Удалить/ }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Отменить это событие или удалить всю серию?'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Отменить только это событие' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalled())
    const [path, options] = apiDelete.mock.calls.at(-1) as unknown as [
      string,
      { params: { path: { eventId: string; originalDate: string } } },
    ]
    expect(path).toBe('/api/v1/calendar/events/{eventId}/occurrences/{originalDate}')
    expect(options.params.path).toEqual({ eventId: series().id, originalDate: '2026-10-09' })
  })

  it('a cancelled occurrence says so instead of pretending the date exists', async () => {
    seedRegistry()
    const cancelled: StoredCalendarEvent = {
      ...series(),
      exceptions: [{ originalDate: '2026-10-09', kind: 'cancelled' }],
    }
    await applySyncResult(ME, syncResult([cancelled]))
    renderWithProviders(<EventScreen eventId={cancelled.id} occurrenceDate="2026-10-09" />)

    expect(await screen.findByText('Это событие отменено')).toBeInTheDocument()
  })

  it('an override stands in its own shoes on the occurrence the link named', async () => {
    seedRegistry()
    const overridden: StoredCalendarEvent = {
      ...series(),
      exceptions: [
        {
          originalDate: '2026-10-09',
          kind: 'override',
          title: 'Ужин в кафе',
          allDay: true,
          date: '2026-10-10',
        },
      ],
    }
    await applySyncResult(ME, syncResult([overridden]))
    renderWithProviders(<EventScreen eventId={overridden.id} occurrenceDate="2026-10-09" />)

    expect(await screen.findByText('Ужин в кафе')).toBeInTheDocument()
    expect(screen.getByText('суббота, 10 октября 2026 г.')).toBeInTheDocument()
  })
})

describe('EventScreen (a series opened without a date, issue #21)', () => {
  it('the occurrence actions anchor on the series’ next live occurrence', async () => {
    seedRegistry()
    // The series starts on the 2nd (a Friday); the screen is the default
    // landing after creation, no ?date= in the URL.
    const series = timedEvent({ recurrence: { frequency: 'weekly' } })
    await applySyncResult(ME, syncResult([series]))
    apiDelete.mockImplementation(async (path: never) => {
      if (path === '/api/v1/calendar/events/{eventId}/occurrences/{originalDate}') {
        return { data: undefined, error: undefined, response: new Response(null, { status: 204 }) }
      }
      throw new Error(`Unexpected DELETE ${String(path)}`)
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<EventScreen eventId={series.id} />)

    await screen.findByText('Миша — зубной врач')
    await user.click(screen.getByRole('button', { name: /Удалить/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Отменить только это событие' }))

    // The cancel names the first occurrence's date, not an empty one.
    await waitFor(() => expect(apiDelete).toHaveBeenCalled())
    const [path, options] = apiDelete.mock.calls.at(-1) as unknown as [
      string,
      { params: { path: { eventId: string; originalDate: string } } },
    ]
    expect(path).toBe('/api/v1/calendar/events/{eventId}/occurrences/{originalDate}')
    expect(options.params.path).toEqual({ eventId: series.id, originalDate: '2026-10-02' })
  })
})

describe('EventScreen (a series whose first occurrence is cancelled, review round three)', () => {
  it('the landing shows the next live occurrence and keeps both scope choices', async () => {
    seedRegistry()
    const series = timedEvent({ recurrence: { frequency: 'weekly' } })
    const cancelledFirst: StoredCalendarEvent = {
      ...series,
      exceptions: [{ originalDate: '2026-10-02', kind: 'cancelled' }],
    }
    await applySyncResult(ME, syncResult([cancelledFirst]))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // The default landing, no ?date=: the next live occurrence (the 9th)
    // stands in, the cancelled first date does not dead-end the screen —
    // and since the anchor is a live occurrence, both scope choices stay.
    renderWithProviders(<EventScreen eventId={series.id} />)

    expect(await screen.findByText('Миша — зубной врач')).toBeInTheDocument()
    expect(screen.queryByText('Это событие отменено')).not.toBeInTheDocument()
    expect(screen.getByText('пятница, 9 октября 2026 г.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Изменить/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Только это событие' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Всю серию' }))
    await user.click(await screen.findByRole('button', { name: /Удалить/ }))
    const deleteDialog = await screen.findByRole('dialog')
    expect(
      within(deleteDialog).getByRole('button', { name: 'Отменить только это событие' }),
    ).toBeInTheDocument()
  })

  it('an occurrence moved off the series’ first date still anchors the landing', async () => {
    seedRegistry()
    const series = timedEvent({ recurrence: { frequency: 'weekly' } })
    // The first date (the 2nd) was replaced whole by an event of its own
    // on the 1st: the landing anchors on it, the move being live.
    const movedFirst: StoredCalendarEvent = {
      ...series,
      exceptions: [
        {
          originalDate: '2026-10-02',
          kind: 'override',
          title: 'Перенесли на день',
          allDay: true,
          date: '2026-10-01',
        },
      ],
    }
    await applySyncResult(ME, syncResult([movedFirst]))
    renderWithProviders(<EventScreen eventId={series.id} />)

    expect(await screen.findByText('Перенесли на день')).toBeInTheDocument()
    expect(screen.getByText('четверг, 1 октября 2026 г.')).toBeInTheDocument()
  })

  it('a link that names the cancelled date still says so', async () => {
    seedRegistry()
    const series = timedEvent({ recurrence: { frequency: 'weekly' } })
    const cancelledFirst: StoredCalendarEvent = {
      ...series,
      exceptions: [{ originalDate: '2026-10-02', kind: 'cancelled' }],
    }
    await applySyncResult(ME, syncResult([cancelledFirst]))
    renderWithProviders(<EventScreen eventId={series.id} occurrenceDate="2026-10-02" />)

    expect(await screen.findByText('Это событие отменено')).toBeInTheDocument()
  })
})
