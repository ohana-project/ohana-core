import { expect, type Page, test } from '@playwright/test'

/*
 * The notifications' interface flows (issue #22): the screen where a
 * member enables reminders on this device — behind the browser's user
 * gesture — and flips the device's own opt-in to event details; the iOS
 * note that says reminders need the installed app, in Russian and in
 * English; and the editor's reminder section, whose recipients ride the
 * event create. The member and push endpoints are intercepted at the
 * network level over a small stateful mock — the real rules for
 * subscriptions and delivery are covered by the API's tests.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const SYNC = '**/api/v1/sync*'
const PUBLIC_KEY = '**/api/v1/notifications/push/public-key'
// The trailing * spans the GET's ?endpoint=… query.
const SUBSCRIPTION = '**/api/v1/notifications/push/subscription*'
const EVENTS = '**/api/v1/calendar/events'

const ANYA_ID = '01900000-0000-7000-8000-000000000001'
const BORIS_ID = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const CODE = 'QWEE-4455'
const ENDPOINT = 'https://push.example/e2e-device'

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
  {
    id: BORIS_ID,
    name: 'Борис',
    displayName: 'Борис Ливанов',
    role: 'regular',
    createdAt: '2026-08-12T10:05:00.000Z',
  },
]

const SPACE = {
  id: SPACE_ID,
  name: 'Наша семья',
  timezone: 'Europe/Moscow',
  sections: { journal: true, calendar: true, wishlist: true },
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

/**
 * The browser half, faked before any app code runs: the Notification
 * permission is granted on ask, and the push manager mints a stable
 * subscription. The real worker is not registered in the dev-server
 * harness, so `navigator.serviceWorker.ready` stands in.
 */
async function fakePushBrowser(page: Page) {
  await page.addInitScript(() => {
    const permission = { value: 'default' as 'default' | 'granted' | 'denied' }
    const fakeNotification = {
      get permission() {
        return permission.value
      },
      requestPermission: async () => {
        permission.value = 'granted'
        return permission.value
      },
    }
    window.Notification = fakeNotification as unknown as typeof Notification
    const subscription = {
      endpoint: 'https://push.example/e2e-device',
      toJSON: () => ({
        endpoint: subscription.endpoint,
        keys: { p256dh: 'p256dh-e2e', auth: 'auth-e2e' },
      }),
      unsubscribe: async () => true,
      registered: false,
    }
    const pushManager = {
      subscribe: async (options: unknown) => {
        subscription.registered = true
        void options
        return subscription
      },
      getSubscription: async () => (subscription.registered ? subscription : null),
    }
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager }) },
    })
  })
}

interface PushMock {
  subscriptions: Array<Record<string, unknown>>
  patchBodies: Array<Record<string, unknown>>
  deletedEndpoints: string[]
}

/**
 * The mocked member and push API: the subscription routes keep the state,
 * so the screen reads back what it stored.
 */
async function mockNotificationsApi(page: Page): Promise<PushMock> {
  await page.clock.setFixedTime(new Date('2026-10-01T09:00:00.000Z'))
  const mock: PushMock = { subscriptions: [], patchBodies: [], deletedEndpoints: [] }
  const revision = 7

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
    if (memberId === undefined || memberId !== ANYA_ID) return route.fulfill(json(401, {}))
    return route.fulfill(json(200, ANYA_ME))
  })

  await page.route(SYNC, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(401, {}))
    return route.fulfill(
      json(200, {
        revision: String(revision),
        changes: [
          { entity: 'space', space: SPACE },
          ...PROFILES.map((profile) => ({ entity: 'member', member: profile })),
        ],
        tombstones: [],
      }),
    )
  })

  await page.route(PUBLIC_KEY, (route) => {
    if (route.request().headers()['x-ohana-member'] !== ANYA_ID) {
      return route.fulfill(json(401, {}))
    }
    return route.fulfill(
      json(200, {
        publicKey:
          'BGr5ELMqT2NlXWpvZdFwqFlOoZSPQxKMyh0Fh-_KqVvDQIY_P8f7PZnH0sOzM6GNog1VvY6dS7V0Q8j2p6lmesi',
      }),
    )
  })

  // The member's own row for the device, as the GET reads it; the server
  // is the truth the switches follow (one browser, possibly two members).
  let storedNotifyDetails: boolean | undefined

  await page.route(SUBSCRIPTION, (route) => {
    if (route.request().headers()['x-ohana-member'] !== ANYA_ID) {
      return route.fulfill(json(401, {}))
    }
    if (route.request().method() === 'GET') {
      return storedNotifyDetails === undefined
        ? route.fulfill(
            json(404, {
              error: { code: 'push_subscription_not_found', message: 'No subscription' },
            }),
          )
        : route.fulfill(json(200, { notifyDetails: storedNotifyDetails }))
    }
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      mock.subscriptions.push(body)
      storedNotifyDetails = body.notifyDetails === true
      return route.fulfill(json(204, undefined))
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      mock.patchBodies.push(body)
      storedNotifyDetails = body.notifyDetails === true
      return route.fulfill(json(204, undefined))
    }
    const body = route.request().postDataJSON() as { endpoint?: string }
    if (body.endpoint !== undefined) mock.deletedEndpoints.push(body.endpoint)
    storedNotifyDetails = undefined
    return route.fulfill(json(200, { releaseBrowserSubscription: true }))
  })

  return mock
}

async function signIn(page: Page) {
  await page.goto('/')
  // An iPhone is shown the install-first screen (issue #11); continuing in
  // the browser is never blocked, and the code field waits behind it — the
  // button reads in the interface's language.
  const continueInBrowser = page
    .getByRole('button', { name: 'Продолжить в браузере' })
    .or(page.getByRole('button', { name: 'Continue in the browser' }))
  if (await continueInBrowser.isVisible()) {
    await continueInBrowser.click()
  }
  await page.getByLabel('Код входа').or(page.getByLabel('Access code')).fill(CODE)
  await page
    .getByRole('button', { name: 'Войти' })
    .or(page.getByRole('button', { name: 'Sign in' }))
    .click()
  await expect(page.getByText('Наша семья').first()).toBeVisible()
}

test('a member enables reminders on this device and flips the details opt-in', async ({ page }) => {
  await fakePushBrowser(page)
  const mock = await mockNotificationsApi(page)

  await signIn(page)
  // The way the member reaches the screen: the user menu's entry.
  await page.getByRole('button', { name: 'Меню пользователя' }).click()
  await page.getByRole('menuitem', { name: 'Уведомления' }).click()
  await expect(page).toHaveURL(/\/notifications$/)

  // The device starts unsubscribed; the enable action is the user gesture
  // the browser asks for.
  await expect(page.getByText('Напоминания на этом устройстве')).toBeVisible()
  await page.getByRole('button', { name: 'Включить' }).click()

  // The subscription lands with its keys and the neutral default.
  await expect(page.getByText('Напоминания включены на этом устройстве')).toBeVisible()
  expect(mock.subscriptions).toHaveLength(1)
  expect(mock.subscriptions[0]).toMatchObject({
    endpoint: ENDPOINT,
    keys: { p256dh: 'p256dh-e2e', auth: 'auth-e2e' },
    notifyDetails: false,
  })
  await expect(page.getByText('Включено')).toBeVisible()

  // The device's own opt-in: details on this device only.
  await page.getByRole('switch', { name: 'Показывать подробности события' }).click()
  await expect(mock.patchBodies).toEqual([{ endpoint: ENDPOINT, notifyDetails: true }])
  await expect(page.getByText('Сохранено')).toBeVisible()
})

// The iPhone signature the feature detects; the e2e browser claims to be
// an iPhone through its user agent alone.
test.describe('the iOS note', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })

  test('explains in Russian that iOS needs the installed app', async ({ page }) => {
    await fakePushBrowser(page)
    await mockNotificationsApi(page)

    await signIn(page)
    await page.goto('/notifications')

    await expect(page.getByText('iOS: нужно установленное приложение')).toBeVisible()
    await expect(
      page.getByText(
        'На iPhone и iPad напоминания приходят только в приложении Ohana, установленном на экран «Домой».',
      ),
    ).toBeVisible()
  })

  test('reads in English when the interface is English', async ({ page }) => {
    await fakePushBrowser(page)
    await mockNotificationsApi(page)
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))

    await signIn(page)
    await page.goto('/notifications')

    await expect(page.getByText('iOS: the installed app is required')).toBeVisible()
    await expect(
      page.getByText(
        'On iPhone and iPad, reminders arrive only in the Ohana app installed to the Home Screen.',
      ),
    ).toBeVisible()
  })
})

test('the editor sends the reminder the member picked with its recipients', async ({ page }) => {
  await fakePushBrowser(page)
  await mockNotificationsApi(page)
  const createdBodies: Array<Record<string, unknown>> = []

  await page.route(EVENTS, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    createdBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill(
      json(201, {
        id: '01900000-0000-7000-8000-000000000501',
        creatorId: ANYA_ID,
        title: 'Обед у бабушки',
        allDay: false,
        startsAt: '2026-10-05T15:00:00.000Z',
        endsAt: '2026-10-05T18:00:00.000Z',
        timezone: 'Europe/Moscow',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      }),
    )
  })

  await signIn(page)

  // The editor sits in the calendar area; open it through the shell the
  // way the member does.
  await page.getByRole('button', { name: 'Календарь' }).first().click()
  await page.getByRole('link', { name: 'Событие' }).click()
  await page.getByLabel('Название').fill('Обед у бабушки')

  // The reminder starts off; the lead defaults to the prototype's two hours.
  const reminderSwitch = page.getByRole('switch', { name: 'Напоминание' })
  await reminderSwitch.click()
  // The prototype's default: two hours.
  await expect(page.getByLabel('За сколько напомнить')).toHaveValue('120')

  // An hour before, for everyone.
  await page.getByLabel('За сколько напомнить').selectOption('60')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByText('Событие создано')).toBeVisible()
  expect(createdBodies).toHaveLength(1)
  expect(createdBodies[0]).toMatchObject({
    title: 'Обед у бабушки',
    reminder: { leadMinutes: 60, recipients: { everyone: true } },
  })
})

test('the editor names the picked members instead of everyone', async ({ page }) => {
  await fakePushBrowser(page)
  await mockNotificationsApi(page)
  const createdBodies: Array<Record<string, unknown>> = []

  await page.route(EVENTS, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    createdBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill(
      json(201, {
        id: '01900000-0000-7000-8000-000000000502',
        creatorId: ANYA_ID,
        title: 'Сюрприз',
        allDay: false,
        startsAt: '2026-10-06T15:00:00.000Z',
        endsAt: '2026-10-06T18:00:00.000Z',
        timezone: 'Europe/Moscow',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      }),
    )
  })

  await signIn(page)
  await page.getByRole('button', { name: 'Календарь' }).first().click()
  await page.getByRole('link', { name: 'Событие' }).click()
  await page.getByLabel('Название').fill('Сюрприз')

  await page.getByRole('switch', { name: 'Напоминание' }).click()
  // The pick list begins from "everyone"; picking a person names the list
  // instead — the creator is seeded, Boris joins.
  await page.getByRole('button', { name: 'Борис Ливанов' }).click()
  await expect(page.getByRole('button', { name: 'Борис Ливанов' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Все участники' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Событие создано')).toBeVisible()
  expect(createdBodies[0]).toMatchObject({
    reminder: {
      leadMinutes: 120,
      recipients: { memberIds: [BORIS_ID] },
    },
  })
})
