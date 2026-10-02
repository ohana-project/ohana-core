import { createI18n, type Locale } from '@ohana/i18n'
import { type Clock, systemClock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import type { JobSender } from '../../platform/jobs/index.ts'
import type { Logger } from '../../platform/logging.ts'
import type { PushPayload, PushSender } from '../../platform/push/index.ts'
import { listMembers, type Member } from '../members/index.ts'
import {
  listActiveSubscriptionsInTx,
  removeExpiredSubscriptionInTx,
} from '../notifications/index.ts'
import { getSpace, type Space, sectionVisibility } from '../spaces/index.ts'
import {
  REMINDER_HORIZON_DAYS,
  REMINDER_STALE_LIMIT_MS,
  reminderInstantFor,
  reminderJobsBetween,
} from './reminders.ts'
import {
  claimReminder,
  deleteReminderClaimsBefore,
  getEventInSpace,
  getReminderForEvent,
  listExceptionsForEvent,
  listReminderEventsInSpace,
  listSpacesWithReminderEventsAcrossSpaces,
} from './repository.ts'
import type { CalendarEvent, CalendarEventException, CalendarEventReminder } from './tables.ts'

/*
 * The calendar's worker handlers (issue #22, ADR-0009): the Web Push
 * delivery of the events' reminders. The per-occurrence job the event's
 * use cases schedule inside their own transactions is the prompt path; the
 * recurring sweep extends a recurring event's horizon and prunes the
 * send-once bookkeeping. Both check current state before acting —
 * delivery is at-least-once, and both are safe to repeat: the sending
 * handler claims its occurrence first (a claim a crashed sender left
 * stale is taken over), and the sweep only sends jobs whose handlers
 * answer for the event as it stands.
 *
 * The text is composed here, in the recipient's stored language (ADR-0006)
 * — neutral by default, with the event's title and time only where the
 * device opted in.
 */

/** The queue name of the per-occurrence reminder job. */
export const CALENDAR_REMINDER_JOB = 'calendar-reminder'

/** The queue name of the horizon-extending sweep. */
export const CALENDAR_REMINDER_SWEEP_JOB = 'calendar-reminder-sweep'

/** The sweep runs daily at 03:00 UTC; a 62-day horizon never runs out
 *  between two of its rounds, and its prune keeps the claims bounded. */
export const CALENDAR_REMINDER_SWEEP_CRON = '0 3 * * *'

/** How long the send-once claims outlive any job that could ask about
 *  them: the claims die with their event; the sweep prunes what is merely
 *  old. Far beyond the stale limit a redelivered job can still meet. */
const REMINDER_CLAIM_RETENTION_MS = 35 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** The retries a reminder job may spend on transient failures: a claim
 *  stands across them, so a retry can only re-run the state checks. */
export const CALENDAR_QUEUE_SETUPS = [
  {
    name: CALENDAR_REMINDER_JOB,
    options: { retryLimit: 3, retryDelay: 300, retryBackoff: true },
  },
  { name: CALENDAR_REMINDER_SWEEP_JOB },
] as const

/** The queues the api process must ensure before its first reminder
 *  schedule (architecture.md, "Background jobs"). */
export const CALENDAR_SENT_QUEUES = [CALENDAR_REMINDER_JOB] as const

export interface CalendarReminderJobData {
  spaceId: string
  eventId: string
  /** The occurrence the reminder belongs to, by its original date. */
  originalDate: string
}

export interface CalendarReminderJobsDeps {
  db: Db
  clock: Clock
  /** The jobs port: the sweep schedules the horizon's jobs through it. */
  jobs: JobSender
  /** The push port: the recording implementation in tests, Web Push in
   *  production (architecture.md, "Push"). */
  push: PushSender
  logger: Logger
}

/**
 * Sends one occurrence's reminder, if it is still due: the event exists,
 * the calendar section is visible, the reminder stands, the occurrence
 * still stands (an override moved it, a cancellation removed it), the
 * reminder's moment has arrived and is not stale beyond recall, and no
 * other run has claimed it. Each recipient's devices get the notification
 * in the recipient's language; a subscription the push service rejects as
 * expired is removed.
 */
export async function sendDueCalendarReminder(
  deps: CalendarReminderJobsDeps,
  data: CalendarReminderJobData,
): Promise<void> {
  const now = deps.clock.now()
  const event = await getEventInSpace(deps.db, data.spaceId, data.eventId)
  // The event is gone: a pending job from an earlier schedule answers
  // quietly — the second of two runs answers the same way.
  if (event === undefined) return
  // Nothing leaves a hidden calendar section (the acceptance criteria);
  // the visibility is read at send time, like every other state here.
  const space = await spaceForReminder(deps, data.spaceId)
  if (space === undefined) return
  if (!sectionVisibility(space).calendar) return
  const stored = await getReminderForEvent(deps.db, data.spaceId, data.eventId)
  if (stored === undefined) return
  const exceptions = await listExceptionsForEvent(deps.db, data.spaceId, data.eventId)
  const exception = exceptions.find((candidate) => candidate.originalDate === data.originalDate)
  const start = reminderInstantFor(event, exception, data.originalDate, space.timezone)
  if (start === undefined) return
  const remindAt = start.getTime() - stored.reminder.leadMinutes * 60_000
  // Not due yet: the edit that moved the occurrence later has scheduled
  // this occurrence's reminder anew.
  if (remindAt > now.getTime()) return
  // Stale beyond recall: the worker was down too long, and a day-late
  // "soon" is noise (ADR-0006: exact display time is not guaranteed).
  if (now.getTime() - remindAt > REMINDER_STALE_LIMIT_MS) return

  // The claim is the "one reminder per occurrence" guarantee: concurrent
  // or redelivered runs of this handler agree on one winner, and a claim
  // left stale by a crashed sender is taken over rather than mourned.
  let claimed = false
  await deps.db.transaction(async (tx) => {
    claimed = await claimReminder(tx, data.spaceId, data.eventId, data.originalDate, now)
  })
  if (!claimed) return

  const recipients = await resolveReminderRecipients(deps.db, data.spaceId, stored)
  let delivered = 0
  let failed = 0
  for (const recipient of recipients) {
    const subscriptions = await listActiveSubscriptionsInTx(deps.db, data.spaceId, recipient.id)
    for (const subscription of subscriptions) {
      const payload = reminderPayload({
        locale: interfaceLocale(recipient),
        details: subscription.notifyDetails,
        title: occurrenceTitle(event, exception),
        start,
        allDay: occurrenceIsAllDay(event, exception),
        timezone: occurrenceTimezone(event, exception, space.timezone),
      })
      const result = await deps.push.send(
        { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        payload,
      )
      if (result === 'delivered') {
        delivered += 1
      } else if (result === 'failed') {
        failed += 1
      } else {
        // The push service said the subscription is gone: the row goes too
        // (the acceptance criteria), wherever in the installation it sat.
        await deps.db.transaction(async (tx) => {
          await removeExpiredSubscriptionInTx(tx, subscription.endpoint)
        })
      }
    }
  }
  deps.logger.info(
    {
      spaceId: data.spaceId,
      eventId: data.eventId,
      originalDate: data.originalDate,
      recipients: recipients.length,
      delivered,
      failed,
    },
    'Calendar reminder dispatched',
  )
}

/** The space the reminder answers to, or undefined when it is gone — a
 *  pending job from before a space's removal answers quietly. */
function spaceForReminder(
  deps: CalendarReminderJobsDeps,
  spaceId: string,
): Promise<Space | undefined> {
  return getSpace({ db: deps.db, clock: deps.clock }, spaceId).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'space_not_found') return undefined
    throw error
  })
}

/**
 * The recipients at send time (the acceptance criteria): "everyone" is the
 * space's membership as it stands now — a member added after the event is
 * in, one the space has since lost is out. A named list keeps only the
 * members that still exist. (When member archiving lands — issue #23 —
 * this read is the one place its exclusion hangs from.)
 */
async function resolveReminderRecipients(
  db: Db,
  spaceId: string,
  stored: { reminder: CalendarEventReminder; memberIds: string[] },
): Promise<Member[]> {
  const members = await listMembers({ db, clock: systemClock }, spaceId)
  if (stored.reminder.everyone) return members
  const named = new Set(stored.memberIds)
  return members.filter((member) => named.has(member.id))
}

/** The recipient's stored language (ADR-0006); the unset one falls back to
 *  the app's default. */
function interfaceLocale(member: Member): Locale {
  return member.interfaceLanguage ?? 'ru'
}

/**
 * The notification's text (ADR-0006): the title is the event's name where
 * the device opted in to details and a neutral banner where it did not;
 * the body carries the moment in the event's own zone for the opted-in
 * device, and only the neutral wording otherwise.
 */
export function reminderPayload(input: {
  locale: Locale
  details: boolean
  title: string
  start: Date
  allDay: boolean
  timezone: string
}): PushPayload {
  const i18n = createI18n({ locale: input.locale })
  if (!input.details) {
    return {
      title: i18n.t('notifications.push.neutralTitle'),
      body: i18n.t('notifications.push.neutralBody'),
    }
  }
  const formatted = input.allDay
    ? // The all-day kind keeps its calendar date: the space's zone reads
      // it, not the sending machine's.
      new Intl.DateTimeFormat(input.locale, {
        timeZone: input.timezone,
        day: 'numeric',
        month: 'long',
      }).format(input.start)
    : new Intl.DateTimeFormat(input.locale, {
        timeZone: input.timezone,
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(input.start)
  return {
    title: input.title,
    body: i18n.t('notifications.push.detailsBody', { time: formatted }),
  }
}

/** The occurrence's own title: an override replaces it whole. */
function occurrenceTitle(
  event: CalendarEvent,
  exception: CalendarEventException | undefined,
): string {
  return exception?.kind === 'override' ? (exception.title ?? event.title) : event.title
}

/** The occurrence's own kind, the same way. */
function occurrenceIsAllDay(
  event: CalendarEvent,
  exception: CalendarEventException | undefined,
): boolean {
  if (exception?.kind === 'override') return exception.allDay === true
  return event.allDay
}

/** The zone a timed occurrence formats in: the override's, the event's,
 *  or the space's for the all-day kinds that keep none. */
function occurrenceTimezone(
  event: CalendarEvent,
  exception: CalendarEventException | undefined,
  spaceTimezone: string,
): string {
  if (exception?.kind === 'override') return exception.timezone ?? spaceTimezone
  return event.timezone ?? spaceTimezone
}

/**
 * The horizon extension (the sweep): every space that holds a reminder
 * gets its events' upcoming occurrences scheduled again — duplicate jobs
 * are harmless by design, the claim keeps one send — and the claims that
 * outlived every job that could ask are pruned. One transaction per
 * space; one space's failure does not stop the others.
 */
export async function extendReminderHorizons(deps: CalendarReminderJobsDeps): Promise<void> {
  const now = deps.clock.now()
  const spaceIds = await listSpacesWithReminderEventsAcrossSpaces(deps.db)
  const failures: Array<{ spaceId: string; cause: unknown }> = []
  for (const spaceId of spaceIds) {
    try {
      await deps.db.transaction(async (tx) => {
        const space = await spaceForReminder(deps, spaceId)
        if (space === undefined) return
        const events = await listReminderEventsInSpace(tx, spaceId)
        const from = new Date(now.getTime() - REMINDER_STALE_LIMIT_MS)
        const to = new Date(now.getTime() + REMINDER_HORIZON_DAYS * DAY_MS)
        for (const event of events) {
          const stored = await getReminderForEvent(tx, spaceId, event.id)
          if (stored === undefined) continue
          const exceptions = await listExceptionsForEvent(tx, spaceId, event.id)
          for (const job of reminderJobsBetween(
            event,
            exceptions,
            stored.reminder,
            space.timezone,
            from,
            to,
          )) {
            await deps.jobs.sendInTx(tx, {
              name: CALENDAR_REMINDER_JOB,
              data: {
                spaceId,
                eventId: event.id,
                originalDate: job.originalDate,
              } satisfies CalendarReminderJobData,
              startAfter: job.sendAt,
            })
          }
        }
        await deleteReminderClaimsBefore(tx, new Date(now.getTime() - REMINDER_CLAIM_RETENTION_MS))
      })
    } catch (cause) {
      failures.push({ spaceId, cause })
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.cause),
      `Extending reminder horizons failed for ${failures.length} space(s): ${failures.map((f) => f.spaceId).join(', ')}`,
    )
  }
}
