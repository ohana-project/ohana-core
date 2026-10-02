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

const ADMIN_PASSWORD = 'wishlist-favorites-admin-password'
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

interface GiftFavoriteDto {
  id: string
  wishId: string
  createdAt: string
  updatedAt: string
}

async function createWish(
  app: TestApp,
  session: MemberSession,
  title: string,
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/wishlist/wishes',
    headers: memberHeaders(session),
    payload: { title },
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function favorite(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<{ status: number; body: GiftFavoriteDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/favorite`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function unfavorite(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<{ status: number; body?: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}/favorite`,
    headers: memberHeaders(session),
  })
  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  }
}

async function listFavorites(
  app: TestApp,
  session: MemberSession,
): Promise<{
  status: number
  body: { favorites: GiftFavoriteDto[] } | { error: { code: string } }
}> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/wishlist/favorites',
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

describe('the gift favorites (issue #19)', () => {
  test('a member bookmarks another member’s wish, and only they see it', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const created = await favorite(app, anna, lamp.id)
      expect(created.status).toBe(201)
      const bookmark = created.body as GiftFavoriteDto
      expect(bookmark.wishId).toBe(lamp.id)
      expect(bookmark.createdAt).toEqual(expect.any(String))

      // The listing is the member's own favorites, creation order.
      const annas = await listFavorites(app, anna)
      expect(annas.status).toBe(200)
      expect((annas.body as { favorites: GiftFavoriteDto[] }).favorites).toEqual([bookmark])

      // A member's favorites are theirs alone: Дима's listing holds none of
      // Аня's bookmarks (pairs of members).
      const dimas = await listFavorites(app, dima)
      expect(dimas.status).toBe(200)
      expect((dimas.body as { favorites: GiftFavoriteDto[] }).favorites).toEqual([])

      // Favoriting reserves nothing: the wish is unchanged for its author.
      const wish = await app.inject({
        method: 'GET',
        url: `/api/v1/wishlist/wishes/${lamp.id}`,
        headers: memberHeaders(dima),
      })
      expect(wish.statusCode).toBe(200)
      expect(wish.json()).toMatchObject({ title: 'Налобный фонарь' })
    })
  })

  test('a member cannot favorite their own wish', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const own = await createWish(app, anna, 'Термос')

      const refused = await favorite(app, anna, own.id)
      expect(refused.status).toBe(403)
      expect(errorCode(refused.body)).toBe('favorite_own_wish')

      // An owner is no exception: the rule is about the author of the wish.
      const ownerRefusal = await favorite(app, dima, own.id)
      expect(ownerRefusal.status).toBe(201)
      const otherWish = await createWish(app, dima, 'Шарф')
      const ownerOwn = await favorite(app, anna, otherWish.id)
      expect(ownerOwn.status).toBe(201)

      // The refusal wrote nothing: no bookmark of her own wish exists.
      const favorites = await listFavorites(app, anna)
      expect((favorites.body as { favorites: GiftFavoriteDto[] }).favorites).toHaveLength(1)
    })
  })

  test('a wish is favorited once, and taking the bookmark back is the toggle’s other end', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const first = await favorite(app, anna, lamp.id)
      expect(first.status).toBe(201)

      const twice = await favorite(app, anna, lamp.id)
      expect(twice.status).toBe(409)
      expect(errorCode(twice.body)).toBe('wish_already_favorited')

      const removed = await unfavorite(app, anna, lamp.id)
      expect(removed.status).toBe(204)

      const gone = await listFavorites(app, anna)
      expect((gone.body as { favorites: GiftFavoriteDto[] }).favorites).toEqual([])

      const again = await unfavorite(app, anna, lamp.id)
      expect(again.status).toBe(409)
      expect(errorCode(again.body)).toBe('wish_not_favorited')

      // The bookmark can be made again after it is taken back.
      const renewed = await favorite(app, anna, lamp.id)
      expect(renewed.status).toBe(201)
    })
  })

  test('a raced double favorite still leaves one bookmark', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      // The member's two presses race: the space row lock serialises them,
      // and the unique index stands behind it — exactly one bookmark is
      // born, and the loser is refused, never a 500.
      const [first, second] = await Promise.all([
        favorite(app, anna, lamp.id),
        favorite(app, anna, lamp.id),
      ])
      const statuses = [first.status, second.status].sort((a, b) => a - b)
      expect(statuses).toEqual([201, 409])
      const refused = first.status === 409 ? first.body : second.body
      expect(errorCode(refused)).toBe('wish_already_favorited')

      const listing = await listFavorites(app, anna)
      expect((listing.body as { favorites: GiftFavoriteDto[] }).favorites).toHaveLength(1)
    })
  })

  test('a stranger’s wish in another space answers 404, hidden section answers section_hidden', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const foreign = await createWish(app, stranger, 'Чужое желание')

      const cross = await favorite(app, anna, foreign.id)
      expect(cross.status).toBe(404)
      expect(errorCode(cross.body)).toBe('wish_not_found')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      await hideWishlist(app, anna, false)

      const hiddenFavorite = await favorite(app, anna, lamp.id)
      expect(hiddenFavorite.status).toBe(404)
      expect(errorCode(hiddenFavorite.body)).toBe('section_hidden')

      // The favorite routes sit behind the section gate like every other
      // wishlist route: reads and writes alike.
      const hiddenList = await listFavorites(app, anna)
      expect(hiddenList.status).toBe(404)
      expect(errorCode(hiddenList.body)).toBe('section_hidden')
      const hiddenRemove = await unfavorite(app, anna, lamp.id)
      expect(hiddenRemove.status).toBe(404)
      expect(errorCode(hiddenRemove.body)).toBe('section_hidden')

      // Hiding never touches the sections' data (ADR-0011): the wish came
      // back with the section, and the bookmark works again.
      await hideWishlist(app, anna, true)
      const restored = await favorite(app, anna, lamp.id)
      expect(restored.status).toBe(201)
      const listing = await listFavorites(app, anna)
      expect((listing.body as { favorites: GiftFavoriteDto[] }).favorites).toHaveLength(1)
    })
  })
})
