import { expect, type Page, test } from '@playwright/test'

/*
 * Several sign-ins on one device (issue #10, ADR-0005): a person who
 * belongs to two spaces signs in to both, switches between them through
 * the accounts screen, reviews the devices of the active member, and
 * signs out of one space without losing the other. Like the other specs,
 * the member endpoints are intercepted at the network level — the real
 * cookie and header pairing is covered by the API's HTTP tests — with the
 * mock honouring the X-Ohana-Member header the way the API does.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const SESSIONS = '**/api/v1/me/sessions'
const SESSION = '**/api/v1/me/session'

const FAMILY_CODE = 'QWEE-4455'
const DACHA_CODE = 'ABCD-2345'

const FAMILY_ANYA = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Аня',
  displayName: 'Аня Смирнова',
  role: 'owner',
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
}

const DACHA_ANYA = {
  id: '01900000-0000-7000-8000-000000000002',
  name: 'Аня',
  role: 'regular',
  space: { id: '01900000-0000-7000-8000-00000000000b', name: 'Аня и родители' },
}

const FAMILY_SESSIONS = [
  {
    id: '01900000-0000-7000-8000-000000001001',
    browser: 'Chrome',
    platform: 'Windows',
    createdAt: '2026-09-28T10:00:00.000Z',
    lastUsedAt: '2026-09-29T09:30:00.000Z',
    current: true,
  },
  {
    id: '01900000-0000-7000-8000-000000001002',
    browser: 'Safari',
    platform: 'iPhone',
    createdAt: '2026-09-27T18:00:00.000Z',
    lastUsedAt: '2026-09-28T20:15:00.000Z',
    current: false,
  },
]

const DACHA_SESSIONS = [
  {
    id: '01900000-0000-7000-8000-000000001003',
    browser: 'Firefox',
    platform: 'Linux',
    createdAt: '2026-09-29T11:00:00.000Z',
    lastUsedAt: '2026-09-29T11:30:00.000Z',
    current: true,
  },
]

const unauthorized = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({
    error: { code: 'unauthorized', message: 'A member session is required' },
  }),
}

async function mockMemberApi(page: Page) {
  const signedIn = new Set<string>()

  await page.route(ME, (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(unauthorized)
    const member = memberId === FAMILY_ANYA.id ? FAMILY_ANYA : DACHA_ANYA
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member,
        space: member.space,
        needsOnboarding: false,
      }),
    })
  })

  await page.route(REDEEM, (route) => {
    const { code } = route.request().postDataJSON() as { code: string }
    const isFamily = code.replace('-', '') === FAMILY_CODE.replace('-', '')
    const isDacha = code.replace('-', '') === DACHA_CODE.replace('-', '')
    if (!isFamily && !isDacha) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'access_code_invalid', message: 'No code matches' },
        }),
      })
    }
    const member = isFamily ? FAMILY_ANYA : DACHA_ANYA
    signedIn.add(member.id)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ member, space: member.space, needsOnboarding: false }),
      headers: {
        // The browser keeps one cookie per member; the mock records only
        // that the session exists.
        'set-cookie': `ohana_member_session_${member.id}=e2e-token; Path=/api; HttpOnly; Secure; SameSite=Lax`,
      },
    })
  })

  await page.route(SESSIONS, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(unauthorized)
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    const sessions = memberId === FAMILY_ANYA.id ? FAMILY_SESSIONS : DACHA_SESSIONS
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessions),
    })
  })

  await page.route('**/api/v1/me/sessions/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 405 })
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(unauthorized)
    return route.fulfill({ status: 204 })
  })

  await page.route(SESSION, (route) => {
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 405 })
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== undefined) signedIn.delete(memberId)
    return route.fulfill({ status: 204 })
  })
}

async function openAccountsFromMenu(page: Page) {
  await page.getByRole('button', { name: 'Меню пользователя' }).click()
  // The menu item is «Сменить пространство» (issue #63); exact, because the
  // owner menu's «Настройки пространства» shares the words «пространств…».
  await page.getByRole('menuitem', { name: 'Сменить пространство' }).click()
  await expect(page).toHaveURL(/\/accounts$/)
}

test.describe('several sign-ins on one device', () => {
  test('signs in to two spaces, switches between them, and reviews devices', async ({ page }) => {
    await mockMemberApi(page)

    // The first sign-in lands in «Наша семья».
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)
    await page.getByLabel('Код входа').fill(FAMILY_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Наша семья').first()).toBeVisible()

    // The accounts screen lists the one retained sign-in.
    await openAccountsFromMenu(page)
    await expect(page.getByRole('heading', { name: 'Пространства' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Войти как Аня Смирнова в «Наша семья»' }),
    ).toBeVisible()
    await expect(page.getByText('сейчас')).toBeVisible()

    // Adding a sign-in by code brings the second space in without
    // disturbing the first.
    await page.getByRole('link', { name: 'Добавить вход по коду' }).click()
    await expect(page).toHaveURL(/\/signin$/)
    await page.getByLabel('Код входа').fill(DACHA_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Аня и родители').first()).toBeVisible()

    // Both retained sign-ins are listed; the new one is active.
    await openAccountsFromMenu(page)
    await expect(
      page.getByRole('button', { name: 'Войти как Аня Смирнова в «Наша семья»' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Войти как Аня в «Аня и родители»' }),
    ).toBeVisible()
    await expect(page.getByText('сейчас')).toBeVisible()

    // The device review belongs to the new active member alone: the first
    // space's device list must not flash through after the switch.
    await expect(page.getByText('Firefox на Linux')).toBeVisible()
    await expect(page.getByText('Safari на iPhone')).toHaveCount(0)
    await expect(page.getByText('Chrome на Windows')).toHaveCount(0)

    // Switching back to «Наша семья» makes its home the active screen.
    await page.getByRole('button', { name: 'Войти как Аня Смирнова в «Наша семья»' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Наша семья').first()).toBeVisible()

    // The device review shows the retained sessions of the active member.
    await openAccountsFromMenu(page)
    await expect(page.getByText('Chrome на Windows')).toBeVisible()
    await expect(page.getByText('Safari на iPhone')).toBeVisible()
    await expect(page.getByText('это устройство')).toBeVisible()
  })

  test('revoking another device keeps the member, signing out falls back to the other space', async ({
    page,
  }) => {
    await mockMemberApi(page)

    await page.goto('/signin')
    await page.getByLabel('Код входа').fill(FAMILY_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The second sign-in joins the first on the same device.
    await openAccountsFromMenu(page)
    await page.getByRole('link', { name: 'Добавить вход по коду' }).click()
    await expect(page).toHaveURL(/\/signin$/)
    await page.getByLabel('Код входа').fill(DACHA_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // Back into «Наша семья» through the switcher, then review its devices.
    await openAccountsFromMenu(page)
    await page.getByRole('button', { name: 'Войти как Аня Смирнова в «Наша семья»' }).click()
    await expect(page).toHaveURL(/\/$/)
    await openAccountsFromMenu(page)

    // Revoking the phone's session goes through a confirmation.
    await page.getByRole('button', { name: 'Завершить сессию' }).nth(1).click()
    await expect(page.getByRole('heading', { name: 'Завершить эту сессию?' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Завершить', exact: true }).click()
    // The member stays signed in: the list still marks this device.
    await expect(page.getByText('это устройство')).toBeVisible()

    // Signing out of «Наша семья» keeps the other retained sign-in, which
    // becomes active.
    await page.getByRole('button', { name: 'Выйти из «Наша семья»' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Аня и родители').first()).toBeVisible()
  })

  test('renders the accounts screen in English (en)', async ({ page }) => {
    await mockMemberApi(page)
    await page.addInitScript(() => {
      window.localStorage.setItem('ohana.locale', 'en')
      window.localStorage.setItem(
        'ohana.sessions',
        JSON.stringify([
          {
            memberId: '01900000-0000-7000-8000-000000000001',
            spaceId: '01900000-0000-7000-8000-00000000000a',
            spaceName: 'Наша семья',
            name: 'Аня',
            displayName: 'Аня Смирнова',
          },
        ]),
      )
      window.localStorage.setItem('ohana.activeMember', '01900000-0000-7000-8000-000000000001')
    })
    await page.goto('/accounts')

    await expect(page.getByRole('heading', { name: 'Spaces' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add a sign-in by code' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Switch to Аня Смирнова in “Наша семья”' }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})
