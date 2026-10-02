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

const ADMIN_PASSWORD = 'calendar-admin-password'
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

interface EventDto {
  id: string
  creatorId: string
  title: string
  allDay: boolean
  date?: string
  startsAt?: string
  endsAt?: string
  timezone?: string
  createdAt: string
  updatedAt: string
}

type EventBody = {
  title: string
  allDay: boolean
  date: string
  startTime?: string
  endTime?: string
  timezone?: string
}

async function createEvent(
  app: TestApp,
  session: MemberSession,
  body: EventBody,
): Promise<{ status: number; body: EventDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/calendar/events',
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function listEvents(
  app: TestApp,
  session: MemberSession,
): Promise<{ status: number; body: { events: EventDto[] } | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/calendar/events',
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function getEvent(
  app: TestApp,
  session: MemberSession,
  eventId: string,
): Promise<{ status: number; body: EventDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/calendar/events/${eventId}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function editEvent(
  app: TestApp,
  session: MemberSession,
  eventId: string,
  body: EventBody,
): Promise<{ status: number; body: EventDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/calendar/events/${eventId}`,
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function deleteEvent(
  app: TestApp,
  session: MemberSession,
  eventId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/calendar/events/${eventId}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() }
}

const TIMED_DINNER: EventBody = {
  title: 'Ужин у бабушки',
  allDay: false,
  date: '2026-10-03',
  startTime: '18:00',
  endTime: '21:00',
  timezone: 'Europe/Moscow',
}

describe('calendar events (issue #20)', () => {
  test('a timed event round-trips its wall time through the zone it keeps', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ timezone: 'Asia/Novosibirsk' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      // The zone is named: the wall time composes against it, MSK being
      // UTC+3 on this date.
      const created = await createEvent(app, anna, TIMED_DINNER)
      expect(created.status).toBe(201)
      const dinner = created.body as EventDto
      expect(dinner).toMatchObject({
        title: 'Ужин у бабушки',
        allDay: false,
        creatorId: anna.memberId,
        startsAt: '2026-10-03T15:00:00.000Z',
        endsAt: '2026-10-03T18:00:00.000Z',
        timezone: 'Europe/Moscow',
      })
      expect(dinner.date).toBeUndefined()

      // The stored event answers the same through the reads.
      const read = await getEvent(app, anna, dinner.id)
      expect(read.status).toBe(200)
      expect(read.body).toMatchObject({ startsAt: '2026-10-03T15:00:00.000Z' })

      // The edit re-composes: the same wall time in Novosibirsk is the
      // space's own zone, and the instants follow it.
      const edited = await editEvent(app, anna, dinner.id, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-03',
        startTime: '18:00',
        endTime: '21:00',
      })
      expect(edited.status).toBe(200)
      expect(edited.body).toMatchObject({
        startsAt: '2026-10-03T11:00:00.000Z',
        endsAt: '2026-10-03T14:00:00.000Z',
        timezone: 'Asia/Novosibirsk',
      })
    })
  })

  test('a timed event without a zone takes the space’s, DST included', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ timezone: 'America/New_York' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // October 3rd is inside summer time (UTC−4).
      const summer = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-10-03',
        startTime: '09:00',
        endTime: '10:00',
      })
      expect(summer.status).toBe(201)
      expect(summer.body).toMatchObject({
        timezone: 'America/New_York',
        startsAt: '2026-10-03T13:00:00.000Z',
        endsAt: '2026-10-03T14:00:00.000Z',
      })

      // November 3rd is winter time (UTC−5): the same wall time is an hour
      // later in UTC. The event keeps the space's zone either way.
      const winter = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-11-03',
        startTime: '09:00',
        endTime: '10:00',
      })
      expect(winter.status).toBe(201)
      expect(winter.body).toMatchObject({
        timezone: 'America/New_York',
        startsAt: '2026-11-03T14:00:00.000Z',
        endsAt: '2026-11-03T15:00:00.000Z',
      })
    })
  })

  test('an all-day event keeps its zoneless date and carries no time at all', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ timezone: 'Asia/Novosibirsk' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'День рождения Люды',
        allDay: true,
        date: '2026-10-19',
      })
      expect(created.status).toBe(201)
      expect(created.body).toEqual({
        id: expect.any(String),
        creatorId: anna.memberId,
        title: 'День рождения Люды',
        allDay: true,
        date: '2026-10-19',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })

      // The edit is a replace: the all-day event becomes a timed one, and
      // the date column it carried is gone.
      const edited = await editEvent(app, anna, (created.body as EventDto).id, {
        title: 'День рождения Люды — тортик',
        allDay: false,
        date: '2026-10-19',
        startTime: '17:00',
        endTime: '20:00',
        timezone: 'Europe/Moscow',
      })
      expect(edited.status).toBe(200)
      expect(edited.body).toMatchObject({
        allDay: false,
        startsAt: '2026-10-19T14:00:00.000Z',
        timezone: 'Europe/Moscow',
      })
      expect((edited.body as EventDto).date).toBeUndefined()
    })
  })

  test('every member sees every event; the space next door sees none of them', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const dinner = await createEvent(app, anna, TIMED_DINNER)
      const birthday = await createEvent(app, dima, {
        title: 'День рождения Люды',
        allDay: true,
        date: '2026-10-19',
      })
      expect(dinner.status).toBe(201)
      expect(birthday.status).toBe(201)

      // Дима sees Аня's event whole — the calendar is the space's shared
      // schedule (CONTEXT.md, calendar event).
      const ours = await listEvents(app, dima)
      expect(ours.status).toBe(200)
      expect((ours.body as { events: EventDto[] }).events.map((event) => event.id).sort()).toEqual(
        [(dinner.body as EventDto).id, (birthday.body as EventDto).id].sort(),
      )
      const cross = await getEvent(app, dima, (dinner.body as EventDto).id)
      expect(cross.status).toBe(200)

      // A stranger's space holds none of them, by list or by address.
      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const theirs = await listEvents(app, stranger)
      expect(theirs.status).toBe(200)
      expect((theirs.body as { events: EventDto[] }).events).toEqual([])
      const hidden = await getEvent(app, stranger, (dinner.body as EventDto).id)
      expect(hidden.status).toBe(404)
      expect(hidden.body).toMatchObject({ error: { code: 'event_not_found' } })
    })
  })

  test('only the creator — or an owner — edits or deletes an event', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const created = await createEvent(app, dima, TIMED_DINNER)
      expect(created.status).toBe(201)
      const dinner = created.body as EventDto

      // A regular member who is not the creator is refused the edit and
      // the delete — the journal's moderation model (issue #16).
      const strangerEdit = await editEvent(app, lyuda, dinner.id, {
        title: 'Вечеринка',
        allDay: true,
        date: '2026-10-04',
      })
      expect(strangerEdit.status).toBe(403)
      expect(strangerEdit.body).toMatchObject({ error: { code: 'creator_required' } })
      const strangerDelete = await deleteEvent(app, lyuda, dinner.id)
      expect(strangerDelete.status).toBe(403)
      expect(strangerDelete.body).toMatchObject({ error: { code: 'creator_required' } })
      // The refused writes spent no revision on the row.
      const untouched = await getEvent(app, anna, dinner.id)
      expect(untouched.body).toMatchObject({ title: 'Ужин у бабушки', startsAt: dinner.startsAt })

      // The creator edits and deletes their own event.
      const ownEdit = await editEvent(app, dima, dinner.id, {
        title: 'Ужин у бабушки — на час раньше',
        allDay: false,
        date: '2026-10-03',
        startTime: '17:00',
        endTime: '20:00',
        timezone: 'Europe/Moscow',
      })
      expect(ownEdit.status).toBe(200)
      expect(ownEdit.body).toMatchObject({ startsAt: '2026-10-03T14:00:00.000Z' })

      // An owner moderates: Аня edits Дима's event, then any member's
      // delete follows the same rule.
      const ownerEdit = await editEvent(app, anna, dinner.id, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-03',
        startTime: '18:00',
        endTime: '21:00',
        timezone: 'Europe/Moscow',
      })
      expect(ownerEdit.status).toBe(200)
      const ownerDelete = await deleteEvent(app, anna, dinner.id)
      expect(ownerDelete.status).toBe(204)
      const gone = await getEvent(app, dima, dinner.id)
      expect(gone.status).toBe(404)
    })
  })

  test('impossible times are validation answers, not 500s', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // The pattern admits 2026-02-30; the service refuses it.
      const impossibleDate = await createEvent(app, anna, {
        title: 'Чыше',
        allDay: true,
        date: '2026-02-30',
      })
      expect(impossibleDate.status).toBe(400)
      expect(impossibleDate.body).toMatchObject({ error: { code: 'invalid_event_date' } })

      // A half-typed year would compose through the runtime's two-digit
      // readings into another millennium; the plan horizon refuses it.
      const strayYear = await createEvent(app, anna, {
        title: 'Чыше',
        allDay: true,
        date: '0026-10-03',
      })
      expect(strayYear.status).toBe(400)
      expect(strayYear.body).toMatchObject({ error: { code: 'invalid_event_date' } })

      // A timed event whose end does not follow its start.
      const backwards = await createEvent(app, anna, {
        title: 'Вечеринка',
        allDay: false,
        date: '2026-10-03',
        startTime: '21:00',
        endTime: '18:00',
      })
      expect(backwards.status).toBe(400)
      expect(backwards.body).toMatchObject({ error: { code: 'event_end_before_start' } })

      // A pair the wall order of which holds, but whose start the
      // spring-forward gap swallows: New York jumps 02:00 → 03:00 on
      // 2026-03-08, so 02:30–03:15 composes to an end before its start.
      const gapped = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-03-08',
        startTime: '02:30',
        endTime: '03:15',
        timezone: 'America/New_York',
      })
      expect(gapped.status).toBe(400)
      expect(gapped.body).toMatchObject({ error: { code: 'event_start_in_gap' } })

      // A zone the runtime does not know.
      const unknownZone = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-10-03',
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Mars/Olympus',
      })
      expect(unknownZone.status).toBe(400)
      expect(unknownZone.body).toMatchObject({ error: { code: 'invalid_timezone' } })

      // The kinds are total: an all-day payload carrying a time is refused
      // by the contract before any rule runs.
      const mixed = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: true,
        date: '2026-10-03',
        startTime: '09:00',
        endTime: '10:00',
      } as EventBody)
      expect(mixed.status).toBe(400)
      expect(mixed.body).toMatchObject({ error: { code: 'validation_failed' } })

      // And an unknown event address answers the ordinary 404.
      const missing = await getEvent(app, anna, '01900000-0000-7000-8000-00000000c0de')
      expect(missing.status).toBe(404)
    })
  })

  test('a hidden calendar answers 404 section_hidden on every route', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEvent(app, dima, TIMED_DINNER)
      expect(created.status).toBe(201)
      const eventId = (created.body as EventDto).id

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { calendar: false } },
      })
      expect(hide.statusCode).toBe(200)

      for (const attempt of [
        () => listEvents(app, dima),
        () => getEvent(app, dima, eventId),
        () => createEvent(app, dima, TIMED_DINNER),
        () => editEvent(app, dima, eventId, TIMED_DINNER),
        () => deleteEvent(app, dima, eventId),
      ]) {
        const { status, body } = await attempt()
        expect(status).toBe(404)
        expect(body).toMatchObject({ error: { code: 'section_hidden' } })
      }
    })
  })
})
