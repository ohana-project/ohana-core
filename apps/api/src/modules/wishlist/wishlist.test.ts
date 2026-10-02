import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'wishlist-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The administrator is a singleton, so each file that signs in re-establishes
 * it in its arrange step; test files run one at a time (vitest.config.ts).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, ADMIN_PASSWORD)

type TestApp = ReturnType<TestHarness['buildTestApp']>

async function withApp(body: (app: TestApp) => Promise<void>) {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

async function signInAdmin(app: TestApp): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { password: ADMIN_PASSWORD },
    headers: MARKER,
  })
  expect(response.statusCode).toBe(204)
  const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
  if (cookie === undefined) throw new Error('Sign-in set no administrative session cookie')
  return `${ADMIN_SESSION_COOKIE}=${cookie.value}`
}

interface MemberSession {
  memberId: string
  cookie: string
}

/** Provisions a member and signs them in through redemption. */
async function memberSession(
  app: TestApp,
  adminCookie: string,
  spaceId: string,
  name: string,
  role: 'owner' | 'regular' = 'regular',
): Promise<MemberSession> {
  const provision = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members`,
    payload: { name, role },
    headers: { cookie: adminCookie, ...MARKER },
  })
  expect(provision.statusCode).toBe(201)
  const member = provision.json() as { id: string }
  const issue = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${member.id}/access-codes`,
    headers: { cookie: adminCookie, ...MARKER },
  })
  expect(issue.statusCode).toBe(201)
  const { code } = issue.json() as { code: string }

  const redeem = await app.inject({
    method: 'POST',
    url: '/api/v1/access-codes/redeem',
    payload: { code },
  })
  expect(redeem.statusCode).toBe(200)
  const cookie = redeem.cookies.find((candidate) =>
    candidate.name.startsWith('ohana_member_session_'),
  )
  if (cookie === undefined) throw new Error('Redemption produced no session cookie')
  return {
    memberId: cookie.name.slice('ohana_member_session_'.length),
    cookie: `${cookie.name}=${cookie.value}`,
  }
}

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

interface WishDto {
  id: string
  authorId: string
  title: string
  details?: string
  link?: string
  receivedAt?: string
  createdAt: string
  updatedAt: string
}

type WishResponse = { status: number; body: WishDto | { error: { code: string } } }

async function createWish(
  app: TestApp,
  session: MemberSession,
  body: { title: string; details?: string; link?: string },
): Promise<WishResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/wishlist/wishes',
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function editWish(
  app: TestApp,
  session: MemberSession,
  wishId: string,
  body: { title: string; details?: string; link?: string },
): Promise<WishResponse> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/wishlist/wishes/${wishId}`,
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function getWish(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<WishResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/wishlist/wishes/${wishId}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function listWishes(
  app: TestApp,
  session: MemberSession,
  author?: string,
): Promise<{ status: number; body: { wishes: WishDto[] } | { error: { code: string } } }> {
  const suffix = author === undefined ? '' : `?author=${author}`
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/wishlist/wishes${suffix}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function removeWish(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<{ status: number; body?: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}`,
    headers: memberHeaders(session),
  })
  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  }
}

async function markReceived(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<WishResponse> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/received`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function clearReceived(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<WishResponse> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}/received`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code
}

async function hideWishlist(app: TestApp, owner: MemberSession, visible: boolean): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/space',
    headers: memberHeaders(owner),
    payload: { sections: { wishlist: visible } },
  })
  expect(response.statusCode).toBe(200)
}

describe('the wishlist wishes (issue #18)', () => {
  test('a member adds a wish with a title and optional details and link', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      const created = await createWish(app, anna, {
        title: 'Набор для вышивания «Маки»',
        details: 'Размер 30×40, канва Aida 16',
        link: 'https://www.wildberries.ru/search?query=вышивание',
      })
      expect(created.status).toBe(201)
      const wish = created.body as WishDto
      expect(wish).toMatchObject({
        title: 'Набор для вышивания «Маки»',
        details: 'Размер 30×40, канва Aida 16',
        link: 'https://www.wildberries.ru/search?query=вышивание',
        authorId: anna.memberId,
      })
      expect(wish.receivedAt).toBeUndefined()
      expect(wish.createdAt).toEqual(expect.any(String))

      // Only the title is required; the optionals disappear when absent.
      const minimal = await createWish(app, anna, { title: 'Поспать' })
      expect(minimal.status).toBe(201)
      const minimalWish = minimal.body as WishDto
      expect(minimalWish.details).toBeUndefined()
      expect(minimalWish.link).toBeUndefined()

      // The service trims: the title loses its padding, and an optional
      // that is whitespace only arrives as absent.
      const padded = await createWish(app, anna, { title: '  Термос  ', details: '   ' })
      expect(padded.status).toBe(201)
      expect(padded.body).toMatchObject({ title: 'Термос' })
      expect((padded.body as WishDto).details).toBeUndefined()
    })
  })

  test('a wish needs a real title and an http(s) link', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const blank = await createWish(app, anna, { title: '   ' })
      expect(blank.status).toBe(400)
      expect(errorCode(blank.body)).toBe('validation_failed')

      const missing = await createWish(app, anna, { title: '' })
      expect(missing.status).toBe(400)

      // A NUL is not whitespace, but the database refuses it inside text —
      // the contract refuses it first, so the write stays a 400.
      for (const link of [
        'ftp://example.com/gift',
        'javascript:alert(1)',
        'not a url',
        'https://example.com/\u0000',
      ]) {
        const refused = await createWish(app, anna, { title: 'Фонарь', link })
        expect(refused.status).toBe(400)
        expect(errorCode(refused.body)).toBe('validation_failed')
      }

      const http = await createWish(app, anna, { title: 'Фонарь', link: 'http://example.com/a' })
      expect(http.status).toBe(201)

      // The bounds are the contract's own: one past the limit refuses.
      const tooLongTitle = await createWish(app, anna, { title: 'Ф'.repeat(201) })
      expect(tooLongTitle.status).toBe(400)
      expect(errorCode(tooLongTitle.body)).toBe('validation_failed')

      const tooLongDetails = await createWish(app, anna, {
        title: 'Фонарь',
        details: 'Д'.repeat(2001),
      })
      expect(tooLongDetails.status).toBe(400)

      const tooLongLink = await createWish(app, anna, {
        title: 'Фонарь',
        link: `https://example.com/${'x'.repeat(2048)}`,
      })
      expect(tooLongLink.status).toBe(400)

      // The boundary itself goes through: 200, 2000, and 2048 characters.
      const atTheBounds = await createWish(app, anna, {
        title: 'Ф'.repeat(200),
        details: 'Д'.repeat(2000),
        link: `https://example.com/${'x'.repeat(2028)}`,
      })
      expect(atTheBounds.status).toBe(201)
    })
  })

  test('members browse each others wishlists; a strangers wish in another space answers 404', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, anna, {
        title: 'Налобный фонарь',
        link: 'https://example.com/lamp',
      })
      expect(lamp.status).toBe(201)
      const lampId = (lamp.body as WishDto).id
      const kettle = await createWish(app, dima, { title: 'Термос', details: '1 литр' })
      expect(kettle.status).toBe(201)
      const kettleId = (kettle.body as WishDto).id

      // The space-wide browse carries both members' wishes.
      const all = await listWishes(app, anna)
      expect(all.status).toBe(200)
      expect((all.body as { wishes: WishDto[] }).wishes.map((wish) => wish.id).sort()).toEqual(
        [lampId, kettleId].sort(),
      )

      // The per-author browse is one member's wishlist.
      const annas = await listWishes(app, dima, anna.memberId)
      expect((annas.body as { wishes: WishDto[] }).wishes.map((wish) => wish.title)).toEqual([
        'Налобный фонарь',
      ])

      // Дима reads Аня's wish whole.
      const read = await getWish(app, dima, lampId)
      expect(read.status).toBe(200)
      expect(read.body).toMatchObject({ title: 'Налобный фонарь' })

      // Another space's wish does not exist for Аня — the read and every
      // write alike (pairs of members, pairs of spaces): the space scope
      // answers 404 before the authorship rule could answer 403.
      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const foreign = await createWish(app, stranger, { title: 'Чужое желание' })
      expect(foreign.status).toBe(201)
      const foreignId = (foreign.body as WishDto).id

      const cross = await getWish(app, anna, foreignId)
      expect(cross.status).toBe(404)
      expect(errorCode(cross.body)).toBe('wish_not_found')

      const crossEdit = await editWish(app, anna, foreignId, { title: 'Моё теперь' })
      expect(crossEdit.status).toBe(404)
      expect(errorCode(crossEdit.body)).toBe('wish_not_found')

      const crossRemove = await removeWish(app, anna, foreignId)
      expect(crossRemove.status).toBe(404)
      expect(errorCode(crossRemove.body)).toBe('wish_not_found')

      const crossMark = await markReceived(app, anna, foreignId)
      expect(crossMark.status).toBe(404)
      expect(errorCode(crossMark.body)).toBe('wish_not_found')

      const crossClear = await clearReceived(app, anna, foreignId)
      expect(crossClear.status).toBe(404)
      expect(errorCode(crossClear.body)).toBe('wish_not_found')

      // Nothing of the refused writes landed: the stranger still reads
      // their wish exactly as it was created.
      const unchanged = await getWish(app, stranger, foreignId)
      expect(unchanged.status).toBe(200)
      expect(unchanged.body).toMatchObject({ title: 'Чужое желание' })
    })
  })

  test('only the author edits their wish', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createWish(app, dima, { title: 'Кашемировый свитер' })
      const wishId = (created.body as WishDto).id

      const strangerEdit = await editWish(app, anna, wishId, { title: 'Носки' })
      expect(strangerEdit.status).toBe(403)
      expect(errorCode(strangerEdit.body)).toBe('author_required')

      // An owner is no exception: a wish is personal.
      const ownerEdit = await editWish(app, anna, wishId, { title: 'Свитер' })
      expect(ownerEdit.status).toBe(403)

      const edit = await editWish(app, dima, wishId, {
        title: 'Кашемировый свитер, горчичный',
        details: 'размер 46, не колючий',
      })
      expect(edit.status).toBe(200)
      const edited = edit.body as WishDto
      expect(edited.title).toBe('Кашемировый свитер, горчичный')
      expect(edited.details).toBe('размер 46, не колючий')

      // The replace is whole: an edit without the optionals clears them.
      const cleared = await editWish(app, dima, wishId, { title: 'Свитер' })
      expect(cleared.status).toBe(200)
      expect((cleared.body as WishDto).details).toBeUndefined()
    })
  })

  test('only the author removes their wish', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createWish(app, dima, { title: 'Билеты на стендап' })
      const wishId = (created.body as WishDto).id

      // Even the owner cannot remove another member's wish.
      const ownerRemove = await removeWish(app, anna, wishId)
      expect(ownerRemove.status).toBe(403)

      // Still there after the refused removal.
      const still = await getWish(app, dima, wishId)
      expect(still.status).toBe(200)

      const removed = await removeWish(app, dima, wishId)
      expect(removed.status).toBe(204)

      const gone = await getWish(app, dima, wishId)
      expect(gone.status).toBe(404)
      expect(errorCode(gone.body)).toBe('wish_not_found')
    })
  })

  test('only the author marks received, and the mark returns the wish to open', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createWish(app, anna, { title: 'Сертификат в «Подписные издания»' })
      const wishId = (created.body as WishDto).id

      const strangerMark = await markReceived(app, dima, wishId)
      expect(strangerMark.status).toBe(403)
      expect(errorCode(strangerMark.body)).toBe('author_required')

      const marked = await markReceived(app, anna, wishId)
      expect(marked.status).toBe(200)
      const receivedAt = (marked.body as WishDto).receivedAt
      expect(receivedAt).toEqual(expect.any(String))

      const twice = await markReceived(app, anna, wishId)
      expect(twice.status).toBe(409)
      expect(errorCode(twice.body)).toBe('wish_already_received')

      // The mark is visible to the other members too.
      const forDima = await getWish(app, dima, wishId)
      expect((forDima.body as WishDto).receivedAt).toBe(receivedAt)

      const strangerClear = await clearReceived(app, dima, wishId)
      expect(strangerClear.status).toBe(403)

      const cleared = await clearReceived(app, anna, wishId)
      expect(cleared.status).toBe(200)
      expect((cleared.body as WishDto).receivedAt).toBeUndefined()

      const again = await clearReceived(app, anna, wishId)
      expect(again.status).toBe(409)
      expect(errorCode(again.body)).toBe('wish_not_received')
    })
  })

  test('a hidden wishlist answers section_hidden on every route', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createWish(app, dima, { title: 'До скрытия' })
      const wishId = (created.body as WishDto).id
      const marked = await markReceived(app, dima, wishId)
      expect(marked.status).toBe(200)

      await hideWishlist(app, owner, false)

      const browse = await listWishes(app, dima)
      expect(browse.status).toBe(404)
      expect(errorCode(browse.body)).toBe('section_hidden')

      const read = await getWish(app, dima, wishId)
      expect(read.status).toBe(404)
      expect(errorCode(read.body)).toBe('section_hidden')

      const add = await createWish(app, dima, { title: 'После скрытия' })
      expect(add.status).toBe(404)
      expect(errorCode(add.body)).toBe('section_hidden')

      const edit = await editWish(app, dima, wishId, { title: 'Правка при скрытом' })
      expect(edit.status).toBe(404)
      expect(errorCode(edit.body)).toBe('section_hidden')

      const remove = await removeWish(app, dima, wishId)
      expect(remove.status).toBe(404)
      expect(errorCode(remove.body)).toBe('section_hidden')

      const mark = await markReceived(app, dima, wishId)
      expect(mark.status).toBe(404)
      expect(errorCode(mark.body)).toBe('section_hidden')

      const clear = await clearReceived(app, dima, wishId)
      expect(clear.status).toBe(404)
      expect(errorCode(clear.body)).toBe('section_hidden')

      // Hiding never touches the sections' data (ADR-0011): the wish comes
      // back with the section, its received mark intact.
      await hideWishlist(app, owner, true)
      const restored = await getWish(app, dima, wishId)
      expect(restored.status).toBe(200)
      expect(restored.body).toMatchObject({ title: 'До скрытия' })
      expect((restored.body as WishDto).receivedAt).toEqual(expect.any(String))
    })
  })
})
