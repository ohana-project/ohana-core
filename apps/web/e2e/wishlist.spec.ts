import { expect, type Page, test } from '@playwright/test'

/*
 * The wishlist's interface flows (issue #18): the section navigation leads
 * to the wishlists overview; a wish is added through the sheet, edited
 * with the received mark, and removed behind its confirm; a member's open
 * wishes are browsed, a received one gone from the list. The member
 * endpoints are intercepted at the network level over a small stateful
 * wishlist — the real HTTP rules for authorship and removals are covered
 * by the API's tests, while this spec pins the UI flow and its reads
 * through the synchronised partition.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const WISHES = '**/api/v1/wishlist/wishes'
const WISH = '**/api/v1/wishlist/wishes/*'
const RECEIVED = '**/api/v1/wishlist/wishes/*/received'
// The sync request carries ?since=…, so the glob spans the query too.
const SYNC = '**/api/v1/sync*'

const ANYA_ID = '01900000-0000-7000-8000-000000000001'
const DIMA_ID = '01900000-0000-7000-8000-000000000002'
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
  { id: DIMA_ID, name: 'Дима', role: 'regular', createdAt: '2026-08-13T10:00:00.000Z' },
]

const SPACE = {
  id: SPACE_ID,
  name: 'Наша семья',
  timezone: 'Europe/Moscow',
  sections: { journal: true, calendar: true, wishlist: true },
}

const SEEDED_DIMA_WISH = {
  id: '01900000-0000-7000-8000-000000000301',
  authorId: DIMA_ID,
  title: 'Налобный фонарь Petzl Actik Core',
  details: 'чтобы ходить в горы в темноте',
  link: 'https://www.wildberries.ru/catalog/lamp',
  createdAt: '2026-09-25T12:00:00.000Z',
  updatedAt: '2026-09-25T12:00:00.000Z',
}

const SEEDED_DIMA_RECEIVED = {
  id: '01900000-0000-7000-8000-000000000302',
  authorId: DIMA_ID,
  title: 'Кожаный ремень',
  createdAt: '2026-09-24T12:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
  receivedAt: '2026-09-30T10:00:00.000Z',
}

interface StoredWish {
  id: string
  authorId: string
  title: string
  details?: string
  link?: string
  receivedAt?: string
  createdAt: string
  updatedAt: string
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

/**
 * The mocked member API over a small stateful wishlist: the mutations the
 * screens send change what the next sync answers, the way the server's
 * revision would deliver them. A removal drops the row from the sync's
 * upserts and answers the delete as a tombstone for everyone, the way the
 * server does (issue #18).
 */
async function mockWishlistApi(page: Page) {
  const signedIn = new Set<string>([ANYA_ID])
  const wishes: StoredWish[] = [SEEDED_DIMA_WISH, SEEDED_DIMA_RECEIVED]
  // The wishes removed along the way: a delta answers with their
  // tombstones, the way the server does (issue #18).
  const removed: string[] = []
  let nextId = 0x400
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
          ...wishes.map((wish) => ({ entity: 'wishlist_wish', wish })),
        ],
        tombstones: removed.map((entityId) => ({
          entity: 'wishlist_wish',
          entityId,
          audience: 'all',
        })),
      }),
    )
  })

  await page.route(WISHES, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const body = route.request().postDataJSON() as {
      title: string
      details?: string
      link?: string
    }
    const created: StoredWish = {
      id: `01900000-0000-7000-8000-${String(nextId++).padStart(12, '0')}`,
      authorId: ANYA_ID,
      title: body.title,
      ...(body.details === undefined ? {} : { details: body.details }),
      ...(body.link === undefined ? {} : { link: body.link }),
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
    }
    wishes.push(created)
    revision += 1
    return route.fulfill(json(201, created))
  })

  await page.route(RECEIVED, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const wishId = route.request().url().split('/').at(-2) as string
    const wish = wishes.find((row) => row.id === wishId)
    if (wish === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'wish_not_found', message: 'No such wish' } }),
      )
    }
    if (route.request().method() === 'POST') {
      if (wish.receivedAt !== undefined) {
        return route.fulfill(
          json(409, {
            error: { code: 'wish_already_received', message: 'Already received' },
          }),
        )
      }
      wish.receivedAt = '2026-10-01T09:30:00.000Z'
      wish.updatedAt = wish.receivedAt
      revision += 1
      return route.fulfill(json(200, wish))
    }
    if (wish.receivedAt === undefined) {
      return route.fulfill(
        json(409, { error: { code: 'wish_not_received', message: 'Not received' } }),
      )
    }
    const { receivedAt: _cleared, ...open } = wish
    delete (open as { receivedAt?: string }).receivedAt
    wish.updatedAt = '2026-10-01T09:35:00.000Z'
    revision += 1
    return route.fulfill(json(200, { ...open, updatedAt: wish.updatedAt }))
  })

  await page.route(WISH, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const wishId = route.request().url().split('/').at(-1) as string
    const wish = wishes.find((row) => row.id === wishId)
    if (wish === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'wish_not_found', message: 'No such wish' } }),
      )
    }
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        title: string
        details?: string
        link?: string
      }
      // A PUT replaces the whole triple: an absent details means the wish
      // loses them, never that the old ones stay.
      delete wish.details
      delete wish.link
      wish.title = body.title
      if (body.details !== undefined) wish.details = body.details
      if (body.link !== undefined) wish.link = body.link
      wish.updatedAt = '2026-10-01T10:00:00.000Z'
      return route.fulfill(json(200, wish))
    }
    // DELETE: the wish leaves for good, the tombstone telling every device.
    wishes.splice(wishes.indexOf(wish), 1)
    removed.push(wish.id)
    revision += 1
    return route.fulfill(json(204, undefined))
  })
}

test.describe('the wishlist', () => {
  test('the overview counts the lists, and a wish is added through the sheet', async ({ page }) => {
    await mockWishlistApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The section navigation leads to the wishlists overview.
    await page.getByRole('button', { name: 'Вишлисты' }).first().click()
    await expect(page).toHaveURL(/\/wishlist$/)
    await expect(page.getByText('Желания каждого — и подарки без пересечений')).toBeVisible()
    // The own card counts the empty list; Дима's row counts his one open
    // wish — the received one left the open count.
    await expect(page.getByText('0 желаний')).toBeVisible()
    await expect(page.getByText('Дима')).toBeVisible()

    // The own wishlist opens from the card link.
    await page.getByRole('link').filter({ hasText: 'Мой вишлист' }).click()
    await expect(page).toHaveURL(/\/wishlist\/mine$/)
    await expect(page.getByText('Здесь пока ничего нет')).toBeVisible()

    // A wish is added through the sheet, and the list shows it.
    await page.getByRole('button', { name: 'Добавить желание' }).first().click()
    await page.getByLabel('Название').fill('Набор для вышивания «Маки»')
    await page.getByLabel('Подсказка').fill('Размер 30×40, канва Aida 16')
    await page.getByLabel('Ссылка').fill('https://www.wildberries.ru/search?q=вышивание')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    await expect(page.getByText('Желание добавлено в ваш список')).toBeVisible()
    await expect(page.getByText('Набор для вышивания «Маки»')).toBeVisible()
  })

  test('a wish is marked received from the edit sheet and struck through', async ({ page }) => {
    await mockWishlistApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Вишлисты' }).first().click()
    await page.getByRole('link').filter({ hasText: 'Мой вишлист' }).click()
    await page.getByRole('button', { name: 'Добавить желание' }).first().click()
    await page.getByLabel('Название').fill('Термос Stanley Quest, 1 л')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByText('Термос Stanley Quest, 1 л')).toBeVisible()

    // The edit sheet carries the received switch; marking it received
    // strikes the title through behind the mark.
    await page.getByRole('button', { name: 'Изменить' }).click()
    await page.getByRole('switch', { name: 'Уже получено' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Сохранено')).toBeVisible()
    await expect(page.getByText('Получено')).toBeVisible()
  })

  test('a wish is removed behind its confirm, and a member list hides received wishes', async ({
    page,
  }) => {
    await mockWishlistApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Вишлисты' }).first().click()

    // Дима's wishlist shows his one open wish with its details and domain;
    // the received wish has left the open wishes.
    await page.getByText('Дима').click()
    await expect(page).toHaveURL(new RegExp(`/wishlist/${DIMA_ID}$`))
    await expect(page.getByText('Налобный фонарь Petzl Actik Core')).toBeVisible()
    await expect(page.getByText('чтобы ходить в горы в темноте')).toBeVisible()
    await expect(page.getByText('wildberries.ru')).toBeVisible()
    await expect(page.getByText('Кожаный ремень')).toHaveCount(0)

    // The own wishlist's removal stands behind its confirm.
    await page.getByRole('link', { name: 'Назад' }).click()
    await page.getByRole('link').filter({ hasText: 'Мой вишлист' }).click()
    await page.getByRole('button', { name: 'Добавить желание' }).first().click()
    await page.getByLabel('Название').fill('Билеты на стендап, 2 шт')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByText('Билеты на стендап, 2 шт')).toBeVisible()

    await page.getByRole('button', { name: 'Изменить' }).click()
    await page.getByRole('button', { name: 'Удалить желание' }).click()
    await expect(page.getByText('Удалить желание?')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()

    await expect(page.getByText('Желание удалено')).toBeVisible()
    await expect(page.getByText('Билеты на стендап, 2 шт')).toHaveCount(0)
    await expect(page.getByText('Здесь пока ничего нет')).toBeVisible()
  })
})
