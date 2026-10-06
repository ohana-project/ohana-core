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
const CODES = /\/api\/v1\/spaces\/[0-9a-f-]+\/access-codes$/

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

interface MockCode {
  id: string
  memberId: string
  status: 'issued' | 'redeemed' | 'expired' | 'replaced' | 'revoked'
  createdAt: string
  expiresAt: string
  statusChangedAt: string
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
    codes?: Array<Partial<MockCode>>
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

  const codes: MockCode[] = (
    options.codes ?? [
      { memberId: members[0]?.id ?? '', status: 'issued' },
      { memberId: members[1]?.id ?? '', status: 'redeemed' },
      { memberId: members[2]?.id ?? '', status: 'revoked' },
    ]
  ).map((code, index) => ({
    id: nextId(),
    createdAt: '2026-09-20T10:00:00.000Z',
    expiresAt: '2026-09-21T10:00:00.000Z',
    statusChangedAt: `2026-09-20T10:0${index}:00.000Z`,
    ...code,
  })) as MockCode[]

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

  await page.route(CODES, async (route) => {
    const request = route.request()
    const spaceId = request.url().match(/spaces\/([0-9a-f-]+)\/access-codes$/)?.[1] ?? ''
    if (request.method() === 'GET') {
      // The mock codes all live in the first space.
      return route.fulfill(jsonBody(spaceId === familySpace.id ? codes : []))
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { memberId: string }
      const code: MockCode = {
        id: nextId(),
        memberId: body.memberId,
        status: 'issued',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        statusChangedAt: new Date().toISOString(),
      }
      codes.unshift(code)
      return route.fulfill(jsonBody(code, 201))
    }
    return route.fulfill({ status: 405 })
  })

  return { spaces, members, codes }
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

  test('measures the header by width: no horizontal scroll, the action wraps at phone widths (ru)', async ({
    page,
  }) => {
    await mockAdminApi(page)

    // The prototype's centred row: the subtitle narrows first, the action
    // wraps when the two truly cannot share a row. The prototype itself
    // overflows a 390px viewport by about 17px here; the implementation
    // keeps the no-scroll rule instead (README, known defects). Every
    // measuring spec reads metrics, so wait out the webfonts; measure
    // after the settings line lands — it is the header's widest state.
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/admin')
      await expect(page.getByRole('link', { name: /Наша семья/ })).toBeVisible()
      await expect(page.getByText(/хранение корзины/)).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)

      // Pin both sides of the recorded deviation: at 360 and 390px the
      // action sits on its own row under the title; at 1280px they share
      // one row.
      const title = await page.getByRole('heading', { name: 'Пространства' }).boundingBox()
      const action = await page.getByRole('button', { name: 'Новое пространство' }).boundingBox()
      if (!title || !action) throw new Error('the header never rendered')
      if (width >= 1280) {
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
    await expect(page.getByText('создано 12 августа · корзина хранится 30 дней')).toBeVisible()
    // Member rows carry the monogram avatar; the code rows naming «Аня»
    // lead with an icon instead.
    const memberRow = (name: string) =>
      page
        .locator('[data-slot=item]')
        .filter({ has: page.locator('[data-slot=avatar]') })
        .filter({ hasText: name })
    await expect(memberRow('Аня')).toContainText('Владелец')
    await expect(memberRow('Миша')).toContainText('+7 900 000-00-00')
    await expect(memberRow('Люда')).toContainText('бабушка Люда')
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
    // The header subtitle carries the retention (issue #80); the time zone
    // lives in the settings sheet.
    await expect(page.getByText(/корзина хранится 30 дней/)).toBeVisible()
    expect(model.spaces[0]).toMatchObject({ name: 'Семья Смирновых', timezone: 'Asia/Novosibirsk' })
  })

  test('promotes a member to owner after a confirmation (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()

    const dimaRow = page
      .locator('[data-slot=item]')
      .filter({ has: page.locator('[data-slot=avatar]') })
      .filter({ hasText: 'Дима' })
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

/*
 * Measuring specs for the design parity of the space and settings screens
 * (issue #80): every value below is the prototype stylesheet's own
 * (admin-space.html, admin-settings.html), read from the rendered app.
 */

test.describe('administrative space screen parity', () => {
  // Member rows lead with the monogram avatar; code rows naming the same
  // member lead with an icon.
  function memberRow(page: Page, name: string) {
    return page
      .locator('[data-slot=item]')
      .filter({ has: page.locator('[data-slot=avatar]') })
      .filter({ hasText: name })
  }

  async function openSpace(page: Page) {
    await mockAdminApi(page)
    await page.goto('/admin')
    await page.getByRole('link', { name: /Наша семья/ }).click()
    await expect(page.getByRole('heading', { name: 'Наша семья' })).toBeVisible()
    // The metrics read styles and boxes; the webfonts must be settled.
    await page.evaluate(() => document.fonts.ready)
  }

  test('carries the prototype values at 390px and 1280px (ru)', async ({ page }) => {
    await openSpace(page)

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('heading', { name: 'Участники', level: 3 })).toBeVisible()

      // Section headings: h3, 16px sans, the 4px inset and 10px below on
      // the header row.
      for (const name of ['Участники', 'Коды входа']) {
        const heading = page.getByRole('heading', { name, level: 3 })
        const styles = await heading.evaluate((el) => {
          const row = getComputedStyle(el.parentElement as HTMLElement)
          return {
            tag: el.tagName,
            size: getComputedStyle(el).fontSize,
            inset: row.paddingLeft,
            below: row.marginBottom,
          }
        })
        expect(styles, `${name} at ${width}px`).toEqual({
          tag: 'H3',
          size: '16px',
          inset: '4px',
          below: '10px',
        })
      }

      // Member rows: 60px with 40px avatars and 36px round actions.
      const anyaRow = memberRow(page, 'Аня')
      expect(await anyaRow.evaluate((el) => getComputedStyle(el).minHeight)).toBe('60px')
      const avatar = anyaRow.locator('[data-slot=avatar]')
      expect(await avatar.evaluate((el) => getComputedStyle(el).width)).toBe('40px')
      for (const button of await anyaRow.getByRole('button').all()) {
        const box = await button.boundingBox()
        if (!box) throw new Error('the row action never rendered a box')
        expect(box.width, `action width at ${width}px`).toBe(36)
        expect(box.height).toBe(36)
      }

      // Code rows: the bare 20px leading icon.
      const codeRow = page.locator('[data-slot=item]', { hasText: 'Выпущен' })
      const media = codeRow.locator('[data-slot=item-media]')
      expect(await media.getAttribute('data-variant')).toBe('default')
      expect(
        await media.evaluate((el) => {
          const svg = el.querySelector('svg')
          if (svg === null) throw new Error('the row icon never rendered')
          return getComputedStyle(svg).width
        }),
      ).toBe('20px')

      // The 12.5px hints under the cards.
      for (const hint of ['Роль владельца можно передать', 'Код работает один раз']) {
        const line = page.getByText(hint, { exact: false })
        expect(await line.evaluate((el) => getComputedStyle(el).fontSize), hint).toBe('12.5px')
      }

      // One primary button in the viewport.
      expect(await page.locator('button.bg-primary:visible').count()).toBe(1)

      // Nothing scrolls horizontally.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)
    }
  })

  test('separates the sections by the prototype’s 26px under a 24px header', async ({ page }) => {
    await openSpace(page)
    await page.setViewportSize({ width: 1280, height: 900 })

    const gap = await page.evaluate(() => {
      const headingOf = (name: string) =>
        [...document.querySelectorAll('main h3')].find((el) => el.textContent === name)
      const members = headingOf('Участники')?.closest('section')
      const codes = headingOf('Коды входа')?.closest('section')
      if (!members || !codes) throw new Error('the sections never rendered')
      return codes.getBoundingClientRect().top - members.getBoundingClientRect().bottom
    })
    expect(gap).toBe(26)
  })

  test('holds the member rows at 360px without wrapping', async ({ page }) => {
    await openSpace(page)
    await page.setViewportSize({ width: 360, height: 800 })
    await expect(page.getByRole('heading', { name: 'Участники', level: 3 })).toBeVisible()

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)

    // Every member row keeps its single 60px line: the description clips
    // instead of wrapping the row taller.
    for (const row of await page.locator('[data-slot=item]').all()) {
      const box = await row.boundingBox()
      if (!box) throw new Error('the row never rendered a box')
      expect(box.height).toBeLessThanOrEqual(70)
    }
    // Миша's row carries the phone line: it clips instead of wrapping.
    const mishaSub = memberRow(page, 'Миша').locator('[data-slot=item-description]')
    expect(await mishaSub.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap')
  })

  test('tooltips name the row actions (ru)', async ({ page }) => {
    await openSpace(page)

    // Base UI's popup carries no tooltip role; the content slot is the
    // contract here.
    const tooltip = page.locator('[data-slot=tooltip-content]')
    const crown = memberRow(page, 'Дима').getByRole('button', { name: 'Сделать владельцем' })
    await crown.hover()
    await expect(tooltip).toContainText('Сделать владельцем')

    await page.mouse.move(0, 0)
    await expect(tooltip).toHaveCount(0)
  })

  test('keeps the prototype values in the dark theme', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ohana.theme', 'dark'))
    await openSpace(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    const anyaRow = memberRow(page, 'Аня')
    expect(await anyaRow.evaluate((el) => getComputedStyle(el).minHeight)).toBe('60px')
    expect(
      await anyaRow
        .locator('[data-slot=avatar]')
        .evaluate((el) => getComputedStyle(el).width),
    ).toBe('40px')
    expect(await page.locator('button.bg-primary:visible').count()).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
  })
})

test.describe('administrative settings parity', () => {
  async function openSettings(page: Page, options: { dark?: boolean } = {}) {
    if (options.dark) {
      await page.addInitScript(() => window.localStorage.setItem('ohana.theme', 'dark'))
    }
    await mockAdminApi(page)
    await page.goto('/admin/settings')
    await expect(page.getByRole('heading', { name: 'Настройки инстанса' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
  }

  test('carries the prototype values (ru)', async ({ page }) => {
    await openSettings(page)

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('heading', { name: 'Корзина', level: 3 })).toBeVisible()

      // The 760px column, centred, at the desktop width.
      if (width >= 1280) {
        const main = await page.locator('main').boundingBox()
        if (!main) throw new Error('main never rendered a box')
        expect(main.width).toBe(760)
        expect(main.x).toBe((1280 - 760) / 2)
      }

      // 24px after the header, 26px between the sections.
      const rhythm = await page.evaluate(() => {
        const header = document.querySelector('main header')
        const headingOf = (name: string) =>
          [...document.querySelectorAll('main h3')].find((el) => el.textContent === name)
        const trash = headingOf('Корзина')?.closest('section')
        const password = headingOf('Пароль администратора')?.closest('section')
        if (!header || !trash || !password) throw new Error('the sections never rendered')
        return {
          afterHeader:
            trash.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
          between:
            password.getBoundingClientRect().top - trash.getBoundingClientRect().bottom,
        }
      })
      expect(rhythm.afterHeader, `header gap at ${width}px`).toBe(24)
      expect(rhythm.between).toBe(26)

      // The padded cards and the 280px retention select.
      for (const card of await page.locator('[data-slot=card][data-variant=padded]').all()) {
        expect(await card.evaluate((el) => getComputedStyle(el).padding), `card at ${width}px`).toBe(
          '20px',
        )
      }
      const select = page.locator('[data-slot=select]')
      expect(await select.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('280px')

      // Section headings: h3, 16px, the 4px inset, 10px below.
      const heading = page.getByRole('heading', { name: 'Корзина', level: 3 })
      const styles = await heading.evaluate((el) => {
        const row = getComputedStyle(el.parentElement as HTMLElement)
        return {
          tag: el.tagName,
          size: getComputedStyle(el).fontSize,
          inset: row.paddingLeft,
          below: row.marginBottom,
        }
      })
      expect(styles).toEqual({ tag: 'H3', size: '16px', inset: '4px', below: '10px' })

      // One primary button in the viewport («Сменить пароль»); the
      // retention save is the no-prototype secondary.
      expect(await page.locator('button.bg-primary:visible').count()).toBe(1)

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)
    }

    // The prototype's closing meta line.
    await expect(
      page.getByText('Данные семей остаются на этом сервере', { exact: false }),
    ).toBeVisible()
  })

  test('keeps the values in the dark theme and holds at 360px', async ({ page }) => {
    await openSettings(page, { dark: true })
    await page.setViewportSize({ width: 360, height: 900 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    expect(await page.locator('[data-slot=card][data-variant=padded]').count()).toBe(2)
    expect(await page.locator('button.bg-primary:visible').count()).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
  })
})
