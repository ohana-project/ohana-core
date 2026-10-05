import { expect, type Page, test } from '@playwright/test'

/*
 * The member sign-in flow (issue #9, ADR-0005): the access-code screen,
 * onboarding, and the space home with its section navigation. Following
 * the administrative specs' precedent, the member endpoints are
 * intercepted at the network level: the real cookie and header pairing is
 * covered by the API's HTTP tests, while this spec pins the UI flow.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const ONBOARDING = '**/api/v1/me/onboarding'
const MEMBERS = '**/api/v1/members'
const SESSION = '**/api/v1/me/session'
// The sync request carries ?since=…, so the glob spans the query too.
const SYNC = '**/api/v1/sync*'

const VALID_CODE = 'QWEE-4455'

const ANYA = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Аня',
  role: 'owner',
}

const unauthorized = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({
    error: { code: 'unauthorized', message: 'A member session is required' },
  }),
}

const invalidCode = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({
    error: { code: 'access_code_invalid', message: 'No code matches' },
  }),
}

interface MockOptions {
  /** needsOnboarding in the redemption answer (default true). */
  needsOnboarding?: boolean
}

async function mockMemberApi(page: Page, options: MockOptions = {}) {
  const needsOnboarding = options.needsOnboarding ?? true
  let signedIn = false
  let onboarded = false

  await page.route(ME, (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    if (!signedIn) return route.fulfill(unauthorized)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member: {
          ...ANYA,
          ...(onboarded ? { displayName: 'Аня Смирнова' } : {}),
        },
        space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
        needsOnboarding: signedIn && !onboarded,
      }),
    })
  })

  await page.route(REDEEM, (route) => {
    const { code } = route.request().postDataJSON() as { code: string }
    if (code.replace('-', '') !== VALID_CODE.replace('-', '')) {
      return route.fulfill(invalidCode)
    }
    signedIn = true
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member: ANYA,
        space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
        needsOnboarding,
      }),
      headers: {
        // The browser stores the per-member cookie; the mock only records
        // that the session exists.
        'set-cookie': `ohana_member_session_${ANYA.id}=e2e-token; Path=/api; HttpOnly; Secure; SameSite=Lax`,
      },
    })
  })

  await page.route(ONBOARDING, (route) => {
    onboarded = true
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member: { ...ANYA, displayName: 'Аня Смирнова' },
        space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
        needsOnboarding: false,
      }),
    })
  })

  await page.route(MEMBERS, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...ANYA,
          displayName: 'Аня Смирнова',
          email: 'anya@example.com',
          createdAt: '2026-08-12T10:00:00.000Z',
        },
        {
          id: '01900000-0000-7000-8000-000000000002',
          name: 'Дима',
          role: 'regular',
          createdAt: '2026-08-13T10:00:00.000Z',
        },
      ]),
    })
  })

  await page.route(SESSION, (route) => {
    signedIn = false
    onboarded = false
    return route.fulfill({ status: 204 })
  })

  // The home reads the synchronised partition (issue #14); the answer
  // describes the same world the other endpoints do.
  await page.route(SYNC, (route) => {
    if (!signedIn) return route.fulfill(unauthorized)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        revision: '2',
        changes: [
          {
            entity: 'space',
            space: {
              id: '01900000-0000-7000-8000-00000000000a',
              name: 'Наша семья',
              timezone: 'Europe/Moscow',
              sections: { journal: true, calendar: true, wishlist: true },
            },
          },
          {
            entity: 'member',
            member: {
              id: ANYA.id,
              name: 'Аня',
              displayName: 'Аня Смирнова',
              email: 'anya@example.com',
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
              createdAt: '2026-08-13T10:00:00.000Z',
            },
          },
        ],
        tombstones: [],
      }),
    })
  })
}

test.describe('member sign-in by access code', () => {
  // The spec walks the Russian interface: the browser presents itself as
  // a Russian device, so onboarding's device-locale preselection reads
  // Russian instead of the runner's en-US.
  test.use({ locale: 'ru-RU' })

  test('walks code entry, onboarding, and lands on the space home (ru)', async ({ page }) => {
    await mockMemberApi(page)

    // Without a session on this device, the landing sends the visitor to
    // the code screen.
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)
    await expect(page.getByRole('heading', { name: 'Код входа' })).toBeVisible()

    // A wrong code explains itself inline and stays on the screen.
    await page.getByLabel('Код входа').fill('ZZZZ-ZZZZ')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toContainText('Такого кода нет')
    await expect(page).toHaveURL(/\/signin$/)

    // The right code leads to onboarding.
    await page.getByLabel('Код входа').fill(VALID_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/onboarding$/)
    await expect(page.getByRole('heading', { name: 'Как вас назовут в семье?' })).toBeVisible()

    // Onboarding collects the optional profile and the interface language
    // (the cards come preselected; «Русский» stays). Choosing a card
    // switches the whole interface at once, and back again.
    await page.getByLabel('Имя').fill('Аня Смирнова')
    await page.getByLabel('Эл. почта').fill('anya@example.com')
    await expect(page.getByRole('radio', { name: 'Русский' })).toBeChecked()
    await page.getByRole('radio', { name: 'English' }).click()
    await expect(page.getByRole('heading', { name: 'How will the family call you?' })).toBeVisible()
    await page.getByRole('radio', { name: 'Русский' }).click()
    await expect(page.getByRole('heading', { name: 'Как вас назовут в семье?' })).toBeVisible()
    await page.getByRole('button', { name: 'Продолжить' }).click()

    // The space home greets the member by their display name and offers
    // the section navigation.
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: /Добр(ое утро|ый день|ый вечер), Аня Смирнова/ }),
    ).toBeVisible()
    // the space name stands twice by design: the sidebar's switcher and
    // the home's top-bar title, which is the space name since issue #62
    await expect(page.getByText('Наша семья').first()).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible()
    for (const section of ['Главная', 'Дневник', 'Календарь', 'Вишлисты']) {
      await expect(page.getByRole('button', { name: section }).first()).toBeVisible()
    }
    await expect(page.getByText('Свежее в дневнике')).toBeVisible()
    await expect(page.getByText('Ближайшие события')).toBeVisible()

    // The members of the space are visible with their roles.
    await expect(page.getByText('Участники')).toBeVisible()
    await expect(page.getByText('anya@example.com')).toBeVisible()
    await expect(page.getByText('Дима')).toBeVisible()
  })

  test('a member that is already onboarded goes straight home', async ({ page }) => {
    await mockMemberApi(page, { needsOnboarding: false })
    await page.goto('/signin')

    await page.getByLabel('Код входа').fill(VALID_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /Аня/ })).toBeVisible()
  })

  test('signing out returns to the code screen', async ({ page }) => {
    await mockMemberApi(page)
    await page.goto('/signin')
    await page.getByLabel('Код входа').fill(VALID_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/onboarding$/)
    await page.getByRole('button', { name: 'Продолжить' }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()

    await expect(page).toHaveURL(/\/signin$/)
    await expect(page.getByRole('heading', { name: 'Код входа' })).toBeVisible()
  })

  test('renders the English sign-in screen (en)', async ({ page }) => {
    await mockMemberApi(page)
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))
    await page.goto('/signin')

    await expect(page.getByRole('heading', { name: 'Access code' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('a device with retained sign-ins offers the way back to the accounts screen', async ({
    page,
  }) => {
    await mockMemberApi(page)
    // Two members remain signed in on this device and none is active —
    // no `ohana.activeMember`, on purpose: the probe then answers signed
    // out, the visitor sees the code screen, and the registry still
    // offers the prototype's back button.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'ohana.sessions',
        JSON.stringify([
          { memberId: 'm-1', spaceId: 's-1', spaceName: 'Наша семья', name: 'Аня' },
          { memberId: 'm-2', spaceId: 's-2', spaceName: 'Дача', name: 'Дима' },
        ]),
      )
    })
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)

    await page.getByRole('link', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/accounts$/)
    await expect(page.getByRole('heading', { name: 'Пространства' })).toBeVisible()
  })
})
