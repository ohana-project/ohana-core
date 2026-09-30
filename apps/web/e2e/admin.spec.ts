import { expect, type Page, test } from '@playwright/test'

/*
 * Specs for the administrative sign-in and password screens (issue #7).
 * The administrative endpoints are intercepted at the network level: no
 * backend runs during e2e, the mocks stand in for the session lifecycle.
 */

const SESSION = '**/api/v1/admin/session'
const PASSWORD = '**/api/v1/admin/password'

const CORRECT_PASSWORD = 'a-correct-server-password'
const WRONG_PASSWORD = 'a-wrong-server-password'

const unauthorized = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({
    error: { code: 'unauthorized', message: 'An administrative session is required' },
  }),
}

const invalidCredentials = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({
    error: { code: 'invalid_credentials', message: 'The password is wrong' },
  }),
}

async function mockAdminApi(page: Page, options: { signedIn?: boolean } = {}) {
  let signedIn = options.signedIn ?? false
  await page.route(SESSION, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill(signedIn ? { status: 204 } : unauthorized)
    }
    if (request.method() === 'POST') {
      const { password } = request.postDataJSON() as { password: string }
      if (password !== CORRECT_PASSWORD) return route.fulfill(invalidCredentials)
      signedIn = true
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'DELETE') {
      signedIn = false
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 405 })
  })
  await page.route(PASSWORD, async (route) => {
    const { currentPassword, newPassword } = route.request().postDataJSON() as {
      currentPassword: string
      newPassword: string
    }
    if (currentPassword !== CORRECT_PASSWORD || newPassword.length < 10) {
      return route.fulfill(invalidCredentials)
    }
    return route.fulfill({ status: 204 })
  })
  // Since ticket #8 the signed-in landing is the spaces list.
  await page.route('**/api/v1/spaces', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405 })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
}

test.describe('administrative sign-in', () => {
  test('signs in and lands on the spaces list (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin/login')

    await expect(page.getByRole('heading', { name: 'Сервер под паролем' })).toBeVisible()
    await page.getByLabel('Пароль администратора').fill(CORRECT_PASSWORD)
    await page.getByRole('button', { name: 'Войти в админку' }).click()

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Пространства' })).toBeVisible()
  })

  test('rejects a wrong password with an inline error (ru)', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin/login')

    await page.getByLabel('Пароль администратора').fill(WRONG_PASSWORD)
    await page.getByRole('button', { name: 'Войти в админку' }).click()

    await expect(page.getByRole('alert')).toContainText('Неверный пароль — попробуйте ещё раз')
    await expect(page).toHaveURL(/\/admin\/login$/)
  })

  test('renders the English sign-in screen (en)', async ({ page }) => {
    await mockAdminApi(page)
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))
    await page.goto('/admin/login')

    await expect(
      page.getByRole('heading', { name: 'The server is password-protected' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in to the admin area' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('a signed-out visitor at /admin is sent to the sign-in screen', async ({ page }) => {
    await mockAdminApi(page)
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/admin\/login$/)
    await expect(page.getByRole('heading', { name: 'Сервер под паролем' })).toBeVisible()
  })

  test('a signed-in administrator skips the sign-in screen', async ({ page }) => {
    await mockAdminApi(page, { signedIn: true })
    await page.goto('/admin/login')

    await expect(page).toHaveURL(/\/admin$/)
  })
})

test.describe('administrative password change', () => {
  test('changes the password and confirms with a toast (ru)', async ({ page }) => {
    await mockAdminApi(page, { signedIn: true })
    await page.goto('/admin/settings')

    await page.getByLabel('Текущий пароль').fill(CORRECT_PASSWORD)
    await page.getByLabel('Новый пароль', { exact: true }).fill('a-considerably-new-password')
    await page.getByLabel('Повторите новый пароль').fill('a-considerably-new-password')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()

    await expect(page.getByText('Пароль обновлён — старый больше не действует')).toBeVisible()
  })

  test('keeps the mismatch message until the passwords match (ru)', async ({ page }) => {
    await mockAdminApi(page, { signedIn: true })
    await page.goto('/admin/settings')

    await page.getByLabel('Текущий пароль').fill(CORRECT_PASSWORD)
    await page.getByLabel('Новый пароль', { exact: true }).fill('a-considerably-new-password')
    await page.getByLabel('Повторите новый пароль').fill('a-considerably-new-password-typo')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()

    await expect(page.getByRole('alert')).toContainText('Пароли не совпадают')
  })

  test('offers sign-out from the administrative area (ru)', async ({ page }) => {
    await mockAdminApi(page, { signedIn: true })
    await page.goto('/admin/settings')

    await page.getByRole('button', { name: 'Выйти из админки' }).click()

    await expect(page).toHaveURL(/\/admin\/login$/)
    await expect(page.getByRole('heading', { name: 'Сервер под паролем' })).toBeVisible()
  })
})
