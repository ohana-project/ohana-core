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

const ADMIN_PASSWORD = 'wishlist-reservations-admin-password'
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

interface GiftReservationDto {
  id: string
  wishId: string
  memberId: string
  createdAt: string
  updatedAt: string
}

type ReservationResponse = {
  status: number
  body: GiftReservationDto | { error: { code: string } }
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

async function reserve(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<ReservationResponse> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function cancel(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<{ status: number; body?: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  }
}

async function getReservation(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<ReservationResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function listReservations(
  app: TestApp,
  session: MemberSession,
): Promise<{
  status: number
  body: { reservations: GiftReservationDto[] } | { error: { code: string } }
}> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/wishlist/reservations',
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function markReceived(app: TestApp, session: MemberSession, wishId: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/received`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
}

async function removeWish(app: TestApp, session: MemberSession, wishId: string): Promise<void> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(204)
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

/** The author's view of their own wish's reservation, in every shape it could leak. */
async function expectAuthorLearnedNothing(
  app: TestApp,
  author: MemberSession,
  wishId: string,
): Promise<void> {
  // The per-wish read answers what an unreserved wish answers.
  const read = await getReservation(app, author, wishId)
  expect(read.status).toBe(404)
  expect(errorCode(read.body)).toBe('reservation_not_found')

  // The listing carries no reservation on the author's own wish.
  const listing = await listReservations(app, author)
  expect(listing.status).toBe(200)
  const held = (listing.body as { reservations: GiftReservationDto[] }).reservations.filter(
    (reservation) => reservation.wishId === wishId,
  )
  expect(held).toEqual([])

  // The cancel answers what an unreserved wish answers.
  const cancelled = await cancel(app, author, wishId)
  expect(cancelled.status).toBe(409)
  expect(errorCode(cancelled.body)).toBe('wish_not_reserved')
}

describe('the gift reservations (issue #19)', () => {
  test('a member reserves another member’s wish, and every member but the author sees it', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const created = await reserve(app, anna, lamp.id)
      expect(created.status).toBe(201)
      const held = created.body as GiftReservationDto
      expect(held).toMatchObject({ wishId: lamp.id, memberId: anna.memberId })

      // The other members read it, including who reserved (issue #19).
      for (const member of [anna, lyuda]) {
        const read = await getReservation(app, member, lamp.id)
        expect(read.status).toBe(200)
        expect(read.body).toMatchObject({ wishId: lamp.id, memberId: anna.memberId })

        const listing = await listReservations(app, member)
        expect(
          (listing.body as { reservations: GiftReservationDto[] }).reservations,
        ).toEqual([held])
      }

      // The author of the wish learns nothing, in any shape (ADR-0001).
      await expectAuthorLearnedNothing(app, dima, lamp.id)
    })
  })

  test('a member cannot reserve their own wish, and a wish has at most one active reservation', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const kettle = await createWish(app, anna, 'Термос')

      const own = await reserve(app, anna, kettle.id)
      expect(own.status).toBe(403)
      expect(errorCode(own.body)).toBe('reserve_own_wish')

      // An owner is no exception; the rule is about the wish's author.
      const first = await reserve(app, dima, kettle.id)
      expect(first.status).toBe(201)

      const second = await reserve(app, lyuda, kettle.id)
      expect(second.status).toBe(409)
      expect(errorCode(second.body)).toBe('wish_already_reserved')

      // The refusal changed nothing: Дима still holds the one reservation.
      const read = await getReservation(app, lyuda, kettle.id)
      expect((read.body as GiftReservationDto).memberId).toBe(dima.memberId)
      await expectAuthorLearnedNothing(app, anna, kettle.id)
    })
  })

  test('only the reserving member cancels, and the wish is free for another claim', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const lamp = await createWish(app, lyuda, 'Налобный фонарь')

      const created = await reserve(app, anna, lamp.id)
      expect(created.status).toBe(201)

      // A member who does not hold the reservation cannot cancel it — but
      // they could see it anyway, so the 403 confirms nothing new.
      const stranger = await cancel(app, dima, lamp.id)
      expect(stranger.status).toBe(403)
      expect(errorCode(stranger.body)).toBe('reservation_holder_required')

      // Still held after the refused cancel.
      const still = await getReservation(app, dima, lamp.id)
      expect(still.status).toBe(200)

      const cancelled = await cancel(app, anna, lamp.id)
      expect(cancelled.status).toBe(204)

      const gone = await getReservation(app, dima, lamp.id)
      expect(gone.status).toBe(404)
      expect(errorCode(gone.body)).toBe('reservation_not_found')

      const repeat = await cancel(app, anna, lamp.id)
      expect(repeat.status).toBe(409)
      expect(errorCode(repeat.body)).toBe('wish_not_reserved')

      // The wish is free again: another member claims it.
      const again = await reserve(app, dima, lamp.id)
      expect(again.status).toBe(201)
      await expectAuthorLearnedNothing(app, lyuda, lamp.id)
    })
  })

  test('marking the wish received ends its reservation, and a received wish cannot be reserved', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const created = await reserve(app, anna, lamp.id)
      expect(created.status).toBe(201)

      await markReceived(app, dima, lamp.id)

      // The reservation ended for the members who could see it.
      const after = await getReservation(app, anna, lamp.id)
      expect(after.status).toBe(404)
      expect(errorCode(after.body)).toBe('reservation_not_found')

      // A received wish cannot be reserved again (issue #19): the wish has
      // been given.
      const refused = await reserve(app, anna, lamp.id)
      expect(refused.status).toBe(409)
      expect(errorCode(refused.body)).toBe('wish_already_received')

      // And the author still learned nothing of the reservation that was.
      await expectAuthorLearnedNothing(app, dima, lamp.id)
    })
  })

  test('removing the wish ends its reservation', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const created = await reserve(app, anna, lamp.id)
      expect(created.status).toBe(201)

      await removeWish(app, dima, lamp.id)

      const after = await getReservation(app, anna, lamp.id)
      expect(after.status).toBe(404)
      expect(errorCode(after.body)).toBe('wish_not_found')

      const listing = await listReservations(app, anna)
      expect((listing.body as { reservations: GiftReservationDto[] }).reservations).toEqual([])
    })
  })

  test('a stranger’s wish in another space answers 404, hidden section answers section_hidden', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const foreign = await createWish(app, stranger, 'Чужое желание')

      const cross = await reserve(app, anna, foreign.id)
      expect(cross.status).toBe(404)
      expect(errorCode(cross.body)).toBe('wish_not_found')

      const crossRead = await getReservation(app, anna, foreign.id)
      expect(crossRead.status).toBe(404)
      expect(errorCode(crossRead.body)).toBe('wish_not_found')

      await hideWishlist(app, anna, false)

      const hidden = await reserve(app, anna, lamp.id)
      expect(hidden.status).toBe(404)
      expect(errorCode(hidden.body)).toBe('section_hidden')

      const hiddenList = await listReservations(app, anna)
      expect(hiddenList.status).toBe(404)
      expect(errorCode(hiddenList.body)).toBe('section_hidden')

      const hiddenRead = await getReservation(app, anna, lamp.id)
      expect(hiddenRead.status).toBe(404)
      expect(errorCode(hiddenRead.body)).toBe('section_hidden')

      const hiddenCancel = await cancel(app, anna, lamp.id)
      expect(hiddenCancel.status).toBe(404)
      expect(errorCode(hiddenCancel.body)).toBe('section_hidden')
    })
  })
})
