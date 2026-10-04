import { expect, type Page, test } from '@playwright/test'

/*
 * The theme toggle everywhere the prototypes put it (issue #63): the
 * round toggle on the sign-in screens, «Тема» and «Сменить пространство»
 * in the user menu between the prototype's separators, and the 36px
 * round toggle in the administrative bar. The choice persists per
 * device; switching never reloads the page.
 *
 * The member and administrative endpoints are intercepted at the network
 * level, like the other specs.
 */

const ME = '**/api/v1/me'
const SYNC = '**/api/v1/sync*'
const SESSION = '**/api/v1/admin/session'
const SPACES = '**/api/v1/spaces'

const ANYA = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Аня',
  displayName: 'Аня Смирнова',
  role: 'owner',
  createdAt: '2026-08-12T10:00:00.000Z',
}

async function mockMemberApi(page: Page) {
  await page.route(ME, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member: ANYA,
        space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
        needsOnboarding: false,
      }),
      headers: {
        'set-cookie': `ohana_member_session_${ANYA.id}=e2e-token; Path=/api; HttpOnly; Secure; SameSite=Lax`,
      },
    }),
  )
  await page.route(SYNC, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        revision: '1',
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
            member: { ...ANYA, createdAt: '2026-08-12T10:00:00.000Z' },
          },
        ],
        tombstones: [],
      }),
    }),
  )
}

async function mockAdminApi(page: Page) {
  await page.route(SESSION, (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    return route.fulfill({ status: 204 })
  })
  await page.route(SPACES, (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

test.describe('theme toggle', () => {
  test('the sign-in screen toggles and remembers across a reload', async ({ page }) => {
    await page.goto('/signin')

    const toggle = page.getByRole('button', { name: 'Тёмная тема' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    // The toggle is pinned at the viewport's top right, like the prototype.
    const box = await toggle.boundingBox()
    if (!box) throw new Error('the toggle never rendered a box')
    expect(box.x + box.width).toBeGreaterThan(1280 - 40)
    expect(box.y).toBeLessThan(40)

    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => window.localStorage.getItem('ohana.theme'))).toBe('dark')

    // The stored choice survives a reload; the toggle now offers light.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // The pre-paint script carried the choice into the browser chrome:
    // index.html's media-keyed metas collapsed onto the dark colour.
    const chrome = page.locator('meta[name="theme-color"]')
    await expect(chrome).toHaveCount(2)
    for (const meta of await chrome.all()) {
      await expect(meta).toHaveAttribute('content', 'rgb(117 34 49)')
      await expect(meta).not.toHaveAttribute('media')
    }

    await page.getByRole('button', { name: 'Светлая тема' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    for (const meta of await chrome.all()) {
      await expect(meta).toHaveAttribute('content', 'rgb(246 241 238)')
    }
  })

  test('the user menu switches the theme in place and opens the accounts screen', async ({
    page,
  }) => {
    await mockMemberApi(page)
    // The seed travels as the init script's argument: the callback runs in
    // the page, where the spec's own constants do not exist.
    await page.addInitScript(
      (seed) => {
        window.localStorage.setItem('ohana.sessions', JSON.stringify(seed.sessions))
        window.localStorage.setItem('ohana.activeMember', seed.activeMember)
      },
      {
        sessions: [
          {
            memberId: ANYA.id,
            spaceId: '01900000-0000-7000-8000-00000000000a',
            spaceName: 'Наша семья',
            name: 'Аня',
            displayName: 'Аня Смирнова',
          },
        ],
        activeMember: ANYA.id,
      },
    )
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /Аня Смирнова/ })).toBeVisible()

    // The menu's pair sits between the prototype's separators; the theme
    // item announces the theme it leads to — the dark one while light,
    // like the prototype's `data-action="theme"` buttons.
    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    const themeItem = page.getByRole('menuitem', { name: 'Тёмная тема' })
    await expect(page.getByRole('menuitem', { name: 'Сменить пространство' })).toBeAttached()
    await expect(themeItem).toBeVisible()

    await themeItem.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // Switching never leaves the screen: the same address, the session intact.
    expect(page.url()).toMatch(/\/$/)
    await expect(page.getByRole('heading', { name: /Аня Смирнова/ })).toBeVisible()

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Сменить пространство' }).click()
    await expect(page).toHaveURL(/\/accounts$/)
  })

  test('the administrative bar ends with a 36px round toggle', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')

    const toggle = page.getByRole('button', { name: 'Тёмная тема' })
    await expect(toggle).toBeVisible()
    const box = await toggle.boundingBox()
    if (!box) throw new Error('the toggle never rendered a box')
    // The prototype's `.btn-icon.btn-sm`: 36px round.
    expect(box.width).toBe(36)
    expect(box.height).toBe(36)

    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page).toHaveURL(/\/admin$/)
  })
})
