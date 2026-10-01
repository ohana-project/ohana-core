import { expect, type Page, test } from '@playwright/test'

/*
 * The journal's interface flows (issue #15): the section navigation leads
 * to the shared feed of published entries with the author on every row; a
 * new entry is written as a draft, kept in the author's drafts, and
 * published from there; a published entry is edited without ever offering
 * a way back to draft. The member endpoints are intercepted at the network
 * level over a small stateful journal — the real HTTP rules for drafts and
 * authorship are covered by the API's tests, while this spec pins the UI
 * flow and its reads through the synchronised partition.
 */

const ME = '**/api/v1/me'
const REDEEM = '**/api/v1/access-codes/redeem'
const ENTRIES = '**/api/v1/journal/entries'
const ENTRY = '**/api/v1/journal/entries/*'
const PUBLISH = '**/api/v1/journal/entries/*/publish'
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

const SEEDED_PUBLISHED: StoredEntry = {
  id: '01900000-0000-7000-8000-000000000101',
  authorId: DIMA_ID,
  title: 'Поход к Чёртову креслу',
  text: 'Вид стоит каждого шага: хребет над озером и черника у самой тропы.',
  state: 'published',
  publishedAt: '2026-09-21T14:00:00.000Z',
  createdAt: '2026-09-21T12:00:00.000Z',
  updatedAt: '2026-09-21T14:00:00.000Z',
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

interface StoredEntry {
  id: string
  authorId: string
  title?: string
  text: string
  state: 'draft' | 'published'
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * The mocked member API over a small stateful journal: the mutations the
 * editor sends change what the next sync answers, the way the server's
 * revision would deliver them.
 */
async function mockJournalApi(page: Page) {
  const signedIn = new Set<string>([ANYA_ID])
  const entries: StoredEntry[] = [SEEDED_PUBLISHED]
  let nextId = 0x200

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
        revision: '7',
        changes: [
          { entity: 'space', space: SPACE },
          ...PROFILES.map((profile) => ({ entity: 'member', member: profile })),
          ...entries.map((entry) => ({ entity: 'journal_entry', entry })),
        ],
        tombstones: [],
      }),
    )
  })

  await page.route(ENTRIES, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const body = route.request().postDataJSON() as { title?: string; text: string }
    const created: StoredEntry = {
      id: `01900000-0000-7000-8000-${String(nextId++).padStart(12, '0')}`,
      authorId: ANYA_ID,
      ...(body.title === undefined ? {} : { title: body.title }),
      text: body.text,
      state: 'draft',
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
    }
    entries.push(created)
    return route.fulfill(json(201, created))
  })

  await page.route(PUBLISH, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const entryId = route.request().url().split('/').at(-2) as string
    const entry = entries.find((row) => row.id === entryId)
    if (entry === undefined || entry.state !== 'draft') {
      return route.fulfill(
        json(409, {
          error: { code: 'entry_already_published', message: 'The entry is already published' },
        }),
      )
    }
    entries.splice(entries.indexOf(entry), 1)
    const published = {
      ...entry,
      state: 'published' as const,
      publishedAt: '2026-10-01T09:30:00.000Z',
      updatedAt: '2026-10-01T09:30:00.000Z',
    }
    entries.push(published)
    return route.fulfill(json(200, published))
  })

  await page.route(ENTRY, (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    // The PUT URL ends with the entry id; publish carries it one segment
    // earlier, under /publish.
    const entryId = route.request().url().split('/').at(-1) as string
    const entry = entries.find((row) => row.id === entryId)
    if (entry === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'entry_not_found', message: 'No such entry' } }),
      )
    }
    const body = route.request().postDataJSON() as { title?: string; text: string }
    entries.splice(entries.indexOf(entry), 1)
    entries.push({
      ...entry,
      ...(body.title === undefined ? {} : { title: body.title }),
      text: body.text,
      updatedAt: '2026-10-01T10:00:00.000Z',
    })
    return route.fulfill(json(200, { ...entry, ...body }))
  })
}

test.describe('the journal', () => {
  test('the feed names authors, and a draft is written, kept, and published', async ({ page }) => {
    await mockJournalApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The section navigation leads to the journal (the section nav the
    // shells share since issue #13).
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    await expect(page.getByText('Поход к Чёртову креслу')).toBeVisible()
    // Every card names its author, from the synced profiles.
    await expect(page.getByText('Дима')).toBeVisible()

    // A new entry starts as a draft, and the draft is kept.
    await page.getByRole('button', { name: 'Новая запись' }).first().click()
    await expect(page).toHaveURL(/\/journal\/new$/)
    await page.getByLabel('Заголовок').fill('Про Бублика')
    await page.getByLabel('Текст записи').fill('Он съел ещё один носок.')
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()

    await expect(page).toHaveURL(/\/journal$/)
    await expect(page.getByText('Черновик сохранён — виден только вам')).toBeVisible()
    // The drafts corner counts the draft; the shared feed itself never
    // shows it, whoever wrote it. (The corner's own line names the draft —
    // the assertion is scoped to the feed's card headings.)
    await expect(page.getByText('Мои черновики')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Про Бублика' })).toHaveCount(0)

    // The separate drafts list shows it; publishing shares it with the space.
    await page.getByText('Мои черновики').click()
    await expect(page).toHaveURL(/\/journal\/drafts$/)
    await expect(page.getByText('Про Бублика')).toBeVisible()
    // Publishing hides behind the row's overflow menu: one tap must not
    // share a private draft for good (docs/design/screens/drafts.html).
    await page.getByRole('button', { name: 'Действия с черновиком' }).click()
    await page.getByRole('menuitem', { name: 'Опубликовать сейчас' }).click()
    await expect(page.getByText('Опубликовано в дневнике пространства')).toBeVisible()

    // Back on the feed the entry is shared, with the author named.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    const card = page.getByText('Про Бублика')
    await expect(card).toHaveCount(1)
    await expect(page.getByText('Аня Смирнова').first()).toBeVisible()
  })

  test('a published entry is edited and is never offered a draft state', async ({ page }) => {
    await mockJournalApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // A member writes and publishes quickly, so the seeded entry has a
    // published sibling of their own to edit.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    await page.getByRole('button', { name: 'Новая запись' }).first().click()
    await page.getByLabel('Заголовок').fill('Пикник')
    await page.getByLabel('Текст записи').fill('Собрались за час.')
    await page.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByText('Опубликовано в дневнике пространства')).toBeVisible()
    await expect(page).toHaveURL(/\/journal$/)

    // The author opens their published entry and edits it.
    await page.getByText('Пикник').click()
    await expect(page).toHaveURL(/\/journal\/01900000-[^/]+$/)
    await page.getByRole('button', { name: 'Редактировать' }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(page.getByText('опубликовано', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toHaveCount(0)
    await page.getByLabel('Текст записи').fill('Собрались за час: бутерброды и термос.')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    // The edit lands in the shared feed through the sync, state unchanged.
    await expect(page).toHaveURL(/\/journal$/)
    await expect(page.getByText('Собрались за час: бутерброды и термос.')).toBeVisible()
  })
})
