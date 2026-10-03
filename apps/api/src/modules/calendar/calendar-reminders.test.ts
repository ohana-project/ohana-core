import { eq } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'
import { type FixedClock, fixedClock } from '../../platform/clock.ts'
import { createSilentLogger } from '../../platform/logging.ts'
import {
  createTestHarness,
  dbFailingOnNthTransaction,
  recordingPushSender,
  type TestHarness,
} from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { subscribe } from '../notifications/index.ts'
import { pushSubscriptions } from '../notifications/tables.ts'
import type { TimedSeriesBody } from './contracts.ts'
import {
  CALENDAR_QUEUE_SETUPS,
  CALENDAR_REMINDER_JOB,
  CALENDAR_SENT_QUEUE_SETUPS,
  type CalendarReminderJobData,
  type CalendarReminderJobsDeps,
  extendReminderHorizons,
  sendDueCalendarReminder,
} from './jobs.ts'
import { REMINDER_HORIZON_DAYS } from './reminders.ts'
import * as repository from './repository.ts'
import { REMINDER_CLAIM_TAKEOVER_MS } from './repository.ts'
import { calendarRemindersSent } from './tables.ts'

/*
 * The calendar reminders (issue #22): the event's one reminder with its
 * lead and recipients, the per-occurrence jobs the edits reschedule, and
 * the worker's sending. Every handler here is run twice — delivery is
 * at-least-once, and the second run must be the quiet twin of the first.
 */

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'calendar-reminders-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

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
  title: string
  allDay: boolean
  date?: string
  startsAt?: string
  endsAt?: string
  timezone?: string
  recurrence?: { frequency: string; until?: string }
  exceptions?: Array<Record<string, unknown>>
  reminder?: {
    leadMinutes: number
    recipients: { everyone?: true; memberIds?: string[] }
  }
}

async function createEvent(
  app: TestApp,
  session: MemberSession,
  body: Record<string, unknown>,
): Promise<{ status: number; event: EventDto | undefined; code?: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/calendar/events',
    payload: body,
    headers: memberHeaders(session),
  })
  return {
    status: response.statusCode,
    event: response.json().event ?? response.json(),
    code: response.json().error?.code,
  }
}

function reminderJobs(): Array<{ data: CalendarReminderJobData; startAfter?: Date }> {
  return harness.jobs.submissions
    .filter((submission) => submission.name === CALENDAR_REMINDER_JOB)
    .map((submission) => ({
      data: submission.data as CalendarReminderJobData,
      startAfter: submission.startAfter,
    }))
}

function resetJobLog(): void {
  harness.jobs.submissions.length = 0
}

describe('reminder config on the event (HTTP)', () => {
  test('the creator adds one reminder with a lead and named recipients; the DTO carries it', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const boris = await memberSession(app, adminCookie, space.id, 'Борис')
      resetJobLog()
      const { status, event } = await createEvent(app, anya, {
        title: 'Обед с бабушкой',
        allDay: false,
        date: '2026-01-10',
        startTime: '18:00',
        endTime: '19:00',
        reminder: {
          leadMinutes: 30,
          recipients: { memberIds: [boris.memberId, anya.memberId] },
        },
      })
      expect(status).toBe(201)
      expect(event?.reminder).toEqual({
        leadMinutes: 30,
        recipients: { memberIds: [boris.memberId, anya.memberId] },
      })

      // The worker schedules one reminder job for the occurrence, due the
      // lead time before it.
      const jobs = reminderJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.data).toEqual({
        spaceId: space.id,
        eventId: event?.id,
        originalDate: '2026-01-10',
      })
      expect(jobs[0]?.startAfter?.toISOString()).toBe('2026-01-10T17:30:00.000Z')
    })
  })

  test('everyone is the stored shape; members added later are resolved at send time', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      resetJobLog()
      const { status, event } = await createEvent(app, anya, {
        title: 'Кино',
        allDay: false,
        date: '2026-01-10',
        startTime: '20:00',
        endTime: '22:00',
        reminder: { leadMinutes: 60, recipients: { everyone: true } },
      })
      expect(status).toBe(201)
      expect(event?.reminder).toEqual({ leadMinutes: 60, recipients: { everyone: true } })
      // No member ids travel for everyone: the space's membership is the
      // truth, read when the reminder sends.
      expect(reminderJobs()).toHaveLength(1)
    })
  })

  test('an event without a reminder schedules nothing', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      resetJobLog()
      const { status, event } = await createEvent(app, anya, {
        title: 'Без напоминания',
        allDay: true,
        date: '2026-02-01',
      })
      expect(status).toBe(201)
      expect(event?.reminder).toBeUndefined()
      expect(reminderJobs()).toHaveLength(0)
    })
  })

  test('a recipient who is not a member of the space is refused', async () => {
    const ours = await harness.createSpace()
    const theirs = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, ours.id, 'Аня', 'owner')
      const stranger = await harness.createMember(theirs.id, { name: 'Чужой' })
      const { status, code } = await createEvent(app, anya, {
        title: 'Нельзя',
        allDay: false,
        date: '2026-01-10',
        startTime: '18:00',
        endTime: '19:00',
        reminder: { leadMinutes: 30, recipients: { memberIds: [stranger.id] } },
      })
      expect(status).toBe(400)
      expect(code).toBe('reminder_recipient_not_found')
    })
  })

  test('editing the event reschedules its reminder; dropping the reminder removes it', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const created = await createEvent(app, anya, {
        title: 'Ужин',
        allDay: false,
        date: '2026-01-10',
        startTime: '19:00',
        endTime: '21:00',
        reminder: { leadMinutes: 15, recipients: { everyone: true } },
      })
      expect(created.event?.id).toBeDefined()
      resetJobLog()

      // The time moved and the lead grew: the new schedule answers for it.
      const moved = await app.inject({
        method: 'PUT',
        url: `/api/v1/calendar/events/${created.event?.id}`,
        payload: {
          title: 'Ужин',
          allDay: false,
          date: '2026-01-11',
          startTime: '20:00',
          endTime: '22:00',
          reminder: { leadMinutes: 45, recipients: { everyone: true } },
        },
        headers: memberHeaders(anya),
      })
      expect(moved.statusCode).toBe(200)
      expect((moved.json() as EventDto).reminder).toEqual({
        leadMinutes: 45,
        recipients: { everyone: true },
      })
      const jobs = reminderJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.data.originalDate).toBe('2026-01-11')
      expect(jobs[0]?.startAfter?.toISOString()).toBe('2026-01-11T19:15:00.000Z')
      resetJobLog()

      // The reminder is dropped by the same whole replace that names none.
      const dropped = await app.inject({
        method: 'PUT',
        url: `/api/v1/calendar/events/${created.event?.id}`,
        payload: {
          title: 'Ужин',
          allDay: false,
          date: '2026-01-11',
          startTime: '20:00',
          endTime: '22:00',
        },
        headers: memberHeaders(anya),
      })
      expect(dropped.statusCode).toBe(200)
      expect((dropped.json() as EventDto).reminder).toBeUndefined()
      expect(reminderJobs()).toHaveLength(0)
    })
  })

  test('cancelling an occurrence stops scheduling its reminder; an override moves it', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const created = await createEvent(app, anya, {
        title: 'Йога',
        allDay: false,
        date: '2026-01-05',
        startTime: '08:00',
        endTime: '09:00',
        recurrence: { frequency: 'weekly' },
        reminder: { leadMinutes: 30, recipients: { everyone: true } },
      })
      expect(created.event?.id).toBeDefined()
      resetJobLog()

      // The first occurrence is cancelled: the fresh schedule no longer
      // asks about that date.
      const cancelled = await app.inject({
        method: 'DELETE',
        url: `/api/v1/calendar/events/${created.event?.id}/occurrences/2026-01-05`,
        headers: memberHeaders(anya),
      })
      expect(cancelled.statusCode).toBe(204)
      const afterCancel = reminderJobs()
      expect(afterCancel.length).toBeGreaterThan(0)
      expect(afterCancel.map((job) => job.data.originalDate)).not.toContain('2026-01-05')
      resetJobLog()

      // An override moved to another day carries its reminder there.
      const overridden = await app.inject({
        method: 'PUT',
        url: `/api/v1/calendar/events/${created.event?.id}/occurrences/2026-01-12`,
        payload: {
          title: 'Йога у озера',
          allDay: false,
          date: '2026-01-13',
          startTime: '10:00',
          endTime: '11:00',
        },
        headers: memberHeaders(anya),
      })
      expect(overridden.statusCode).toBe(200)
      // The series' reminder rides the occurrence's answer too.
      expect((overridden.json() as EventDto).reminder).toEqual({
        leadMinutes: 30,
        recipients: { everyone: true },
      })
      const afterOverride = reminderJobs()
      expect(afterOverride.map((job) => job.data.originalDate)).toContain('2026-01-12')
      const movedJob = afterOverride.find((job) => job.data.originalDate === '2026-01-12')
      expect(movedJob?.startAfter?.toISOString()).toBe('2026-01-13T09:30:00.000Z')
    })
  })

  test('an occurrence body cannot set a reminder of its own', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const created = await createEvent(app, anya, {
        title: 'Серия',
        allDay: false,
        date: '2026-01-05',
        startTime: '08:00',
        endTime: '09:00',
        recurrence: { frequency: 'daily' },
      })
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/calendar/events/${created.event?.id}/occurrences/2026-01-06`,
        payload: {
          title: 'Одно занятие',
          allDay: false,
          date: '2026-01-06',
          startTime: '08:00',
          endTime: '09:00',
          reminder: { leadMinutes: 10, recipients: { everyone: true } },
        },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_failed')
    })
  })

  test('an occurrence that has already begun schedules no reminder', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      resetJobLog()
      // The harness clock stands at 2026-01-01; the event started hours
      // ago. A back-filled past event is nobody's reminder.
      const { status } = await createEvent(app, anya, {
        title: 'Вчерашний обед',
        allDay: false,
        date: '2025-12-31',
        startTime: '18:00',
        endTime: '19:00',
        reminder: { leadMinutes: 30, recipients: { everyone: true } },
      })
      expect(status).toBe(201)
      expect(reminderJobs()).toHaveLength(0)
    })
  })

  test('a recurring series schedules its horizon of occurrence jobs', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      resetJobLog()
      const { status } = await createEvent(app, anya, {
        title: 'Зарядка',
        allDay: false,
        date: '2026-01-01',
        startTime: '07:00',
        endTime: '07:30',
        recurrence: { frequency: 'daily' },
        reminder: { leadMinutes: 10, recipients: { everyone: true } },
      })
      expect(status).toBe(201)
      const jobs = reminderJobs()
      // Every day of the 62-day horizon, the first occurrence included —
      // the harness clock stands hours before its reminder.
      expect(jobs).toHaveLength(REMINDER_HORIZON_DAYS)
      expect(jobs.map((job) => job.data.originalDate)).toContain('2026-01-01')
      expect(jobs[0]?.startAfter?.toISOString()).toBe('2026-01-01T06:50:00.000Z')
    })
  })
})

/*
 * The sending handler, run against the recording push sender and the
 * controllable clock. Every case runs the handler twice: the second run is
 * the quiet twin of the first.
 */

const push = recordingPushSender()

afterEach(() => {
  // A failed expectation must not leave its scripted answers poisoning
  // the next test's sends.
  push.respondWith('delivered')
})

/** The harness carries the app deps; the notifications service reads its
 *  own port's name for the key generator. */
function notificationsDeps() {
  return { ...harness, generateKeys: harness.generateVapidKeys }
}

function reminderDeps(clock: FixedClock): CalendarReminderJobsDeps {
  return { db: harness.db, clock, jobs: harness.jobs, push, logger: createSilentLogger() }
}

async function setLanguage(memberId: string, interfaceLanguage: 'ru' | 'en'): Promise<void> {
  const { members } = await import('../members/tables.ts')
  await harness.db.update(members).set({ interfaceLanguage }).where(eq(members.id, memberId))
}

async function giveSubscription(
  member: { id: string; spaceId: string },
  endpoint: string,
  notifyDetails: boolean,
  language?: 'ru' | 'en',
): Promise<void> {
  if (language !== undefined) await setLanguage(member.id, language)
  await subscribe(
    notificationsDeps(),
    { memberId: member.id, spaceId: member.spaceId },
    {
      endpoint,
      p256dh: `p256dh-${endpoint.slice(-6)}`,
      auth: `auth-${endpoint.slice(-6)}`,
      notifyDetails,
    },
  )
}

/** Creates the event through the service, exactly as the route calls it. */
async function createEventWithReminder(
  space: { id: string },
  creator: { id: string },
  body: Record<string, unknown>,
): Promise<EventDto> {
  resetJobLog()
  const { createEvent: create } = await import('./service.ts')
  const result = await create(
    { db: harness.db, clock: harness.clock, jobs: harness.jobs },
    { memberId: creator.id, spaceId: space.id, role: 'owner' },
    body as never,
  )
  return {
    id: result.event.id,
    title: result.event.title,
    allDay: result.event.allDay,
    date: result.event.date ?? undefined,
    reminder: result.reminder,
  } as EventDto
}

async function runHandler(clock: FixedClock, data: CalendarReminderJobData): Promise<void> {
  const deps = reminderDeps(clock)
  await sendDueCalendarReminder(deps, data)
  await sendDueCalendarReminder(deps, data)
}

describe('sendDueCalendarReminder', () => {
  test('delivers to each subscription of each recipient, in their language, neutral by default, with details where the device opted in; the second run sends nothing', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-pad', false, 'ru')
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', true, 'en')

    const event = await createEventWithReminder(space, anya, {
      title: 'Обед с бабушкой',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { memberIds: [boris.id, anya.id] } },
    })

    // The clock stands two minutes past the reminder's moment.
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    push.sends.length = 0
    await runHandler(clock, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })

    expect(push.sends).toHaveLength(3)
    const byEndpoint = new Map(push.sends.map((send) => [send.credentials.endpoint, send.payload]))
    // The opted-in Russian device reads the event and its moment in the
    // event's zone.
    const expectedTag = `reminder:${event.id}:2026-01-10`
    const expectedUrl = `/calendar/${event.id}`
    // The opted-in Russian device reads the event and its moment in the
    // event's zone, the zone named (ADR-0006).
    expect(byEndpoint.get('https://fcm.googleapis.com/fcm/send/anya-phone')).toEqual({
      title: 'Обед с бабушкой',
      body: 'Начало — 10 января в 18:00 UTC',
      tag: expectedTag,
      url: expectedUrl,
    })
    // The opted-out device gets the neutral wording, in its member's
    // language, and no trace of the event — but the same tag and tap.
    expect(byEndpoint.get('https://fcm.googleapis.com/fcm/send/anya-pad')).toEqual({
      title: 'Напоминание о событии',
      body: 'Скоро событие в вашем календаре',
      tag: expectedTag,
      url: expectedUrl,
    })
    // The English device reads its own language.
    expect(byEndpoint.get('https://fcm.googleapis.com/fcm/send/boris-phone')).toEqual({
      title: 'Обед с бабушкой',
      body: 'Starts January 10 at 06:00 PM UTC',
      tag: expectedTag,
      url: expectedUrl,
    })

    // A redelivery past the takeover window — the lease is long gone —
    // answers quiet because of the receipt, not the lease.
    clock.advance(REMINDER_CLAIM_TAKEOVER_MS + 60_000)
    await sendDueCalendarReminder(reminderDeps(clock), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(3)
  })

  test('an occurrence moved behind a live claim retries instead of answering finally', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })

    // A run claimed the 20:00 occurrence and is mid-send — its lease is a
    // minute old, and the reminder is due (19:30) — when the creator moves
    // the event earlier, to 19:50.
    const clock = fixedClock(new Date('2026-01-10T19:31:00.000Z'))
    const liveLease = await harness.db.transaction(async (tx) =>
      repository.claimReminder(
        tx,
        space.id,
        event.id,
        '2026-01-10',
        new Date('2026-01-10T20:00:00.000Z'),
        clock.now(),
      ),
    )
    if (liveLease === undefined) throw new Error('The first claim must win')
    const { editEvent } = await import('./service.ts')
    const movedBody: TimedSeriesBody = {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '19:50',
      endTime: '21:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    }
    await editEvent(
      { db: harness.db, clock, jobs: harness.jobs },
      { memberId: anya.id, spaceId: space.id, role: 'owner' },
      event.id,
      movedBody,
    )

    // The moved occurrence's own job fires (due at 19:20) while the old
    // claim is live: answering "not my turn" would be final, so it throws
    // for the queue.
    const deps = reminderDeps(fixedClock(new Date('2026-01-10T19:32:00.000Z')))
    push.sends.length = 0
    await expect(
      sendDueCalendarReminder(deps, {
        spaceId: space.id,
        eventId: event.id,
        originalDate: '2026-01-10',
      }),
    ).rejects.toThrow(/moved behind a live claim/)
    expect(push.sends).toHaveLength(0)

    // The live claim resolves with its receipt; the retry then delivers
    // the moved occurrence's reminder at its new time.
    await harness.db.transaction(async (tx) => {
      await repository.markReminderSent(
        tx,
        space.id,
        event.id,
        '2026-01-10',
        liveLease,
        clock.now(),
      )
    })
    await sendDueCalendarReminder(deps, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(1)
    expect(push.sends[0]?.payload.body).toContain('19:50')
  })

  test('a partial delivery is final: the receipt stands, no retry re-sends', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', false, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    // Anya's device is reached; Boris's push service hiccups.
    push.respondWith((credentials) =>
      credentials.endpoint.includes('boris') ? 'failed' : 'delivered',
    )

    const deps = reminderDeps(fixedClock(new Date('2026-01-10T17:32:00.000Z')))
    const data = {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    }
    push.sends.length = 0
    await sendDueCalendarReminder(deps, data)
    await sendDueCalendarReminder(deps, data)
    expect(push.sends).toHaveLength(2)
    // The receipt stands — the sent mark, not just the claim — and the
    // duplicate the run-twice delivered answers quiet: Boris's hiccup
    // costs his notification, never Anya a second one.
    const receipted = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(receipted).toHaveLength(1)
    expect(receipted[0]?.sentAt).not.toBeNull()
    push.respondWith('delivered')
  })

  test('a run where every subscription expired writes its receipt', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    push.respondWith('expired')

    const deps = reminderDeps(fixedClock(new Date('2026-01-10T17:32:00.000Z')))
    const data = {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    }
    await sendDueCalendarReminder(deps, data)
    await sendDueCalendarReminder(deps, data)
    // Nothing delivered and nothing failed: the receipt stands.
    const receipted = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(receipted).toHaveLength(1)
    expect(receipted[0]?.sentAt).not.toBeNull()
    // The expired subscription went with the send.
    const remaining = await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, anya.id))
    expect(remaining).toHaveLength(0)
    push.respondWith('delivered')
  })

  test('a reminder already sent stays quiet when a duplicate job fires hours later', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    const data = { spaceId: space.id, eventId: event.id, originalDate: '2026-01-10' }
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    push.sends.length = 0
    await runHandler(clock, data)
    expect(push.sends).toHaveLength(1)

    // The duplicate the design creates on purpose — an edit's reschedule,
    // the sweep's extension — fires long after: the receipt answers it.
    clock.advance(2 * 60 * 60 * 1000)
    await runHandler(clock, data)
    expect(push.sends).toHaveLength(1)
  })

  test('an occurrence moved to a later time earns its own reminder', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    const data = { spaceId: space.id, eventId: event.id, originalDate: '2026-01-10' }
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    push.sends.length = 0
    await runHandler(clock, data)
    expect(push.sends).toHaveLength(1)
    expect(push.sends[0]?.payload.body).toContain('18:00')

    // The creator moves the event to 20:00; the fresh job carries the new
    // reminder — the old receipt answered only for the old start.
    const { editEvent } = await import('./service.ts')
    const movedBody: TimedSeriesBody = {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '20:00',
      endTime: '21:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    }
    await editEvent(
      { db: harness.db, clock, jobs: harness.jobs },
      { memberId: anya.id, spaceId: space.id, role: 'owner' },
      event.id,
      movedBody,
    )
    clock.advance(2 * 60 * 60 * 1000)
    await runHandler(clock, data)
    expect(push.sends).toHaveLength(2)
    expect(push.sends[1]?.payload.body).toContain('20:00')
  })

  test('a not-yet-due reminder sends nothing', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Поздний обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-10T17:00:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)
  })

  test('a reminder stale beyond recall sends nothing', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Давний обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-12T18:00:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)
  })

  test('everyone is read at send time: a member added after the event is in', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Кино',
      allDay: false,
      date: '2026-01-10',
      startTime: '20:00',
      endTime: '22:00',
      reminder: { leadMinutes: 60, recipients: { everyone: true } },
    })
    // Boris and his device arrive after the event was created: the "yes"
    // was never spelled as a list, so he is in without an edit.
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', false, 'ru')

    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-10T19:01:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends.map((send) => send.credentials.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/anya-phone',
      'https://fcm.googleapis.com/fcm/send/boris-phone',
    ])
  })

  test('a hidden calendar section sends nothing', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Тихий обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    const { updateSpace } = await import('../spaces/service.ts')
    await updateSpace({ db: harness.db, clock: harness.clock }, space.id, {
      sections: { journal: true, calendar: false, wishlist: true },
    })

    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-10T17:32:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)
  })

  test('a cancelled occurrence sends nothing; an override answers for its own moment', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Йога',
      allDay: false,
      date: '2026-01-05',
      startTime: '08:00',
      endTime: '09:00',
      recurrence: { frequency: 'weekly' },
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    await cancelOccurrenceOf(space.id, anya.id, event.id, '2026-01-12')
    await overrideOccurrence(space.id, anya.id, event.id, '2026-01-19', {
      title: 'Йога у озера',
      allDay: false,
      date: '2026-01-20',
      startTime: '10:00',
      endTime: '11:00',
    })

    push.sends.length = 0
    // The cancelled occurrence: quiet.
    await runHandler(fixedClock(new Date('2026-01-12T07:32:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-12',
    })
    expect(push.sends).toHaveLength(0)
    // The override: its reminder follows the replacement's moment and
    // carries the override's title.
    await runHandler(fixedClock(new Date('2026-01-20T09:32:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-19',
    })
    expect(push.sends).toHaveLength(1)
    expect(push.sends[0]?.payload).toEqual({
      title: 'Йога у озера',
      body: 'Начало — 20 января в 10:00 UTC',
      tag: `reminder:${event.id}:2026-01-19`,
      url: `/calendar/${event.id}`,
    })
  })

  test('an all-day occurrence reminds at the morning anchor minus the lead, with the date as its detail', async () => {
    const space = await harness.createSpace({ timezone: 'Europe/Moscow' })
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'День рождения бабушки',
      allDay: true,
      date: '2026-03-01',
      reminder: { leadMinutes: 120, recipients: { everyone: true } },
    })
    push.sends.length = 0
    // 09:00 MSK is 06:00 UTC; the lead puts the reminder at 04:00 UTC.
    await runHandler(fixedClock(new Date('2026-03-01T04:01:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-03-01',
    })
    expect(push.sends).toHaveLength(1)
    expect(push.sends[0]?.payload).toEqual({
      title: 'День рождения бабушки',
      body: 'Начало — 1 марта',
      tag: `reminder:${event.id}:2026-03-01`,
      url: `/calendar/${event.id}`,
    })
  })

  test('a subscription the push service rejected as expired is removed', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-pad', false, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    // The phone's endpoint is gone; the pad's is fine.
    push.respondWith((credentials) =>
      credentials.endpoint === 'https://fcm.googleapis.com/fcm/send/anya-phone'
        ? 'expired'
        : 'delivered',
    )

    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-10T17:32:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(2)
    const remaining = await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, anya.id))
    expect(remaining.map((row) => row.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/anya-pad',
    ])
    push.respondWith('delivered')
  })

  test("a crashed sender's stale claim is taken over; a live one is not", async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Ужин',
      allDay: false,
      date: '2026-01-10',
      startTime: '19:00',
      endTime: '21:00',
      reminder: { leadMinutes: 15, recipients: { everyone: true } },
    })
    const clock = fixedClock(new Date('2026-01-10T18:46:00.000Z'))
    const deps = reminderDeps(clock)

    // A sender claimed the occurrence and died before sending; its lease
    // is what it was handed at claim time.
    const staleLease = await harness.db.transaction(async (tx) =>
      repository.claimReminder(
        tx,
        space.id,
        event.id,
        '2026-01-10',
        new Date('2026-01-10T19:00:00.000Z'),
        clock.now(),
      ),
    )
    if (staleLease === undefined) throw new Error('The first claim must win')
    push.sends.length = 0
    await sendDueCalendarReminder(deps, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)

    // Six minutes later the claim is stale: the reminder still goes out
    // rather than dying with the crashed process.
    clock.advance(6 * 60 * 1000)
    await sendDueCalendarReminder(deps, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(1)

    // The stalled sender wakes up and finishes its bookkeeping: its lease
    // no longer owns the claim, so neither its receipt nor its release
    // can undo the successor's.
    const claim = await repository.getReminderClaim(harness.db, space.id, event.id, '2026-01-10')
    expect(claim?.sentAt).not.toBeNull()
    await harness.db.transaction(async (tx) => {
      await repository.markReminderSent(
        tx,
        space.id,
        event.id,
        '2026-01-10',
        staleLease,
        clock.now(),
      )
    })
    await harness.db.transaction(async (tx) => {
      await repository.releaseReminderClaim(tx, space.id, event.id, '2026-01-10', staleLease)
    })
    const after = await repository.getReminderClaim(harness.db, space.id, event.id, '2026-01-10')
    expect(after?.sentAt).not.toBeNull()
  })

  test('sweep rounds missed for days fill exactly the gap they left', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await createEventWithReminder(space, anya, {
      title: 'Зарядка',
      allDay: false,
      date: '2026-01-01',
      startTime: '07:00',
      endTime: '07:30',
      recurrence: { frequency: 'daily' },
      reminder: { leadMinutes: 10, recipients: { everyone: true } },
    })
    const deps = reminderDeps(fixedClock(new Date('2026-02-01T00:00:00.000Z')))
    resetJobLog()
    await extendReminderHorizons(deps)
    const firstRound = reminderJobs().filter((job) => job.data.spaceId === space.id)
    expect(firstRound.length).toBeGreaterThanOrEqual(1)

    // The worker disappears for five days: the next round fills the five
    // days the missed rounds would have covered, every occurrence of the
    // horizon holding a job.
    resetJobLog()
    const laterDeps = reminderDeps(fixedClock(new Date('2026-02-06T00:00:00.000Z')))
    await extendReminderHorizons(laterDeps)
    await extendReminderHorizons(laterDeps)
    const gapRound = reminderJobs().filter((job) => job.data.spaceId === space.id)
    const gapDays = new Set(gapRound.map((job) => job.data.originalDate))
    // The old horizon ended 2026-04-04; the new one ends 2026-04-09 — the
    // gap is 2026-04-04 through 2026-04-08, and nothing else.
    expect(gapDays).toEqual(
      new Set(['2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07', '2026-04-08']),
    )
  })

  test('a reminder that reached no device releases its claim for the retry', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    const data = { spaceId: space.id, eventId: event.id, originalDate: '2026-01-10' }
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    const deps = reminderDeps(clock)

    // Every send fails transiently: the run answers loudly, the claim row
    // goes, and the queue's retry sends from scratch.
    push.respondWith('failed')
    await expect(sendDueCalendarReminder(deps, data)).rejects.toThrow(/reached no device/)
    const claims = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(claims).toHaveLength(0)

    // The retry, with the push service healthy again: one delivery, and
    // the receipt stands.
    push.respondWith('delivered')
    push.sends.length = 0
    await sendDueCalendarReminder(deps, data)
    expect(push.sends).toHaveLength(1)
    const receipted = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(receipted).toHaveLength(1)
    push.respondWith('delivered')
  })

  test("a forward clock jump's watermark is reset to the real horizon", async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const event = await createEventWithReminder(space, anya, {
      title: 'Зарядка',
      allDay: false,
      date: '2026-01-01',
      startTime: '07:00',
      endTime: '07:30',
      recurrence: { frequency: 'daily' },
      reminder: { leadMinutes: 10, recipients: { everyone: true } },
    })
    // A sweep once ran with the clock a year ahead.
    const { calendarEventReminders } = await import('./tables.ts')
    await harness.db
      .update(calendarEventReminders)
      .set({ scheduledThrough: new Date('2027-06-01T00:00:00.000Z') })
      .where(eq(calendarEventReminders.eventId, event.id))

    resetJobLog()
    const deps = reminderDeps(fixedClock(new Date('2026-02-01T00:00:00.000Z')))
    await extendReminderHorizons(deps)
    const poisoned = reminderJobs().filter((job) => job.data.spaceId === space.id)
    // The guard treats the impossible watermark as unset: the whole
    // horizon is re-queued (the claim keeps one send).
    expect(poisoned).toHaveLength(REMINDER_HORIZON_DAYS)

    // The reset reached the database: the next round adds nothing, and
    // the row reads the real horizon.
    resetJobLog()
    await extendReminderHorizons(deps)
    expect(reminderJobs().filter((job) => job.data.spaceId === space.id)).toHaveLength(0)
    const rows = await harness.db
      .select()
      .from(calendarEventReminders)
      .where(eq(calendarEventReminders.eventId, event.id))
    expect(rows[0]?.scheduledThrough?.toISOString()).toBe('2026-04-04T00:00:00.000Z')
  })

  test('a deleted event and a dropped reminder answer quietly', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', true, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Прошлое событие',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    const { removeEvent } = await import('./service.ts')
    await removeEvent(
      { db: harness.db, clock: harness.clock, jobs: harness.jobs },
      { memberId: anya.id, spaceId: space.id, role: 'owner' },
      event.id,
    )

    push.sends.length = 0
    await runHandler(fixedClock(new Date('2026-01-10T17:32:00.000Z')), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)
  })
})

describe("the reminder queue's retry schedule", () => {
  test("its retries outlast the claim's takeover window, and land soon enough for short leads", async () => {
    const setup = CALENDAR_QUEUE_SETUPS.find((queue) => queue.name === CALENDAR_REMINDER_JOB)
    const options = setup?.options
    expect(options).toBeDefined()
    const { retryLimit, retryDelay } = options as { retryLimit: number; retryDelay: number }
    // The arithmetic below holds only with the backoff on and no cap.
    expect(options).toMatchObject({ retryBackoff: true })
    expect((options as { retryDelayMax?: number }).retryDelayMax).toBeUndefined()
    // The first retry lands within half a minute: a one-minute lead's
    // reminder is still ahead of its occurrence.
    expect(retryDelay * 2).toBeLessThanOrEqual(30)
    // The minimum cumulative wait (pg-boss's backoff never goes below
    // delay * 2^n) outlasts the takeover window: the last retry's sender
    // cannot race a successor it has already outlived.
    const minimumWaitMs = Array.from({ length: retryLimit }, (_, n) => retryDelay * 2 ** n).reduce(
      (sum, wait) => sum + wait,
      0,
    )
    expect(minimumWaitMs).toBeGreaterThan(REMINDER_CLAIM_TAKEOVER_MS / 1000)
    // The api ensures the reminder queue with these very options: a fresh
    // installation's first schedules cannot fall back to the defaults.
    expect(CALENDAR_SENT_QUEUE_SETUPS).toContainEqual(setup)
  })
})

describe("the delivery run's failure ordering", () => {
  test('a cleanup failure after the receipt costs the removal, not the reminder', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', false, 'ru')
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', false, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    // Anya's endpoint is expired; the cleanup's transaction is the third
    // the run opens (claim, receipt, removal) and it fails on demand.
    push.respondWith((credentials) =>
      credentials.endpoint.includes('anya') ? 'expired' : 'delivered',
    )
    const failing = dbFailingOnNthTransaction(harness.db, 3)
    const deps = { ...reminderDeps(fixedClock(new Date('2026-01-10T17:32:00.000Z'))), db: failing }

    // The run resolves: the receipt is already written, the cleanup's
    // failure is the logged loss, not the job's.
    await expect(
      sendDueCalendarReminder(deps, {
        spaceId: space.id,
        eventId: event.id,
        originalDate: '2026-01-10',
      }),
    ).resolves.toBeUndefined()
    const receipted = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(receipted).toHaveLength(1)
    expect(receipted[0]?.sentAt).not.toBeNull()
    // A cleanup that failed costs the removal: the row stays until the
    // next send to it retires it.
    const remaining = await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, anya.id))
    expect(remaining).toHaveLength(1)
    push.respondWith('delivered')
  })

  test('a total failure releases its claim before a failing cleanup', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', false, 'ru')
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', false, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    // Anya's endpoint is expired, Boris's push service hiccups, and the
    // claim release is transaction 2 — the cleanup's would-be transaction
    // is 3 and fails on demand.
    push.respondWith((credentials) =>
      credentials.endpoint.includes('anya') ? 'expired' : 'failed',
    )
    const failing = dbFailingOnNthTransaction(harness.db, 3)
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    const deps = { ...reminderDeps(clock), db: failing }
    await expect(
      sendDueCalendarReminder(deps, {
        spaceId: space.id,
        eventId: event.id,
        originalDate: '2026-01-10',
      }),
    ).rejects.toThrow(/reached no device/)

    // The release landed before the failing cleanup could matter: the
    // claim is gone, so the retry that comes within the takeover window
    // sends from scratch instead of meeting a live claim.
    const claims = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(claims).toHaveLength(0)
    // Both rows stand: the cleanup is the failing transaction here, and
    // best-effort means its failure costs the removal, never the release.
    const rows = await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, anya.id))
    expect(rows).toHaveLength(1)
    const borisRows = await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, boris.id))
    expect(borisRows).toHaveLength(1)

    // The retry — inside the takeover window — delivers. Both rows stand
    // (the cleanup failed best-effort), so both devices are reached now.
    push.respondWith('delivered')
    push.sends.length = 0
    await sendDueCalendarReminder(reminderDeps(clock), {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(2)
  })

  test('a receipt whose cleanup failed still keeps the duplicate quiet', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const boris = await harness.createMember(space.id, { name: 'Борис' })
    await giveSubscription(anya, 'https://fcm.googleapis.com/fcm/send/anya-phone', false, 'ru')
    await giveSubscription(boris, 'https://fcm.googleapis.com/fcm/send/boris-phone', false, 'ru')
    const event = await createEventWithReminder(space, anya, {
      title: 'Обед',
      allDay: false,
      date: '2026-01-10',
      startTime: '18:00',
      endTime: '19:00',
      reminder: { leadMinutes: 30, recipients: { everyone: true } },
    })
    push.respondWith((credentials) =>
      credentials.endpoint.includes('anya') ? 'expired' : 'delivered',
    )
    const clock = fixedClock(new Date('2026-01-10T17:32:00.000Z'))
    const failing = dbFailingOnNthTransaction(harness.db, 3)
    const deps = { ...reminderDeps(clock), db: failing }
    await sendDueCalendarReminder(deps, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })

    // The same job, redelivered past the takeover window — the lease is
    // long gone, so the receipt is what answers before any send. Even one
    // for a row the failed cleanup left behind: her subscription retires
    // at the next occurrence's reminder instead.
    clock.advance(REMINDER_CLAIM_TAKEOVER_MS + 60_000)
    push.sends.length = 0
    push.respondWith((credentials) =>
      credentials.endpoint.includes('anya') ? 'expired' : 'delivered',
    )
    await sendDueCalendarReminder(deps, {
      spaceId: space.id,
      eventId: event.id,
      originalDate: '2026-01-10',
    })
    expect(push.sends).toHaveLength(0)
    push.respondWith('delivered')
  })
})

describe("the sweep's failures ride the aggregate", () => {
  test("a failing claims prune does not mask the spaces' failures", async () => {
    // Every transaction from the sweep's second one fails: whichever
    // spaces the shared database holds, the first space's work passes and
    // the prune always fails — its entry rides the aggregate beside them.
    const deps = {
      ...reminderDeps(fixedClock(new Date('2026-02-01T00:00:00.000Z'))),
      db: dbFailingOnNthTransaction(harness.db, 2, 'from'),
    }
    resetJobLog()
    // Whichever spaces the shared database holds, and in whichever order
    // they are visited, the prune's own entry rides the aggregate beside
    // theirs: the assertion is order-independent because the prune always
    // runs — and always fails here — after the first space's work.
    await expect(extendReminderHorizons(deps as never)).rejects.toThrow(/claim prune/)
  })
})

describe('reminder claim lease (repository)', () => {
  test("a stalled lease marks nothing on a successor's live claim", async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const event = await createEventWithReminder(space, anya, {
      title: 'Ужин',
      allDay: false,
      date: '2026-01-10',
      startTime: '19:00',
      endTime: '21:00',
      reminder: { leadMinutes: 15, recipients: { everyone: true } },
    })
    const start = new Date('2026-01-10T19:00:00.000Z')
    const clock = fixedClock(new Date('2026-01-10T18:46:00.000Z'))

    // Lease A claims; six minutes later lease B takes the unsent claim
    // over, exactly as a crashed sender's successor would.
    const leaseA = await harness.db.transaction(async (tx) =>
      repository.claimReminder(tx, space.id, event.id, '2026-01-10', start, clock.now()),
    )
    if (leaseA === undefined) throw new Error('The first claim must win')
    clock.advance(6 * 60 * 1000)
    const leaseB = await harness.db.transaction(async (tx) =>
      repository.claimReminder(tx, space.id, event.id, '2026-01-10', start, clock.now()),
    )
    if (leaseB === undefined) throw new Error('The takeover must win')

    // A wakes up mid-send and reports success: B's claim stays live.
    await harness.db.transaction(async (tx) => {
      await repository.markReminderSent(tx, space.id, event.id, '2026-01-10', leaseA, clock.now())
    })
    const live = await repository.getReminderClaim(harness.db, space.id, event.id, '2026-01-10')
    expect(live?.sentAt).toBeNull()
    expect(live?.startAt).toEqual(start)

    // A then reports total failure and lets go: B's claim stands.
    await harness.db.transaction(async (tx) => {
      await repository.releaseReminderClaim(tx, space.id, event.id, '2026-01-10', leaseA)
    })
    const held = await repository.getReminderClaim(harness.db, space.id, event.id, '2026-01-10')
    expect(held?.sentAt).toBeNull()
    expect(held?.startAt).toEqual(start)

    // B finishes: its own receipt lands.
    await harness.db.transaction(async (tx) => {
      await repository.markReminderSent(tx, space.id, event.id, '2026-01-10', leaseB, clock.now())
    })
    const receipted = await repository.getReminderClaim(
      harness.db,
      space.id,
      event.id,
      '2026-01-10',
    )
    expect(receipted?.sentAt).not.toBeNull()
  })
})

describe('extendReminderHorizons', () => {
  test("extends a series' horizon with fresh jobs and prunes old claims; run twice, the schedule is idempotent in effect", async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const event = await createEventWithReminder(space, anya, {
      title: 'Зарядка',
      allDay: false,
      date: '2026-01-01',
      startTime: '07:00',
      endTime: '07:30',
      recurrence: { frequency: 'daily' },
      reminder: { leadMinutes: 10, recipients: { everyone: true } },
    })
    resetJobLog()
    const clock = fixedClock(new Date('2026-02-01T00:00:00.000Z'))
    const deps = reminderDeps(clock)
    await extendReminderHorizons(deps)
    await extendReminderHorizons(deps)

    // The sweep walks every space that holds a reminder; this space's
    // share adds only what newly entered the horizon — the fresh two days
    // at its far edge, not the whole span again.
    const jobs = reminderJobs().filter((job) => job.data.spaceId === space.id)
    // The create scheduled through 2026-03-04; the sweep extends to
    // 2026-04-04 — exactly the days since, every one of them.
    expect(jobs).toHaveLength(31)
    const farthest = jobs.reduce(
      (latest, job) => (job.startAfter && job.startAfter > latest ? job.startAfter : latest),
      new Date(0),
    )
    expect(farthest.toISOString()).toBe('2026-04-03T06:50:00.000Z')

    // The prune: a claim older than the retention is gone, a fresh one
    // stays.
    await harness.db.transaction(async (tx) => {
      const { claimReminder } = await import('./repository.ts')
      await claimReminder(
        tx,
        space.id,
        event.id,
        '2026-01-01',
        new Date('2026-01-01T07:00:00.000Z'),
        clock.now(),
      )
    })
    await harness.db.transaction(async (tx) => {
      const old = await tx
        .update(calendarRemindersSent)
        .set({ remindedAt: new Date('2025-11-01T00:00:00.000Z') })
        .where(eq(calendarRemindersSent.eventId, event.id))
        .returning()
      expect(old.length).toBeGreaterThan(0)
    })
    await extendReminderHorizons(deps)
    const claims = await harness.db
      .select()
      .from(calendarRemindersSent)
      .where(eq(calendarRemindersSent.eventId, event.id))
    expect(claims).toHaveLength(0)
  })
})

async function cancelOccurrenceOf(
  spaceId: string,
  memberId: string,
  eventId: string,
  originalDate: string,
): Promise<void> {
  const { cancelOccurrence } = await import('./service.ts')
  await cancelOccurrence(
    { db: harness.db, clock: harness.clock, jobs: harness.jobs },
    { memberId, spaceId, role: 'owner' },
    eventId,
    originalDate,
  )
}

async function overrideOccurrence(
  spaceId: string,
  memberId: string,
  eventId: string,
  originalDate: string,
  body: Record<string, unknown>,
): Promise<void> {
  const { editOccurrence } = await import('./service.ts')
  await editOccurrence(
    { db: harness.db, clock: harness.clock, jobs: harness.jobs },
    { memberId, spaceId, role: 'owner' },
    eventId,
    originalDate,
    body as never,
  )
}
