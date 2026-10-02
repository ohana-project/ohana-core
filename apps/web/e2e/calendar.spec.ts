import { expect, type Page, test } from '@playwright/test'

/*
 * The calendar's interface flows (issues #20 and #21): the section
 * navigation leads to the month with the agenda beside it; a day's sheet
 * opens from the grid; an event is created through the editor with the
 * space's zone as the timed default, edited, and removed behind its
 * confirm; a repeating series is created with its rule, one of its
 * occurrences cancelled through the occurrence route, and the whole series
 * edited through the scope dialog; a timed event shows the device-local
 * time with the zone it keeps, and an all-day event keeps its plain date.
 * The member endpoints are intercepted at the network level over a small
 * stateful calendar — the real HTTP rules for permissions and time zones
 * are covered by the API's tests, while this spec pins the UI flow and its
 * reads through the synchronised partition.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const EVENTS = '**/api/v1/calendar/events'
const EVENT = '**/api/v1/calendar/events/*'
// The occurrence routes carry the original date in the path; a single `*`
// does not cross a `/`, so EVENT never matches an occurrence URL (issue #21).
const OCCURRENCE = '**/api/v1/calendar/events/*/occurrences/*'
// The sync request carries ?since=…, so the glob spans the query too.
const SYNC = '**/api/v1/sync*'

const ANYA_ID = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const CODE = 'QWEE-4455'

const ANYA_ME = {
  member: {
    id: ANYA_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: SPACE_ID, name: 'Наша семья' },
  needsOnboarding: false,
}

const PROFILES = [
  {
    id: ANYA_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
]

const SPACE = {
  id: SPACE_ID,
  name: 'Наша семья',
  timezone: 'Europe/Moscow',
  sections: { journal: true, calendar: true, wishlist: true },
}

// A timed event at 18:00 Moscow is 15:00 UTC — the e2e browser runs in
// UTC, so that is the local time the screen shows.
const SEEDED_DINNER = {
  id: '01900000-0000-7000-8000-000000000401',
  creatorId: ANYA_ID,
  title: 'Ужин у бабушки',
  allDay: false,
  startsAt: '2026-10-02T15:00:00.000Z',
  endsAt: '2026-10-02T18:00:00.000Z',
  timezone: 'Europe/Moscow',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
}

const SEEDED_BIRTHDAY = {
  id: '01900000-0000-7000-8000-000000000402',
  creatorId: ANYA_ID,
  title: 'День рождения Люды',
  allDay: true,
  date: '2026-10-19',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

/**
 * The mocked member API over a small stateful calendar: the mutations the
 * screens send change what the next sync answers, the way the server's
 * revision would deliver them. A removal drops the row from the sync's
 * upserts and answers the delete as a tombstone for everyone, the way the
 * server does (issue #20).
 */
async function mockCalendarApi(page: Page) {
  const signedIn = new Set<string>([ANYA_ID])
  const events: Array<Record<string, unknown>> = [SEEDED_DINNER, SEEDED_BIRTHDAY]
  const removed: string[] = []
  let nextId = 0x500
  let revision = 7

  await page.route(REDEEM, (route) =>
    route.fulfill({
      ...json(200, ANYA_ME),
      headers: {
        'set-cookie': `ohana_member_session_${ANYA_ID}=e2e-token; Path=/api; HttpOnly; Secure; SameSite=Lax`,
      },
    }),
  )

  await page.route(ME, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) {
      return route.fulfill(
        json(401, { error: { code: 'unauthorized', message: 'A member session is required' } }),
      )
    }
    return route.fulfill(json(200, ANYA_ME))
  })

  await page.route(SYNC, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(json(401, {}))
    return route.fulfill(
      json(200, {
        revision: String(revision),
        changes: [
          { entity: 'space', space: SPACE },
          ...PROFILES.map((profile) => ({ entity: 'member', member: profile })),
          ...events.map((event) => ({ entity: 'calendar_event', event })),
        ],
        tombstones: removed.map((entityId) => ({
          entity: 'calendar_event',
          entityId,
          audience: 'all',
        })),
      }),
    )
  })

  await page.route(EVENTS, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const body = route.request().postDataJSON() as Record<string, unknown>
    const created: Record<string, unknown> = {
      id: `01900000-0000-7000-8000-${String(nextId++).padStart(12, '0')}`,
      creatorId: ANYA_ID,
      ...(body.allDay === true
        ? { allDay: true, date: body.date }
        : {
            allDay: false,
            startsAt: '2026-10-05T15:00:00.000Z',
            endsAt: '2026-10-05T18:00:00.000Z',
            timezone: body.timezone ?? 'Europe/Moscow',
          }),
      title: body.title,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
    }
    if (body.recurrence !== undefined) created.recurrence = body.recurrence
    events.push(created)
    revision += 1
    return route.fulfill(json(201, created))
  })

  await page.route(EVENT, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const eventId = route.request().url().split('/').at(-1) as string
    const event = events.find((row) => row.id === eventId)
    if (event === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'event_not_found', message: 'No such event' } }),
      )
    }
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      delete event.date
      delete event.startsAt
      delete event.endsAt
      delete event.timezone
      delete event.recurrence
      event.title = body.title
      if (body.allDay === true) {
        event.allDay = true
        event.date = body.date
      } else {
        event.allDay = false
        event.startsAt = '2026-10-02T14:00:00.000Z'
        event.endsAt = '2026-10-02T17:00:00.000Z'
        event.timezone = body.timezone ?? 'Europe/Moscow'
      }
      // The whole-series replace: the rule named stands, the rule dropped
      // is gone (issue #21).
      if (body.recurrence !== undefined) event.recurrence = body.recurrence
      event.updatedAt = '2026-10-01T10:00:00.000Z'
      revision += 1
      return route.fulfill(json(200, event))
    }
    // DELETE: the event leaves for good, the tombstone telling every device.
    events.splice(events.indexOf(event), 1)
    removed.push(event.id as string)
    revision += 1
    return route.fulfill(json(204, undefined))
  })

  // The occurrence routes (issue #21): an override or a cancellation is
  // upserted per original date and re-delivered inside its event's DTO.
  await page.route(OCCURRENCE, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const parts = route.request().url().split('/')
    const eventId = parts.at(-3) as string
    const originalDate = parts.at(-1) as string
    const event = events.find((row) => row.id === eventId)
    if (event === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'event_not_found', message: 'No such event' } }),
      )
    }
    const exceptions = (event.exceptions as Array<Record<string, unknown>> | undefined) ?? []
    const existing = exceptions.findIndex((row) => row.originalDate === originalDate)
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      const override =
        body.allDay === true
          ? {
              originalDate,
              kind: 'override',
              title: body.title,
              allDay: true,
              date: body.date,
            }
          : {
              originalDate,
              kind: 'override',
              title: body.title,
              allDay: false,
              // The mock's fixed 18:00–21:00 Moscow pair on the
              // replacement's own date (Moscow keeps UTC+3 all year).
              startsAt: `${String(body.date)}T15:00:00.000Z`,
              endsAt: `${String(body.date)}T18:00:00.000Z`,
              timezone: body.timezone ?? 'Europe/Moscow',
            }
      if (existing >= 0) exceptions[existing] = override
      else exceptions.push(override)
    } else {
      const cancelled = { originalDate, kind: 'cancelled' }
      if (existing >= 0) exceptions[existing] = cancelled
      else exceptions.push(cancelled)
    }
    event.exceptions = exceptions
    event.updatedAt = '2026-10-01T10:00:00.000Z'
    revision += 1
    return route.fulfill(
      route.request().method() === 'PUT' ? json(200, event) : json(204, undefined),
    )
  })
}

// The device sits in UTC, so the seeded 15:00Z start reads 15:00 local
// against the event's 18:00 Moscow — the zone indication the screen shows.
test.use({ timezoneId: 'UTC' })

test.describe('the calendar', () => {
  test('the month and the agenda show the space events, and a day opens its sheet', async ({
    page,
  }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The section navigation leads to the calendar.
    await page.getByRole('button', { name: 'Календарь' }).first().click()
    await expect(page).toHaveURL(/\/calendar$/)
    await expect(page.getByText('Часовой пояс пространства: Moscow (UTC+3)')).toBeVisible()

    // The agenda carries the timed event in the device-local time with the
    // zone it keeps, and the all-day one with its plain date.
    await expect(page.getByText('Ужин у бабушки')).toBeVisible()
    await expect(page.getByText('15:00 – 18:00 · 18:00 – 21:00 · Moscow (UTC+3)')).toBeVisible()
    await expect(page.getByText('весь день · 19 октября')).toBeVisible()

    // The 2nd of October holds the dinner; the day's sheet opens from the
    // grid and lists it.
    await page.getByRole('button', { name: '2 октября, 1 событие' }).click()
    const sheet = page.getByRole('dialog', { name: '2 октября' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Ужин у бабушки')).toBeVisible()
  })

  test('an event is created through the editor with the space zone as the default', async ({
    page,
  }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()

    await page.getByRole('link', { name: 'Событие' }).click()
    await expect(page).toHaveURL(/\/calendar\/new$/)
    await page.getByLabel('Название').fill('Прогулка по парку')
    // The zone field defaults to the space's; the times to the evening.
    await expect(page.getByLabel('Часовой пояс')).toHaveValue('Europe/Moscow')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Событие создано')).toBeVisible()
    await expect(page.getByText('Прогулка по парку')).toBeVisible()
  })

  test('an event is edited and deleted behind its confirm', async ({ page }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()

    // The event screen opens from the agenda; the edit replaces the whole
    // event — the title here — and the saved toast follows.
    await page.getByText('День рождения Люды').click()
    await expect(page).toHaveURL(new RegExp(`/calendar/${SEEDED_BIRTHDAY.id}$`))
    await page.getByRole('link', { name: /Изменить/ }).click()
    await expect(page).toHaveURL(new RegExp(`/calendar/${SEEDED_BIRTHDAY.id}/edit$`))
    const title = page.getByLabel('Название')
    await expect(title).toHaveValue('День рождения Люды')
    await title.fill('День рождения Люды — тортик')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Изменения сохранены')).toBeVisible()
    await expect(page.getByText('День рождения Люды — тортик')).toBeVisible()

    // The removal stands behind its confirm.
    await page.getByRole('button', { name: /Удалить/ }).click()
    await expect(page.getByText('Удалить «День рождения Люды — тортик»?')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByText('Событие удалено')).toBeVisible()
    await expect(page).toHaveURL(/\/calendar$/)
    await expect(page.getByText('День рождения Люды — тортик')).toHaveCount(0)
  })
})

// The same reads away from UTC (issue #20): the all-day date stays where
// it was created, and the timed event's local time follows the device.
test.describe('the calendar away from UTC', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('the all-day date stays put and the local time follows the device', async ({ page }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()

    // The birthday is still the 19th; the dinner reads in Pacific time —
    // 08:00 against its 18:00 Moscow origin.
    await expect(page.getByText('весь день · 19 октября')).toBeVisible()
    await expect(page.getByText('08:00 – 11:00 · 18:00 – 21:00 · Moscow (UTC+3)')).toBeVisible()
  })
})

// The repeating series (issue #21): created with its rule, one occurrence
// cancelled through the occurrence route, the whole series edited through
// the scope dialog — the flows the ticket names, over the stateful mock.
test.describe('a repeating series', () => {
  test('a series is created, one occurrence cancelled, and the series edited', async ({ page }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()

    // The editor's repeating section: weekly, bounded by an end date.
    await page.getByRole('link', { name: 'Событие' }).click()
    await page.getByLabel('Название').fill('Утренняя зарядка')
    await page.getByLabel('Дата').fill('2026-10-05')
    await page.getByLabel('Повтор').selectOption('weekly')
    await page.getByLabel('Дата окончания').fill('2027-01-31')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Событие создано')).toBeVisible()

    // The event screen names the series and its end.
    await expect(page.getByText('Каждую неделю')).toBeVisible()
    await expect(page.getByText(/до 31 января 2027/)).toBeVisible()

    // The delete asks what to cancel; the occurrence route takes the
    // series' first date.
    await page.getByRole('button', { name: /Удалить/ }).click()
    await expect(page.getByText('Отменить это событие или удалить всю серию?')).toBeVisible()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Отменить только это событие' })
      .click()
    await expect(page.getByText('Событие отменено')).toBeVisible()
    await expect(page).toHaveURL(/\/calendar$/)

    // The cancelled Monday is off the calendar: the day's sheet is empty,
    // the next Monday still carries the series.
    await page.getByRole('button', { name: '5 октября, 0 событий', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '5 октября' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('В этот день событий нет')).toBeVisible()
    await sheet.getByRole('button', { name: 'Закрыть' }).click()
    await page.getByRole('button', { name: '12 октября, 1 событие', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: '12 октября' }).getByText('Утренняя зарядка'),
    ).toBeVisible()

    // The edit asks what to change; the whole series is replaced.
    await page.getByRole('dialog', { name: '12 октября' }).getByText('Утренняя зарядка').click()
    await expect(page).toHaveURL(/\/calendar\/[\w-]+\?date=2026-10-12$/)
    await page.getByRole('button', { name: /Изменить/ }).click()
    await expect(page.getByText('Что изменить?')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Всю серию' }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(page.getByLabel('Повтор')).toHaveValue('weekly')
    await page.getByLabel('Название').fill('Утренняя зарядка — с разминкой')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Изменения сохранены')).toBeVisible()
    await expect(page.getByText('Утренняя зарядка — с разминкой')).toBeVisible()
  })

  test('the editor offers the repeat choices and refuses an until before the event', async ({
    page,
  }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()
    await page.getByRole('link', { name: 'Событие' }).click()

    // The choices the ticket keeps: none and the four frequencies.
    const repeat = page.getByLabel('Повтор')
    await expect(repeat).toHaveValue('none')
    await repeat.selectOption('daily')
    await page.getByLabel('Дата окончания').fill('2020-01-01')
    await page.getByLabel('Название').fill('Зарядка')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(
      page.getByText('Дата окончания не может быть раньше первого события'),
    ).toBeVisible()
    await expect(page.getByText('Событие создано')).toHaveCount(0)
  })
})

test.describe('a repeating series, one occurrence edited', () => {
  test('the occurrence is replaced on its own and the series goes on', async ({ page }) => {
    await mockCalendarApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Календарь' }).first().click()

    // A weekly Monday series without an end.
    await page.getByRole('link', { name: 'Событие' }).click()
    await page.getByLabel('Название').fill('Утренняя зарядка')
    await page.getByLabel('Дата').fill('2026-10-05')
    await page.getByLabel('Повтор').selectOption('weekly')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Событие создано')).toBeVisible()

    // Back to the month, where the series' occurrences now stand.
    await page.getByRole('button', { name: 'Календарь' }).first().click()
    await expect(page).toHaveURL(/\/calendar$/)

    // The 12th's occurrence opens from its day sheet (the 19th also holds
    // the seeded birthday); the edit asks what to change, and "this
    // occurrence" carries the original date.
    await page.getByRole('button', { name: '12 октября, 1 событие', exact: true }).click()
    await page.getByRole('dialog', { name: '12 октября' }).getByText('Утренняя зарядка').click()
    await expect(page).toHaveURL(/date=2026-10-12$/)
    await page.getByRole('button', { name: /Изменить/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Только это событие' }).click()
    await expect(page).toHaveURL(/\/edit\?date=2026-10-12$/)
    // A single occurrence has no rule of its own.
    await expect(page.getByLabel('Повтор')).toHaveCount(0)
    await page.getByLabel('Название').fill('Зарядка у Димы')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Изменения сохранены')).toBeVisible()
    await expect(page.getByText('Зарядка у Димы')).toBeVisible()

    // The override travels with the series: the 19th keeps the series'
    // title, the 12th's row is the replacement.
    await page.getByRole('button', { name: 'Календарь' }).first().click()
    await page.getByRole('button', { name: '19 октября, 2 события', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: '19 октября' }).getByText('Утренняя зарядка'),
    ).toBeVisible()
    await page
      .getByRole('dialog', { name: '19 октября' })
      .getByRole('button', { name: 'Закрыть' })
      .click()
    await page.getByRole('button', { name: '12 октября, 1 событие', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: '12 октября' }).getByText('Зарядка у Димы'),
    ).toBeVisible()
  })
})
