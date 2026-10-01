import { expect, type Page, test } from '@playwright/test'

/*
 * Owner management of members and codes (issue #12): an owner invites a
 * member through their space's settings, is handed the one-time code, opens
 * the member's card to issue codes and disconnect devices, and sets the
 * space's default time zone. A regular member sees the same screens
 * read-only. Like the other specs, the member endpoints are intercepted at
 * the network level — the real cookie and header pairing is covered by the
 * API's HTTP tests.
 */

const ME = '**/api/v1/me'
const MEMBERS = '**/api/v1/members'
const ACCESS_CODE = '**/api/v1/members/*/access-code'
const SESSIONS = '**/api/v1/members/*/sessions'
const SPACE = '**/api/v1/space'
const REDEEM = '**/api/v1/access-codes/redeem'

const OWNER_CODE = 'QWEE-4455'
const REGULAR_CODE = 'ABCD-2345'

const OWNER_ID = '01900000-0000-7000-8000-000000000001'
const DIMA_ID = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const OWNER_ME = {
  member: {
    id: OWNER_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: SPACE_ID, name: 'Наша семья' },
  needsOnboarding: false,
}

const REGULAR_ME = {
  member: {
    id: DIMA_ID,
    name: 'Дима',
    role: 'regular',
    createdAt: '2026-08-13T10:00:00.000Z',
  },
  space: { id: SPACE_ID, name: 'Наша семья' },
  needsOnboarding: false,
}

const PROFILES = [
  {
    id: OWNER_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  {
    id: DIMA_ID,
    name: 'Дима',
    role: 'regular',
    createdAt: '2026-08-13T10:00:00.000Z',
  },
]

const DIMA_CODE = {
  id: '01900000-0000-7000-8000-000000000003',
  memberId: DIMA_ID,
  status: 'issued',
  createdAt: '2026-09-29T10:00:00.000Z',
  expiresAt: '2026-09-30T10:00:00.000Z',
  statusChangedAt: '2026-09-29T10:00:00.000Z',
}

const DIMA_DEVICES = [
  {
    id: '01900000-0000-7000-8000-000000001001',
    browser: 'Safari',
    platform: 'iPhone',
    createdAt: '2026-09-27T18:00:00.000Z',
    lastUsedAt: '2026-09-29T09:30:00.000Z',
  },
]

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

async function mockOwnerApi(page: Page) {
  const signedIn = new Set<string>([OWNER_ID])
  const issuedCode = 'SASF-KQLV'
  // The space answers from this object, so a PATCH in one screen is the
  // GET everywhere else — the way the real space row behaves.
  const space = {
    id: SPACE_ID,
    name: 'Наша семья',
    timezone: 'Europe/Moscow',
    sections: { journal: true, calendar: true, wishlist: true },
  }

  await page.route(REDEEM, (route) => {
    const { code } = route.request().postDataJSON() as { code: string }
    const member = code.replace('-', '') === OWNER_CODE.replace('-', '') ? OWNER_ME : REGULAR_ME
    signedIn.add(member.member.id)
    return route.fulfill({
      ...json(200, member),
      headers: {
        'set-cookie': `ohana_member_session_${member.member.id}=e2e-token; Path=/api; HttpOnly; Secure; SameSite=Lax`,
      },
    })
  })

  await page.route(ME, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    const me = memberId === OWNER_ID ? OWNER_ME : REGULAR_ME
    if (memberId === undefined || !signedIn.has(memberId)) {
      return route.fulfill(
        json(401, { error: { code: 'unauthorized', message: 'A member session is required' } }),
      )
    }
    return route.fulfill(json(200, me))
  })

  await page.route(MEMBERS, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(json(401, {}))
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string }
      return route.fulfill(
        json(201, {
          id: '01900000-0000-7000-8000-000000000004',
          name: body.name,
          role: 'regular',
          createdAt: '2026-09-29T12:00:00.000Z',
        }),
      )
    }
    return route.fulfill(json(200, PROFILES))
  })

  await page.route(ACCESS_CODE, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== OWNER_ID) return route.fulfill(json(403, {}))
    if (route.request().method() === 'GET') return route.fulfill(json(200, DIMA_CODE))
    if (route.request().method() === 'POST') {
      return route.fulfill(json(201, { ...DIMA_CODE, code: issuedCode }))
    }
    return route.fulfill(json(200, { ...DIMA_CODE, status: 'revoked' }))
  })

  await page.route(SESSIONS, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== OWNER_ID) return route.fulfill(json(403, {}))
    if (route.request().method() === 'GET') return route.fulfill(json(200, DIMA_DEVICES))
    return route.fulfill(json(204, null))
  })

  await page.route(SPACE, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(json(401, {}))
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        timezone?: string
        sections?: Partial<typeof space.sections>
      }
      if (body.timezone !== undefined) space.timezone = body.timezone
      if (body.sections !== undefined) Object.assign(space.sections, body.sections)
      return route.fulfill(json(200, space))
    }
    return route.fulfill(json(200, space))
  })
}

test.describe('owner management of members and codes', () => {
  test('an owner invites a member, manages the card, and sets the time zone', async ({ page }) => {
    await mockOwnerApi(page)

    // The owner signs in and reaches the members screen from the user menu.
    await page.goto('/')
    await page.getByLabel('Код входа').fill(OWNER_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Участники' }).click()
    await expect(page).toHaveURL(/\/members$/)
    await expect(page.getByRole('heading', { name: 'Участники' })).toBeVisible()
    await expect(page.getByText('Аня Смирнова')).toBeVisible()
    await expect(page.getByText('Дима')).toBeVisible()

    // The invite flow provisions the member and shows the code once.
    await page.getByRole('link', { name: 'Пригласить' }).click()
    await expect(page).toHaveURL(/\/members\/invite$/)
    await page.getByRole('textbox', { name: 'Имя', exact: true }).fill('Миша')
    const provisionPromise = page.waitForRequest(
      (request) => request.url().includes('/api/v1/members') && request.method() === 'POST',
    )
    await page.getByRole('button', { name: 'Пригласить и выпустить код' }).click()
    const code = await page.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect((await provisionPromise).postDataJSON()).toEqual({ name: 'Миша', role: 'regular' })

    // The member card shows the code status and the devices; disconnecting
    // every device goes through a confirmation.
    await page.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\/members$/)
    await page.getByRole('link', { name: 'Открыть карточку: Дима' }).click()
    // Exact: the devices hint mentions «код входа» in the same words.
    await expect(page.getByText('Код входа', { exact: true })).toBeVisible()
    await expect(page.getByText('Ждёт первого входа')).toBeVisible()
    await expect(page.getByText('Safari на iPhone')).toBeVisible()
    await page.getByRole('button', { name: 'Отключить всё' }).click()
    await expect(page.getByRole('heading', { name: 'Отключить все устройства?' })).toBeVisible()
    await page
      .getByRole('dialog', { name: 'Отключить все устройства?' })
      .getByRole('button', { name: 'Отключить', exact: true })
      .click()

    // The space settings change the default time zone.
    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Настройки пространства' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByText('«Наша семья» · доступно только владельцу')).toBeVisible()
    const zone = page.getByRole('combobox', { name: 'По умолчанию для новых событий' })
    await expect(zone).toHaveValue('Europe/Moscow')
    await zone.selectOption('Asia/Novosibirsk')
    const patchPromise = page.waitForRequest(
      (request) => request.url().endsWith('/api/v1/space') && request.method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Сохранить' }).click()
    expect((await patchPromise).postDataJSON()).toEqual({ timezone: 'Asia/Novosibirsk' })
    await expect(page.getByText('Настройки пространства сохранены')).toBeVisible()
  })

  test('a regular member sees the space settings read-only', async ({ page }) => {
    await mockOwnerApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(REGULAR_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The menu carries the members entry but no space settings.
    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Участники' }).click()
    await expect(page).toHaveURL(/\/members$/)
    await expect(page.getByText('Дима')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Пригласить' })).toHaveCount(0)

    // The settings screen itself turns a regular member away.
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/$/)
  })

  test('an owner hides a section and it leaves the navigation', async ({ page }) => {
    await mockOwnerApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(OWNER_CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)
    // The journal is in the navigation before the hiding.
    await expect(page.getByRole('button', { name: 'Дневник' }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Настройки пространства' }).click()
    await expect(page).toHaveURL(/\/settings$/)

    const patchPromise = page.waitForRequest(
      (request) => request.url().endsWith('/api/v1/space') && request.method() === 'PATCH',
    )
    await page.getByRole('switch', { name: 'Показывать Дневник' }).click()
    expect((await patchPromise).postDataJSON()).toEqual({ sections: { journal: false } })
    // The hiding keeps the data and says so, twice: under the switch and
    // in the toast.
    await expect(page.getByText('скрыт для всех — данные сохранены').first()).toBeVisible()
    await expect(page.getByText('Раздел скрыт — ничего не удалено')).toBeVisible()

    // Back on the home the section is gone — navigation and column — and
    // the visible calendar stays.
    await page.getByRole('button', { name: 'Главная' }).first().click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Дневник' })).toHaveCount(0)
    await expect(page.getByText('Свежее в дневнике')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Календарь' }).first()).toBeVisible()
    await expect(page.getByText('Ближайшие события')).toBeVisible()
  })
})
