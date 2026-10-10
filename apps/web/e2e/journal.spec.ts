import { expect, type Page, test } from '@playwright/test'

import { tokenFill } from './tokens.ts'

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
const TRASH = '**/api/v1/journal/entries/*/trash'
const RESTORE = '**/api/v1/journal/entries/*/restore'
const TRASH_LIST = '**/api/v1/journal/trash'
const IMAGES = '**/api/v1/journal/entries/*/images'
const IMAGE = '**/api/v1/journal/entries/*/images/*'
const VARIANTS = '**/api/v1/journal/entries/*/images/*/variants/*'
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
  images: [
    {
      id: '01900000-0000-7000-8000-000000000201',
      state: 'ready',
      width: 1200,
      height: 800,
      originalType: 'image/jpeg',
    },
    {
      id: '01900000-0000-7000-8000-000000000202',
      state: 'ready',
      width: 900,
      height: 1200,
      originalType: 'image/heic',
    },
  ],
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
  state: 'draft' | 'published' | 'trashed'
  publishedAt?: string
  images?: Array<{
    id: string
    state: 'processing' | 'ready' | 'failed'
    width?: number
    height?: number
    originalType?: string
  }>
  trashedAt?: string
  purgeAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * The mocked member API over a small stateful journal: the mutations the
 * editor sends change what the next sync answers, the way the server's
 * revision would deliver them. Trashing removes the row from the sync's
 * upserts and answers the removal as a tombstone for its author, the way
 * the server does (issue #16); the trash list carries the trashed rows
 * with their deletion dates.
 */
async function mockJournalApi(page: Page) {
  const signedIn = new Set<string>([ANYA_ID])
  const entries: StoredEntry[] = [SEEDED_PUBLISHED]
  let nextId = 0x200
  let nextImageId = 0x300
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
          ...entries
            .filter((entry) => entry.state !== 'trashed')
            .map((entry) => ({ entity: 'journal_entry', entry })),
        ],
        tombstones: entries
          .filter((entry) => entry.state === 'trashed')
          .map((entry) => ({
            entity: 'journal_entry',
            entityId: entry.id,
            audience: 'member',
            memberId: ANYA_ID,
          })),
      }),
    )
  })

  await page.route(TRASH_LIST, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(401, {}))
    return route.fulfill(
      json(200, {
        entries: entries
          .filter((entry) => entry.state === 'trashed')
          .map((entry) => ({
            id: entry.id,
            authorId: entry.authorId,
            ...(entry.title === undefined ? {} : { title: entry.title }),
            text: entry.text,
            previousState: entry.publishedAt === undefined ? 'draft' : 'published',
            trashedAt: entry.trashedAt,
            purgeAt: entry.purgeAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          })),
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
    revision += 1
    return route.fulfill(json(200, published))
  })

  await page.route(TRASH, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const entryId = route.request().url().split('/').at(-2) as string
    const entry = entries.find((row) => row.id === entryId)
    if (entry === undefined || entry.state === 'trashed') {
      return route.fulfill(
        json(404, { error: { code: 'entry_not_found', message: 'No such entry' } }),
      )
    }
    entries.splice(entries.indexOf(entry), 1)
    const trashed: StoredEntry = {
      ...entry,
      state: 'trashed',
      trashedAt: '2026-10-01T10:15:00.000Z',
      // The permanent-deletion date is the removal plus 30 days (the
      // default retention, ADR-0007).
      purgeAt: '2026-10-31T10:15:00.000Z',
      updatedAt: '2026-10-01T10:15:00.000Z',
    }
    entries.push(trashed)
    revision += 1
    return route.fulfill(
      json(200, {
        id: trashed.id,
        authorId: trashed.authorId,
        ...(trashed.title === undefined ? {} : { title: trashed.title }),
        text: trashed.text,
        previousState: trashed.publishedAt === undefined ? 'draft' : 'published',
        trashedAt: trashed.trashedAt,
        purgeAt: trashed.purgeAt,
        createdAt: trashed.createdAt,
        updatedAt: trashed.updatedAt,
      }),
    )
  })

  // The photo routes (issue #17): the variants stream bytes, the upload
  // attaches and bumps the revision the way the server does.
  await page.route(VARIANTS, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId === undefined || !signedIn.has(memberId)) return route.fulfill(json(401, {}))
    // A one-pixel image: the screens only show it.
    return route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  })

  await page.route(IMAGES, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const entryId = route.request().url().split('/').at(-2) as string
    const entry = entries.find((row) => row.id === entryId)
    if (entry === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'entry_not_found', message: 'No such entry' } }),
      )
    }
    const image = {
      id: `01900000-0000-7000-8000-${String(nextImageId++).padStart(12, '0')}`,
      state: 'ready' as const,
      width: 800,
      height: 600,
    }
    entry.images = [...(entry.images ?? []), image]
    revision += 1
    return route.fulfill(json(201, image))
  })

  await page.route(IMAGE, (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const parts = route.request().url().split('/')
    const entry = entries.find((row) => row.id === parts.at(-3))
    const imageId = parts.at(-1) as string
    if (entry === undefined) {
      return route.fulfill(
        json(404, { error: { code: 'entry_not_found', message: 'No such entry' } }),
      )
    }
    entry.images = (entry.images ?? []).filter((image) => image.id !== imageId)
    revision += 1
    return route.fulfill({ status: 204 })
  })

  await page.route(RESTORE, (route) => {
    const memberId = route.request().headers()['x-ohana-member']
    if (memberId !== ANYA_ID) return route.fulfill(json(403, {}))
    const entryId = route.request().url().split('/').at(-2) as string
    const entry = entries.find((row) => row.id === entryId)
    if (entry === undefined || entry.state !== 'trashed') {
      return route.fulfill(
        json(404, { error: { code: 'entry_not_found', message: 'No such entry' } }),
      )
    }
    entries.splice(entries.indexOf(entry), 1)
    const restored: StoredEntry = {
      id: entry.id,
      authorId: entry.authorId,
      ...(entry.title === undefined ? {} : { title: entry.title }),
      text: entry.text,
      state: entry.publishedAt === undefined ? 'draft' : 'published',
      ...(entry.publishedAt === undefined ? {} : { publishedAt: entry.publishedAt }),
      createdAt: entry.createdAt,
      updatedAt: '2026-10-01T10:20:00.000Z',
    }
    entries.push(restored)
    revision += 1
    return route.fulfill(json(200, restored))
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
    // A PUT replaces the whole pair: an absent title means the entry loses
    // its title, never that the old one stays.
    const { title: _replaced, ...kept } = entry
    const replaced: typeof entry = {
      ...kept,
      ...(body.title === undefined ? {} : { title: body.title }),
      text: body.text,
      updatedAt: '2026-10-01T10:00:00.000Z',
    }
    entries.splice(entries.indexOf(entry), 1)
    entries.push(replaced)
    return route.fulfill(json(200, replaced))
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

  test('the journal corner rows carry the prototype tiles (issue #58)', async ({ page }) => {
    await mockJournalApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)

    // A draft exists so the drafts row shows beside the trash row.
    await page.getByRole('button', { name: 'Новая запись' }).first().click()
    await page.getByLabel('Заголовок').fill('Про Бублика')
    await page.getByLabel('Текст записи').fill('Он съел ещё один носок.')
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page).toHaveURL(/\/journal$/)

    // The sidebar rows opt into the 38px tile — surface-2 for drafts,
    // danger-tinted for trash (docs/design/screens/diary.html:85,95).
    const surface2 = await tokenFill(page, '--surface-2')
    const dangerFill = await tokenFill(page, '--danger-fill')
    expect(dangerFill).not.toBe(surface2)
    const draftsMedia = page
      .getByRole('link', { name: /Мои черновики/ })
      .locator('[data-slot="item-media"]')
    await expect(draftsMedia).toHaveAttribute('data-variant', 'icon')
    await expect(draftsMedia).toHaveAttribute('data-tone', 'neutral')
    await expect(draftsMedia).toHaveCSS('width', '38px')
    await expect(draftsMedia).toHaveCSS('background-color', surface2)
    const trashMedia = page
      .getByRole('link', { name: /Корзина/ })
      .locator('[data-slot="item-media"]')
    await expect(trashMedia).toHaveAttribute('data-variant', 'icon')
    await expect(trashMedia).toHaveAttribute('data-tone', 'danger')
    await expect(trashMedia).toHaveCSS('width', '38px')
    await expect(trashMedia).toHaveCSS('background-color', dangerFill)
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

    // The author opens their published entry and edits it; the edit rides
    // the top bar's entry menu (issue #70).
    await page.getByText('Пикник').click()
    await expect(page).toHaveURL(/\/journal\/01900000-[^/]+$/)
    await page.getByRole('button', { name: 'Меню записи' }).click()
    await page.getByRole('menuitem', { name: 'Редактировать' }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(page.getByText('опубликовано', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toHaveCount(0)
    await page.getByLabel('Текст записи').fill('Собрались за час: бутерброды и термос.')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    // The edit lands in the shared feed through the sync, state unchanged.
    await expect(page).toHaveURL(/\/journal$/)
    await expect(page.getByText('Собрались за час: бутерброды и термос.')).toBeVisible()
  })

  test('a draft is trashed from its menu and restored from the trash view', async ({ page }) => {
    await mockJournalApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // A draft to lose.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    await page.getByRole('button', { name: 'Новая запись' }).first().click()
    await page.getByLabel('Заголовок').fill('Черновик под нож')
    await page.getByLabel('Текст записи').fill('Его удалю, а потом верну.')
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page.getByText('Черновик сохранён — виден только вам')).toBeVisible()

    // The removal hides behind the row's overflow menu with a dialog
    // between: one tap must not trash a draft (docs/design/screens/drafts.html).
    await page.getByText('Мои черновики').click()
    await expect(page).toHaveURL(/\/journal\/drafts$/)
    await expect(page.getByText('Черновик под нож')).toBeVisible()
    await page.getByRole('button', { name: 'Действия с черновиком' }).click()
    await page.getByRole('menuitem', { name: 'Удалить черновик' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click()

    // The toast names the date the answer computed; the sync takes the row
    // off the drafts list.
    await expect(page.getByText(/исчезнет окончательно 31 октября/)).toBeVisible()
    await expect(page.getByText('Черновик под нож')).toHaveCount(0)

    // The feed's own corner leads to the trash; the row is there with its
    // deletion date, and restoring puts it back among the drafts.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    await page.getByText('Корзина').click()
    await expect(page).toHaveURL(/\/journal\/trash$/)
    await expect(page.getByText('Черновик под нож')).toBeVisible()
    // The row names the removal and the permanent-deletion date.
    await expect(page.getByText(/удалено .* · исчезнет окончательно 31 октября/)).toBeVisible()
    await page.getByRole('button', { name: 'Восстановить' }).click()
    await expect(page.getByText('Восстановлено — запись снова в дневнике')).toBeVisible()

    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await page.getByText('Мои черновики').click()
    await expect(page).toHaveURL(/\/journal\/drafts$/)
    await expect(page.getByText('Черновик под нож')).toBeVisible()
  })

  test('photos ride the entry: the gallery opens them, the editor attaches and removes', async ({
    page,
  }) => {
    await mockJournalApi(page)

    await page.goto('/')
    await page.getByLabel('Код входа').fill(CODE)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/$/)

    // The entry screen carries the photo pill and the gallery.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await page.getByText('Поход к Чёртову креслу').click()
    await expect(page).toHaveURL(new RegExp(`/journal/${SEEDED_PUBLISHED.id}`))
    await expect(page.getByText('Фото ×2')).toBeVisible()

    // A tap opens the lightbox; it upgrades to the original and closes.
    // The tiles are named for their place in the gallery (issue #70).
    await page.getByRole('button', { name: 'Фото 1 из 2' }).click()
    // The exact caption: the loading line and the gallery hint both name
    // the original, so the substring match would be ambiguous.
    await expect(page.getByText('Оригинал', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await expect(page.getByText('Оригинал', { exact: true })).toHaveCount(0)

    // The footer carries the rule, «Все записи» and — the feed holding
    // only this entry — no next line (issue #70).
    await expect(page.getByRole('link', { name: 'Все записи' })).toBeVisible()
    await expect(page.getByText(/Следующая:/)).toHaveCount(0)

    // A photo attaches to a draft: the author writes one and opens it.
    await page.getByRole('button', { name: 'Дневник' }).first().click()
    await expect(page).toHaveURL(/\/journal$/)
    await page.getByRole('button', { name: 'Новая запись' }).first().click()
    await expect(page).toHaveURL(/\/journal\/new$/)
    await page.getByLabel('Текст записи').fill('С фотографией вершины.')
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page).toHaveURL(/\/journal$/)
    await page.getByText('Мои черновики').click()
    await page.getByRole('button', { name: 'Дописать' }).click()
    await expect(page.getByText('0 из 12')).toBeVisible()

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await page.setInputFiles('input[type="file"]', [
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: png },
    ])
    await expect(page.getByText('1 из 12')).toBeVisible()

    // The chip's cross removes it; the counter follows.
    await page.getByRole('button', { name: 'Убрать фото' }).click()
    await expect(page.getByText('0 из 12')).toBeVisible()
  })

  test.describe('the entry at a phone width (issue #70)', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the entry holds the prototype at 390px', async ({ page }) => {
      await mockJournalApi(page)

      await page.goto('/')
      await page.getByLabel('Код входа').fill(CODE)
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.getByRole('button', { name: 'Дневник' }).first().click()
      await page.getByText('Поход к Чёртову креслу').click()
      await expect(page).toHaveURL(new RegExp(`/journal/${SEEDED_PUBLISHED.id}`))

      // The photo grid is three columns at every width, the prototype's
      // own grid — no two-column mobile variant.
      const columns = await page
        .getByRole('button', { name: 'Фото 1 из 2' })
        .evaluate((tile) => getComputedStyle(tile.parentElement as Element).gridTemplateColumns)
      expect(columns.split(' ')).toHaveLength(3)

      // The entry menu rides the top bar on a phone too — the prototype's
      // data-topbar-actions carries no d-only here.
      await page.getByRole('button', { name: 'Меню записи' }).click()
      await expect(page.getByRole('menuitem', { name: 'Скопировать ссылку' })).toBeVisible()
      await page.keyboard.press('Escape')

      // And nothing scrolls horizontally at 390px.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  })
})
