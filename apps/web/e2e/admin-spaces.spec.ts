import { expect, type Page, test } from '@playwright/test'

/*
 * Specs for the administrative spaces and members screens (issue #8).
 * The administrative endpoints are intercepted at the network level: no
 * backend runs during e2e, a small in-memory model stands in for the API.
 */

const SESSION = '**/api/v1/admin/session'
const SETTINGS = '**/api/v1/admin/settings'
const SPACES = '**/api/v1/spaces'
const SPACE = /\/api\/v1\/spaces\/[0-9a-f-]+$/
const MEMBERS = /\/api\/v1\/spaces\/[0-9a-f-]+\/members$/
const MEMBER = /\/api\/v1\/spaces\/[0-9a-f-]+\/members\/[0-9a-f-]+$/

interface MockSpace {
  id: string
  name: string
  timezone: string
  revision: string
  createdAt: string
  updatedAt: string
}

interface MockMember {
  id: string
  spaceId: string
  name: string
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
  role: 'owner' | 'regular'
  revision: string
  createdAt: string
  updatedAt: string
}

function jsonBody(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

let sequence = 0
function nextId(): string {
  sequence += 1
  return `01900000-0000-7000-8000-${String(sequence).padStart(12, '0')}`
}

/**
 * Installs the mock administrative API. The space model is mutable, so the
 * specs can assert what a mutation changed on the "server".
 */
async function mockAdminApi(
  page: Page,
  options: {
    spaces?: Array<Partial<MockSpace>>
    members?: Array<Partial<MockMember>>
  } = {},
) {
  const spaces: MockSpace[] = (
    options.spaces ?? [
      { name: 'Наша семья', timezone: 'Europe/Moscow', createdAt: '2026-08-12T10:00:00.000Z' },
      { name: 'Дача', timezone: 'UTC', createdAt: '2026-09-28T10:00:00.000Z' },
    ]
  ).map((space) => ({
    id: nextId(),
    revision: '3',
    updatedAt: space.createdAt ?? '2026-09-01T10:00:00.000Z',
    ...space,
  })) as MockSpace[]

  const familySpace = spaces[0]
  if (familySpace === undefined) throw new Error('The mock model needs at least one space')

  const members: MockMember[] = (
    options.members ?? [
      { name: 'Аня', role: 'owner', email: 'anya@example.com' },
      { name: 'Дима', role: 'regular' },
      { name: 'Миша', role: 'regular', phone: '+7 900 000-00-00' },
      { name: 'Люда', role: 'regular', displayName: 'бабушка Люда' },
    ]
  ).map((member) => ({
    id: nextId(),
    spaceId: familySpace.id,
    revision: '3',
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...member,
  })) as MockMember[]

  await page.route(SESSION, async (route) => {
    const method = route.request().method()
    if (method === 'GET') return route.fulfill({ status: 204 })
    return route.fulfill({ status: 204 })
  })

  // The installation settings (the header's trash retention line).
  await page.route(SETTINGS, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    return route.fulfill(jsonBody({ trashRetentionDays: 30 }))
  })

  await page.route(SPACES, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill(
        jsonBody(
          spaces.map((space) => ({
            ...space,
            memberCount: members.filter((member) => member.spaceId === space.id).length,
          })),
        ),
      )
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { name: string }
      const now = new Date().toISOString()
      const space: MockSpace = {
        id: nextId(),
        name: body.name,
        timezone: 'UTC',
        revision: '0',
        createdAt: now,
        updatedAt: now,
      }
      spaces.push(space)
      return route.fulfill(jsonBody(space, 201))
    }
    return route.fulfill({ status: 405 })
  })

  await page.route(SPACE, async (route) => {
    const request = route.request()
    const id = request.url().match(SPACE)?.[0]?.split('/').at(-1) ?? ''
    const space = spaces.find((candidate) => candidate.id === id)
    if (space === undefined) {
      return route.fulfill(
        jsonBody({ error: { code: 'space_not_found', message: 'no such space' } }, 404),
      )
    }
    if (request.method() === 'GET') return route.fulfill(jsonBody(space))
    if (request.method() === 'PATCH') {
      const changes = request.postDataJSON() as { name?: string; timezone?: string }
      if (changes.name !== undefined) space.name = changes.name
      if (changes.timezone !== undefined) space.timezone = changes.timezone
      return route.fulfill(jsonBody(space))
    }
    return route.fulfill({ status: 405 })
  })

  await page.route(MEMBERS, async (route) => {
    const request = route.request()
    const url = request.url()
    const spaceId = url.match(/spaces\/([0-9a-f-]+)\/members$/)?.[1] ?? ''
    if (request.method() === 'GET') {
      return route.fulfill(jsonBody(members.filter((member) => member.spaceId === spaceId)))
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Partial<MockMember>
      const now = new Date().toISOString()
      const member: MockMember = {
        id: nextId(),
        spaceId,
        name: body.name ?? '',
        role: body.role ?? 'regular',
        revision: '4',
        createdAt: now,
        updatedAt: now,
      }
      members.push(member)
      return route.fulfill(jsonBody(member, 201))
    }
    return route.fulfill({ status: 405 })
  })

  await page.route(MEMBER, async (route) => {
    const request = route.request()
    const url = request.url()
    const ids = url.match(/spaces\/([0-9a-f-]+)\/members\/([0-9a-f-]+)$/)
    const member = members.find(
      (candidate) => candidate.spaceId === ids?.[1] && candidate.id === ids?.[2],
    )
    if (member === undefined) {
      return route.fulfill(
        jsonBody({ error: { code: 'member_not_found', message: 'no such member' } }, 404),
      )
    }
    if (request.method() === 'PATCH') {
      const { role } = request.postDataJSON() as { role: 'owner' | 'regular' }
      member.role = role
      return route.fulfill(jsonBody(member))
    }
    return route.fulfill({ status: 405 })
  })

  return { spaces, members }
}

test.describe('administrative spaces list', () => {
  test('lists the spaces with member counts and statuses (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: 'Пространства' })).toBeVisible()
    await expect(page.getByText('2 пространства · хранение корзины: 30 дней')).toBeVisible()
    const familyRow = page.getByRole('link', { name: /Наша семья/ })
    await expect(familyRow).toContainText('4 участника')
    await expect(familyRow).toContainText('создано 12 августа')
    await expect(familyRow).toContainText('Активное')
    const dachaRow = page.getByRole('link', { name: /Дача/ })
    await expect(dachaRow).toContainText('0 участников')
    await expect(dachaRow).toContainText('Пустое')
    await expect(
      page.getByText('Пространства независимы: участники, коды и данные не пересекаются'),
    ).toBeVisible()
  })

  test('creates a space through the sheet (ru)', async ({ page }) => {
    const model = await mockAdminApi(page)
    await page.goto('/admin')

    await page.getByRole('button', { name: 'Новое пространство' }).click()
    await page.getByLabel('Название').fill('Бабушка и внуки')
    await page.getByRole('button', { name: 'Создать' }).click()

    await expect(page.getByText('Пространство создано')).toBeVisible()
    await expect(page.getByRole('link', { name: /Бабушка и внуки/ })).toBeVisible()
    await expect(page.getByText('3 пространства')).toBeVisible()
    expect(model.spaces).toHaveLength(3)
  })

  test('demands a name before creating (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')

    await page.getByRole('button', { name: 'Новое пространство' }).click()
    await page.getByRole('button', { name: 'Создать' }).click()

    await expect(page.getByText('Придумайте название — его увидят участники')).toBeVisible()
  })

  test('renders the English spaces list (en)', async ({ page }) => {
    await mockAdminApi(page)
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: 'Spaces' })).toBeVisible()
    await expect(page.getByText('2 spaces')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New space' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Наша семья/ })).toContainText('4 members')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('keeps the header inside the viewport from 360px up (ru)', async ({ page }) => {
    await mockAdminApi(page)

    // The prototype's centred row: the subtitle narrows first, the action
    // wraps when the two truly cannot share a row. The prototype itself
    // overflows a 390px viewport by about 17px here; the implementation
    // keeps the no-scroll rule instead (README, known defects). Measure
    // after the settings line lands: it is the header's widest state.
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/admin')
      await expect(page.getByRole('link', { name: /Наша семья/ })).toBeVisible()
      await expect(page.getByText(/хранение корзины/)).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)

      // Pin both sides of the recorded deviation: beneath 1280 the action
      // sits on its own row under the title; at 1280 they share one row.
      const title = await page.getByRole('heading', { name: 'Пространства' }).boundingBox()
      const action = await page.getByRole('button', { name: 'Новое пространство' }).boundingBox()
      if (!title || !action) throw new Error('the header never rendered')
      if (width === 1280) {
        expect(action.y).toBeLessThan(title.y + title.height)
      } else {
        expect(action.y).toBeGreaterThanOrEqual(title.y + title.height)
      }
    }
  })
})

test.describe('administrative space screen', () => {
  test('lists the members with their roles (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    await expect(page).toHaveURL(/\/admin\/spaces\/[0-9a-f-]+$/)
    await expect(page.getByRole('heading', { name: 'Наша семья' })).toBeVisible()
    await expect(page.getByText('создано 12 августа · часовой пояс: Europe/Moscow')).toBeVisible()
    const anyaRow = page.locator('[data-slot=item]', { hasText: 'Аня' })
    await expect(anyaRow).toContainText('Владелец')
    const mishaRow = page.locator('[data-slot=item]', { hasText: 'Миша' })
    await expect(mishaRow).toContainText('+7 900 000-00-00')
    const ludaRow = page.locator('[data-slot=item]', { hasText: 'Люда' })
    await expect(ludaRow).toContainText('бабушка Люда')
    await expect(
      page.getByText('Роль владельца можно передать, но не снять с последнего'),
    ).toBeVisible()
  })

  test('returns to the list through the bar’s back link (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    // The back link lives in the bar now (issue #79) — the only way back.
    await expect(page.getByRole('heading', { name: 'Наша семья' })).toBeVisible()
    // «Пространства» is the bar's back link; exact keeps a future
    // «Настройки пространства» link from matching it.
    await page.getByRole('link', { name: 'Пространства', exact: true }).click()

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Пространства' })).toBeVisible()
  })

  test('provisions a member through the sheet (ru)', async ({ page }) => {
    const model = await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    await page.getByRole('button', { name: 'Добавить участника' }).click()
    await page.getByLabel('Имя', { exact: true }).fill('Пётр')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    await expect(page.getByText('Участник добавлен')).toBeVisible()
    await expect(page.locator('[data-slot=item]', { hasText: 'Пётр' })).toBeVisible()
    expect(model.members).toHaveLength(5)
  })

  test('renames the space and changes its time zone from settings (ru)', async ({ page }) => {
    const model = await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    await page.getByRole('button', { name: 'Настройки' }).click()
    await expect(page.getByText('Настройки пространства')).toBeVisible()
    await page.getByLabel('Название').fill('Семья Смирновых')
    await page.getByLabel('Часовой пояс').selectOption('Asia/Novosibirsk')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Изменения сохранены')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Семья Смирновых' })).toBeVisible()
    await expect(page.getByText(/часовой пояс: Asia\/Novosibirsk/)).toBeVisible()
    expect(model.spaces[0]).toMatchObject({ name: 'Семья Смирновых', timezone: 'Asia/Novosibirsk' })
  })

  test('promotes a member to owner after a confirmation (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    const dimaRow = page.locator('[data-slot=item]', { hasText: 'Дима' })
    await dimaRow.getByRole('button', { name: 'Сделать владельцем' }).click()
    await expect(page.getByText('Дима станет владельцем?')).toBeVisible()
    await page.getByRole('button', { name: 'Сделать владельцем', exact: true }).click()

    await expect(dimaRow.locator('[data-slot=badge]', { hasText: 'Владелец' })).toBeVisible()
  })

  test('offers the English space screen (en)', async ({ page }) => {
    await mockAdminApi(page)
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    await expect(page.getByRole('button', { name: 'Add a member' })).toBeVisible()
    await expect(page.getByText('Owner').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  })

  test('a signed-in administrator at /admin/password lands on the settings screen', async ({
    page,
  }) => {
    await mockAdminApi(page)
    await page.goto('/admin/password')

    await expect(page).toHaveURL(/\/admin\/settings$/)
    await expect(page.getByRole('heading', { name: 'Настройки инстанса' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Пароль администратора' })).toBeVisible()
  })
})
