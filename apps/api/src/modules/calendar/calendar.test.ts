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
  recurrence?: { frequency: string; until?: string }
  exceptions?: Array<Record<string, unknown>>
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
  recurrence?: { frequency: string; until?: string }
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

/** PUT …/occurrences/{originalDate} — one occurrence's replacement. */
async function editOccurrence(
  app: TestApp,
  session: MemberSession,
  eventId: string,
  originalDate: string,
  body: EventBody,
): Promise<{ status: number; body: EventDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/calendar/events/${eventId}/occurrences/${originalDate}`,
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

/** DELETE …/occurrences/{originalDate} — one occurrence cancelled. */
async function cancelOccurrence(
  app: TestApp,
  session: MemberSession,
  eventId: string,
  originalDate: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/calendar/events/${eventId}/occurrences/${originalDate}`,
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
      // readings into another millennium; the plan horizon refuses it, and
      // says which bound the date crossed.
      const strayYear = await createEvent(app, anna, {
        title: 'Чыше',
        allDay: true,
        date: '0026-10-03',
      })
      expect(strayYear.status).toBe(400)
      expect(strayYear.body).toMatchObject({ error: { code: 'invalid_event_date' } })
      expect((strayYear.body as unknown as { error: { message: string } }).error.message).toContain(
        'outside the supported range',
      )

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

  test('an edit composes across the gap and trims its title', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-06-10',
        startTime: '10:00',
        endTime: '11:00',
        timezone: 'America/New_York',
      })
      expect(created.status).toBe(201)
      const eventId = (created.body as EventDto).id

      // New York jumps 02:00 → 03:00 on 2026-03-08. A pair the gap
      // swallows whole is refused through the edit exactly as through the
      // create; a longer event over the same nonexistent start is kept
      // from the gap's far side.
      const refused = await editEvent(app, anna, eventId, {
        title: 'Созвон',
        allDay: false,
        date: '2026-03-08',
        startTime: '02:30',
        endTime: '03:15',
        timezone: 'America/New_York',
      })
      expect(refused.status).toBe(400)
      expect(refused.body).toMatchObject({ error: { code: 'event_start_in_gap' } })

      const overTheGap = await editEvent(app, anna, eventId, {
        title: 'Созвон',
        allDay: false,
        date: '2026-03-08',
        startTime: '02:30',
        endTime: '04:00',
        timezone: 'America/New_York',
      })
      expect(overTheGap.status).toBe(200)
      expect(overTheGap.body).toMatchObject({
        startsAt: '2026-03-08T07:30:00.000Z',
        endsAt: '2026-03-08T08:00:00.000Z',
      })

      // A padded title is trimmed on the edit as on the create.
      const padded = await editEvent(app, anna, eventId, {
        title: '  Созвон  ',
        allDay: false,
        date: '2026-06-10',
        startTime: '10:00',
        endTime: '11:00',
        timezone: 'America/New_York',
      })
      expect(padded.status).toBe(200)
      expect(padded.body).toMatchObject({ title: 'Созвон' })
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

describe('repeating events and occurrence exceptions (issue #21)', () => {
  test('a repeating event stores its rule and answers the reads with it', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // An all-day weekly series with an end date.
      const birthday = await createEvent(app, anna, {
        title: 'День рождения Люды',
        allDay: true,
        date: '2026-10-19',
        recurrence: { frequency: 'yearly', until: '2036-10-19' },
      })
      expect(birthday.status).toBe(201)
      expect((birthday.body as EventDto).recurrence).toEqual({
        frequency: 'yearly',
        until: '2036-10-19',
      })
      expect((birthday.body as EventDto).exceptions).toBeUndefined()

      // A timed weekly series without an end.
      const dinner = await createEvent(app, anna, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-05',
        startTime: '18:00',
        endTime: '21:00',
        timezone: 'Europe/Moscow',
        recurrence: { frequency: 'weekly' },
      })
      expect(dinner.status).toBe(201)
      expect((dinner.body as EventDto).recurrence).toEqual({ frequency: 'weekly' })

      // The reads answer the same: the wire carries the structured
      // recurrence, never the stored RRULE text.
      const read = await getEvent(app, anna, (dinner.body as EventDto).id)
      expect(read.status).toBe(200)
      expect((read.body as EventDto).recurrence).toEqual({ frequency: 'weekly' })
      const listed = await listEvents(app, anna)
      expect(
        (listed.body as { events: EventDto[] }).events.map((event) => event.recurrence),
      ).toEqual([{ frequency: 'yearly', until: '2036-10-19' }, { frequency: 'weekly' }])
    })
  })

  test('a recurrence with any other RRULE feature is refused by the contract', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const refused: Array<Record<string, unknown>> = [
        // A frequency the calendar does not keep.
        { frequency: 'hourly' },
        // An interval: only every-Nth-step rules are not accepted.
        { frequency: 'daily', interval: 2 },
        // A by-day: the weekday comes from the first occurrence.
        { frequency: 'weekly', byWeekday: ['monday'] },
        // A count: the series is bounded by until, never by a number.
        { frequency: 'monthly', count: 5 },
        // A raw rule text is not a shape the wire speaks.
        { rrule: 'FREQ=WEEKLY;BYDAY=MO' },
      ]
      for (const recurrence of refused) {
        const attempt = await createEvent(app, anna, {
          title: 'Серия',
          allDay: true,
          date: '2026-10-19',
          recurrence,
        } as EventBody)
        expect(attempt.status).toBe(400)
        expect(attempt.body).toMatchObject({ error: { code: 'validation_failed' } })
      }
    })
  })

  test('an until date before the first occurrence is refused, on it is kept', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const before = await createEvent(app, anna, {
        title: 'Серия',
        allDay: true,
        date: '2026-10-19',
        recurrence: { frequency: 'monthly', until: '2026-10-18' },
      })
      expect(before.status).toBe(400)
      expect(before.body).toMatchObject({ error: { code: 'invalid_recurrence_until' } })

      // An impossible until date is the date rule's answer, not a 500.
      const impossible = await createEvent(app, anna, {
        title: 'Серия',
        allDay: true,
        date: '2026-10-19',
        recurrence: { frequency: 'monthly', until: '2026-02-30' },
      })
      expect(impossible.status).toBe(400)
      expect(impossible.body).toMatchObject({ error: { code: 'invalid_event_date' } })

      // The until date itself is a day the series may occupy.
      const onIt = await createEvent(app, anna, {
        title: 'Серия',
        allDay: true,
        date: '2026-10-19',
        recurrence: { frequency: 'monthly', until: '2026-10-19' },
      })
      expect(onIt.status).toBe(201)
      expect((onIt.body as EventDto).recurrence).toEqual({
        frequency: 'monthly',
        until: '2026-10-19',
      })
    })
  })

  test('editing the series replaces the rule; dropping it makes the event one-time', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'Утренняя зарядка',
        allDay: false,
        date: '2026-10-05',
        startTime: '07:00',
        endTime: '08:00',
        recurrence: { frequency: 'daily' },
      })
      expect(created.status).toBe(201)
      const series = (created.body as EventDto).id

      // Exceptions exist first, so the edits' effect on them is visible:
      // the 7th a Wednesday, the 8th a Thursday, the 12th the next Monday.
      expect((await cancelOccurrence(app, anna, series, '2026-10-07')).status).toBe(204)
      expect((await cancelOccurrence(app, anna, series, '2026-10-08')).status).toBe(204)
      expect((await cancelOccurrence(app, anna, series, '2026-10-12')).status).toBe(204)

      // The whole-series edit keeps the series a series: the rule is
      // replaced, and the exceptions it can still honour survive — while
      // the ones anchored to dates the new rule never produces go with
      // the replace (a weekly series from Monday the 5th has no Wednesday
      // the 7th or Thursday the 8th to skip any more).
      const replaced = await editEvent(app, anna, series, {
        title: 'Утренняя зарядка',
        allDay: false,
        date: '2026-10-05',
        startTime: '06:30',
        endTime: '07:30',
        recurrence: { frequency: 'weekly', until: '2027-10-05' },
      })
      expect(replaced.status).toBe(200)
      expect((replaced.body as EventDto).recurrence).toEqual({
        frequency: 'weekly',
        until: '2027-10-05',
      })
      expect((replaced.body as EventDto).exceptions).toEqual([
        { originalDate: '2026-10-12', kind: 'cancelled' },
      ])

      // A replace that keeps the pattern keeps every exception.
      const same = await editEvent(app, anna, series, {
        title: 'Утренняя зарядка — теперь с разминкой',
        allDay: false,
        date: '2026-10-05',
        startTime: '06:30',
        endTime: '07:30',
        recurrence: { frequency: 'weekly', until: '2027-10-05' },
      })
      expect(same.status).toBe(200)
      expect((same.body as EventDto).exceptions).toEqual([
        { originalDate: '2026-10-12', kind: 'cancelled' },
      ])

      // The absent recurrence is a whole replace: the event becomes
      // one-time, and its exceptions — cancellations of occurrences that
      // no longer exist — go with the rule.
      const oneTime = await editEvent(app, anna, series, {
        title: 'Утренняя зарядка',
        allDay: false,
        date: '2026-10-05',
        startTime: '06:30',
        endTime: '07:30',
      })
      expect(oneTime.status).toBe(200)
      expect((oneTime.body as EventDto).recurrence).toBeUndefined()
      expect((oneTime.body as EventDto).exceptions).toBeUndefined()

      const read = await getEvent(app, anna, series)
      expect((read.body as EventDto).recurrence).toBeUndefined()
      expect((read.body as EventDto).exceptions).toBeUndefined()
    })
  })

  test('editing an occurrence stores an override keyed by the original date', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ timezone: 'Asia/Novosibirsk' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-05',
        startTime: '18:00',
        endTime: '21:00',
        timezone: 'Europe/Moscow',
        recurrence: { frequency: 'weekly' },
      })
      expect(created.status).toBe(201)
      const series = (created.body as EventDto).id

      // 2026-10-12 is the next Monday: the override replaces it whole —
      // a different title, an all-day date of its own. The zone left
      // un named for a timed override is the space's, like any event's.
      const override = await editOccurrence(app, anna, series, '2026-10-12', {
        title: 'Поход в театр',
        allDay: true,
        date: '2026-10-13',
      })
      expect(override.status).toBe(200)
      expect((override.body as EventDto).exceptions).toEqual([
        {
          originalDate: '2026-10-12',
          kind: 'override',
          title: 'Поход в театр',
          allDay: true,
          date: '2026-10-13',
        },
      ])
      // The series itself is untouched: the override is keyed by the
      // original date, the rule and first occurrence stand.
      expect((override.body as EventDto).recurrence).toEqual({ frequency: 'weekly' })
      expect((override.body as EventDto).startsAt).toBe('2026-10-05T15:00:00.000Z')

      // A timed override composes against the space's zone when none is
      // named, like a whole event's.
      const timed = await createEvent(app, anna, {
        title: 'Созвон',
        allDay: false,
        date: '2026-10-06',
        startTime: '09:00',
        endTime: '10:00',
        recurrence: { frequency: 'daily' },
      })
      expect(timed.status).toBe(201)
      const timedId = (timed.body as EventDto).id
      const timedOverride = await editOccurrence(app, anna, timedId, '2026-10-07', {
        title: 'Созвон у Димы',
        allDay: false,
        date: '2026-10-07',
        startTime: '11:00',
        endTime: '12:00',
      })
      expect(timedOverride.status).toBe(200)
      expect((timedOverride.body as EventDto).exceptions).toEqual([
        expect.objectContaining({
          originalDate: '2026-10-07',
          kind: 'override',
          allDay: false,
          startsAt: '2026-10-07T04:00:00.000Z',
          timezone: 'Asia/Novosibirsk',
        }),
      ])

      // The reads answer the exceptions too.
      const read = await getEvent(app, anna, series)
      expect((read.body as EventDto).exceptions).toHaveLength(1)
    })
  })

  test('cancelling an occurrence skips one date and flips an override', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'Утренняя зарядка',
        allDay: false,
        date: '2026-10-05',
        startTime: '07:00',
        endTime: '08:00',
        recurrence: { frequency: 'daily', until: '2026-10-11' },
      })
      expect(created.status).toBe(201)
      const series = (created.body as EventDto).id

      const cancel = await cancelOccurrence(app, anna, series, '2026-10-07')
      expect(cancel.status).toBe(204)

      const read = await getEvent(app, anna, series)
      expect((read.body as EventDto).exceptions).toEqual([
        { originalDate: '2026-10-07', kind: 'cancelled' },
      ])

      // Cancelling the same date again answers the same: the exception is
      // an upsert, not a second row.
      const again = await cancelOccurrence(app, anna, series, '2026-10-07')
      expect(again.status).toBe(204)
      const reread = await getEvent(app, anna, series)
      expect((reread.body as EventDto).exceptions).toEqual([
        { originalDate: '2026-10-07', kind: 'cancelled' },
      ])

      // An edit of the cancelled date revives the occurrence: the newest
      // write wins, one exception per original date.
      const revived = await editOccurrence(app, anna, series, '2026-10-07', {
        title: 'Зарядка у Димы',
        allDay: false,
        date: '2026-10-07',
        startTime: '08:00',
        endTime: '09:00',
      })
      expect(revived.status).toBe(200)
      expect((revived.body as EventDto).exceptions).toEqual([
        expect.objectContaining({ originalDate: '2026-10-07', kind: 'override' }),
      ])

      // Cancelling the edited date cancels it: the override is replaced.
      const cancelled = await cancelOccurrence(app, anna, series, '2026-10-07')
      expect(cancelled.status).toBe(204)
      const final = await getEvent(app, anna, series)
      expect((final.body as EventDto).exceptions).toEqual([
        { originalDate: '2026-10-07', kind: 'cancelled' },
      ])
    })
  })

  test('an occurrence the series does not have is refused', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const weekly = await createEvent(app, anna, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-05',
        startTime: '18:00',
        endTime: '21:00',
        recurrence: { frequency: 'weekly' },
      })
      expect(weekly.status).toBe(201)
      const series = (weekly.body as EventDto).id

      // 2026-10-06 is a Tuesday: the series has no occurrence there.
      const offPattern = await cancelOccurrence(app, anna, series, '2026-10-06')
      expect(offPattern.status).toBe(404)
      expect(offPattern.body).toMatchObject({ error: { code: 'occurrence_not_found' } })

      // Before the series starts, and past its until.
      const bounded = await createEvent(app, anna, {
        title: 'Зарядка',
        allDay: true,
        date: '2026-10-05',
        recurrence: { frequency: 'daily', until: '2026-10-11' },
      })
      expect(bounded.status).toBe(201)
      const boundedId = (bounded.body as EventDto).id
      const tooEarly = await cancelOccurrence(app, anna, boundedId, '2026-10-04')
      expect(tooEarly.status).toBe(404)
      expect(tooEarly.body).toMatchObject({ error: { code: 'occurrence_not_found' } })
      const tooLate = await cancelOccurrence(app, anna, boundedId, '2026-10-12')
      expect(tooLate.status).toBe(404)
      expect(tooLate.body).toMatchObject({ error: { code: 'occurrence_not_found' } })

      // A monthly series on the 31st has no occurrence in February: the
      // skip is part of the pattern (the acceptance criteria).
      const monthly = await createEvent(app, anna, {
        title: 'Клуб тридцать первых',
        allDay: true,
        date: '2026-01-31',
        recurrence: { frequency: 'monthly' },
      })
      expect(monthly.status).toBe(201)
      const monthlyId = (monthly.body as EventDto).id
      const february = await cancelOccurrence(app, anna, monthlyId, '2026-02-28')
      expect(february.status).toBe(404)
      expect(february.body).toMatchObject({ error: { code: 'occurrence_not_found' } })
      const march = await cancelOccurrence(app, anna, monthlyId, '2026-03-31')
      expect(march.status).toBe(204)

      // A one-time event has no occurrences at all.
      const single = await createEvent(app, anna, {
        title: 'Разовое',
        allDay: true,
        date: '2026-10-05',
      })
      expect(single.status).toBe(201)
      const singleId = (single.body as EventDto).id
      const notRecurring = await cancelOccurrence(app, anna, singleId, '2026-10-05')
      expect(notRecurring.status).toBe(400)
      expect(notRecurring.body).toMatchObject({ error: { code: 'event_not_recurring' } })

      // An unbounded daily series would otherwise take an exception in any
      // year at all: a date outside the plan horizon is a validation
      // answer, not an occurrence.
      const farFuture = await cancelOccurrence(app, anna, boundedId, '9999-12-31')
      expect(farFuture.status).toBe(400)
      expect(farFuture.body).toMatchObject({ error: { code: 'invalid_event_date' } })

      // A date that is not a date is the contract's answer.
      const malformed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/calendar/events/${series}/occurrences/not-a-date`,
        headers: memberHeaders(anna),
      })
      expect(malformed.statusCode).toBe(400)
      expect(malformed.json()).toMatchObject({ error: { code: 'validation_failed' } })

      // An event that is not here answers the ordinary 404.
      const missing = await cancelOccurrence(
        app,
        anna,
        '01900000-0000-7000-8000-00000000c0de',
        '2026-10-05',
      )
      expect(missing.status).toBe(404)
      expect(missing.body).toMatchObject({ error: { code: 'event_not_found' } })
    })
  })

  test('occurrence changes follow the moderation model', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const created = await createEvent(app, dima, {
        title: 'Ужин у бабушки',
        allDay: false,
        date: '2026-10-05',
        startTime: '18:00',
        endTime: '21:00',
        recurrence: { frequency: 'weekly' },
      })
      expect(created.status).toBe(201)
      const series = (created.body as EventDto).id

      // A regular member who is not the creator is refused the occurrence
      // change and the cancellation — the journal's moderation model.
      const strangerEdit = await editOccurrence(app, lyuda, series, '2026-10-12', {
        title: 'Вечеринка',
        allDay: true,
        date: '2026-10-12',
      })
      expect(strangerEdit.status).toBe(403)
      expect(strangerEdit.body).toMatchObject({ error: { code: 'creator_required' } })
      const strangerCancel = await cancelOccurrence(app, lyuda, series, '2026-10-12')
      expect(strangerCancel.status).toBe(403)
      expect(strangerCancel.body).toMatchObject({ error: { code: 'creator_required' } })

      // The creator edits an occurrence; the owner moderates another's.
      const own = await editOccurrence(app, dima, series, '2026-10-12', {
        title: 'Ужин у бабушки — в кафе',
        allDay: false,
        date: '2026-10-12',
        startTime: '19:00',
        endTime: '22:00',
      })
      expect(own.status).toBe(200)
      const moderated = await cancelOccurrence(app, anna, series, '2026-10-19')
      expect(moderated.status).toBe(204)
      const read = await getEvent(app, dima, series)
      expect((read.body as EventDto).exceptions).toHaveLength(2)
    })
  })

  test('removing the series takes its exceptions with it', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEvent(app, anna, {
        title: 'Утренняя зарядка',
        allDay: true,
        date: '2026-10-05',
        recurrence: { frequency: 'daily' },
      })
      expect(created.status).toBe(201)
      const series = (created.body as EventDto).id
      expect((await cancelOccurrence(app, anna, series, '2026-10-07')).status).toBe(204)
      expect((await deleteEvent(app, anna, series)).status).toBe(204)

      // A fresh series with the same shape holds no exceptions of the
      // removed one: the rows went with their event.
      const recreated = await createEvent(app, anna, {
        title: 'Утренняя зарядка',
        allDay: true,
        date: '2026-10-05',
        recurrence: { frequency: 'daily' },
      })
      expect(recreated.status).toBe(201)
      expect((recreated.body as EventDto).exceptions).toBeUndefined()
    })
  })
})
