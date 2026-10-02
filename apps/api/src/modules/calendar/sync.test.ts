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

const ADMIN_PASSWORD = 'calendar-sync-admin-password'
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

interface SyncEvent {
  id: string
  creatorId: string
  title: string
  allDay: boolean
  date?: string
  startsAt?: string
  endsAt?: string
  timezone?: string
}

interface SyncResponse {
  revision: string
  changes: Array<{ entity: string; event?: SyncEvent }>
  tombstones: Array<{ entity: string; entityId: string; audience: string; memberId?: string }>
}

async function sync(app: TestApp, session: MemberSession, since: string): Promise<SyncResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/sync?since=${since}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return response.json()
}

function eventChanges(result: SyncResponse): SyncEvent[] {
  return result.changes
    .filter((change) => change.entity === 'calendar_event')
    .map((change) => change.event as SyncEvent)
}

async function createEvent(
  app: TestApp,
  session: MemberSession,
  body: {
    title: string
    allDay: boolean
    date: string
    startTime?: string
    endTime?: string
    timezone?: string
  },
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/calendar/events',
    headers: memberHeaders(session),
    payload: body,
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function removeEvent(app: TestApp, session: MemberSession, eventId: string): Promise<void> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/calendar/events/${eventId}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(204)
}

describe('the calendar sync contributor (issues #14 and #20)', () => {
  test('every event reaches every member, both kinds whole', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const dinner = await createEvent(app, anna, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-03',
        startTime: '18:00',
        endTime: '21:00',
        timezone: 'Europe/Moscow',
      })
      const birthday = await createEvent(app, dima, {
        title: 'День рождения Люды',
        allDay: true,
        date: '2026-10-19',
      })

      // From revision 0 both members carry both events — the calendar is
      // the space's shared schedule (CONTEXT.md).
      for (const session of [anna, dima]) {
        const result = await sync(app, session, '0')
        const events = eventChanges(result)
        expect(events).toHaveLength(2)
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: dinner.id,
              allDay: false,
              startsAt: '2026-10-03T15:00:00.000Z',
              timezone: 'Europe/Moscow',
            }),
            expect.objectContaining({
              id: birthday.id,
              allDay: true,
              date: '2026-10-19',
            }),
          ]),
        )
      }

      const cursor = (await sync(app, dima, '0')).revision

      // The edit rides the delta to the other members.
      const edit = await app.inject({
        method: 'PUT',
        url: `/api/v1/calendar/events/${dinner.id}`,
        headers: memberHeaders(anna),
        payload: {
          title: 'Ужин у бабушки',
          allDay: false,
          date: '2026-10-03',
          startTime: '17:00',
          endTime: '20:00',
          timezone: 'Europe/Moscow',
        },
      })
      expect(edit.statusCode).toBe(200)

      const delta = await sync(app, dima, cursor)
      const events = eventChanges(delta)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ id: dinner.id, startsAt: '2026-10-03T14:00:00.000Z' })
    })
  })

  test('a removal reaches the other devices as a tombstone for everyone', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const event = await createEvent(app, anna, {
        title: 'Поход',
        allDay: true,
        date: '2026-10-10',
      })
      const seen = await sync(app, dima, '0')
      expect(eventChanges(seen)).toHaveLength(1)
      const cursor = seen.revision

      await removeEvent(app, anna, event.id)

      const delta = await sync(app, dima, cursor)
      expect(eventChanges(delta)).toEqual([])
      expect(delta.tombstones).toEqual([
        {
          entity: 'calendar_event',
          entityId: event.id,
          audience: 'all',
        },
      ])

      // A fresh device syncing from 0 gets neither the row (it is gone)
      // nor a stale delivery: the tombstone answers alone.
      const fresh = await sync(app, dima, '0')
      expect(eventChanges(fresh)).toEqual([])
      expect(fresh.tombstones.map((tombstone) => tombstone.entityId)).toContain(event.id)
    })
  })

  test('events of another space never appear', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      await createEvent(app, stranger, {
        title: 'Чужое событие',
        allDay: true,
        date: '2026-10-10',
      })

      const result = await sync(app, anna, '0')
      expect(eventChanges(result)).toEqual([])
    })
  })

  test('a hidden calendar contributes nothing, and a re-shown one resyncs from 0', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const event = await createEvent(app, dima, {
        title: 'До скрытия',
        allDay: true,
        date: '2026-10-10',
      })
      const before = await sync(app, dima, '0')
      expect(eventChanges(before)).toHaveLength(1)

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { calendar: false } },
      })
      expect(hide.statusCode).toBe(200)

      // From the pre-hide cursor the delta carries the new sections map and
      // no calendar rows: the client drops the section's rows when it
      // applies the map (ADR-0011, ADR-0014).
      const delta = await sync(app, dima, before.revision)
      expect(eventChanges(delta)).toEqual([])
      const spaceChange = delta.changes.find((change) => change.entity === 'space')
      expect(spaceChange).toMatchObject({
        space: { sections: { journal: true, calendar: false, wishlist: true } },
      })

      const show = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { calendar: true } },
      })
      expect(show.statusCode).toBe(200)

      // The client that saw the re-show discards its cursor and syncs from
      // revision 0 once: the section's full data comes back.
      const resync = await sync(app, dima, '0')
      expect(eventChanges(resync).map((row) => row.id)).toEqual([event.id])
    })
  })
})
