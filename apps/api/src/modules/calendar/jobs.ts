import { createI18n, type Locale } from '@ohana/i18n'
import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import type { JobSender, QueueSetup } from '../../platform/jobs/index.ts'
import type { Logger } from '../../platform/logging.ts'
import {
  endpointHost,
  type PushPayload,
  type PushSender,
  pushLogError,
} from '../../platform/push/index.ts'
import { listMembers, type Member } from '../members/index.ts'
import {
  listSubscriptionsForMember,
  removeSubscriptionsByEndpointAcrossSpaces,
} from '../notifications/index.ts'
import {
  getSpace,
  getSpaceInTx,
  lockSpace,
  type Space,
  sectionVisibility,
} from '../spaces/index.ts'
import {
  REMINDER_HORIZON_DAYS,
  REMINDER_STALE_LIMIT_MS,
  reminderInstantFor,
  reminderJobsBetween,
} from './reminders.ts'
import {
  advanceReminderWatermark,
  claimReminder,
  deleteReminderClaimsBefore,
  getEventInSpace,
  getReminderClaim,
  getReminderForEvent,
  listExceptionsForEvent,
  listReminderEventsInSpace,
  listSpacesWithReminderEventsAcrossSpaces,
  markReminderSent,
  releaseReminderClaim,
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

/** The retries a reminder job may spend: a run that reached no device
 *  releases its claim and throws, so a retry sends from scratch; a run
 *  that reached someone holds the receipt, and a retry only re-runs the
 *  state checks. A partial delivery is final — the reached devices keep
 *  their reminder, the unreached ones wait for the next occurrence — the
 *  alternative would be duplicate sends to the reached devices, which
 *  "one reminder per occurrence" forbids. */
export const CALENDAR_QUEUE_SETUPS = [
  {
    name: CALENDAR_REMINDER_JOB,
    // The first retry lands 15–30 s out (pg-boss backs off at
    // delay * 2^(n-1) * (1 + random())), and the five retries wait at
    // least 465 s in sum — past the claim's takeover window, and soon
    // enough to matter for the shortest leads.
    options: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
  },
  { name: CALENDAR_REMINDER_SWEEP_JOB },
] as const

/** The queues the api process must ensure before its first reminder
 *  schedule, with the options their jobs need: pg-boss copies a queue's
 *  retry settings into every job at send time, so a fresh installation's
 *  first schedules — sent before the worker ever ran — must not fall back
 *  to the defaults (architecture.md, "Background jobs"). */
export const CALENDAR_SENT_QUEUE_SETUPS: QueueSetup[] = CALENDAR_QUEUE_SETUPS.filter(
  (setup) => setup.name === CALENDAR_REMINDER_JOB,
)

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
  // An occurrence that has already begun is nobody's reminder: a
  // back-filled past event, a morning the worker slept through.
  if (start.getTime() <= now.getTime()) return
  const remindAt = start.getTime() - stored.reminder.leadMinutes * 60_000
  // Not due yet: the edit that moved the occurrence later has scheduled
  // this occurrence's reminder anew.
  if (remindAt > now.getTime()) return
  // Stale beyond recall: the worker was down too long, and a day-late
  // "soon" is noise (ADR-0006: exact display time is not guaranteed).
  if (now.getTime() - remindAt > REMINDER_STALE_LIMIT_MS) return

  // The claim is the "one reminder per occurrence" guarantee, keyed by
  // the start it computed: concurrent or redelivered runs agree on one
  // winner, a crashed sender's lease is taken over, and a receipt for the
  // same start never sends twice — while a start the creator has since
  // moved the occurrence to earns its own reminder.
  const lease = await deps.db.transaction(async (tx) =>
    claimReminder(tx, data.spaceId, data.eventId, data.originalDate, start, now),
  )
  if (lease === undefined) {
    // A live claim for a *different* start: the occurrence was moved while
    // another run's send is in flight, and this job's answer ("not my
    // turn") would otherwise be final. Throwing puts it back in the queue,
    // behind that claim's receipt or release.
    const live = await getReminderClaim(deps.db, data.spaceId, data.eventId, data.originalDate)
    if (live !== undefined && live.sentAt === null && live.startAt.getTime() !== start.getTime()) {
      throw new Error(
        `Calendar reminder ${data.eventId}/${data.originalDate} moved behind a live claim; the queue retries`,
      )
    }
    return
  }

  const recipients = await resolveReminderRecipients(deps, data.spaceId, stored)
  const subscriptions = await Promise.all(
    recipients.map(async (recipient) => ({
      recipient,
      rows: await listSubscriptionsForMember(deps.db, data.spaceId, recipient.id),
    })),
  )
  // The sends go out together: a run takes about one send's timeout, so a
  // crowded recipient list cannot outlive the claim's takeover window.
  const sends = await Promise.allSettled(
    subscriptions.flatMap(({ recipient, rows }) =>
      rows.map(async (subscription) => {
        const payload = reminderPayload({
          locale: interfaceLocale(recipient),
          details: subscription.notifyDetails,
          title: occurrenceTitle(event, exception),
          start,
          allDay: occurrenceIsAllDay(event, exception),
          timezone: occurrenceTimezone(event, exception, space.timezone),
          tag: `reminder:${data.eventId}:${data.originalDate}`,
          url: `/calendar/${data.eventId}`,
        })
        const result = await deps.push.send(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
          payload,
        )
        return { result, endpoint: subscription.endpoint }
      }),
    ),
  )
  let delivered = 0
  let failed = 0
  const expiredEndpoints: string[] = []
  for (const settled of sends) {
    if (settled.status !== 'fulfilled') {
      // One send throwing (the sender's own contract keeps that to a
      // result; this guards a bug) counts as a transient failure.
      failed += 1
      continue
    }
    const { result, endpoint } = settled.value
    if (result === 'delivered') {
      delivered += 1
    } else if (result === 'failed') {
      failed += 1
    } else {
      // The push service said the subscription is gone: the row goes too
      // (the acceptance criteria), wherever in the installation it sat.
      expiredEndpoints.push(endpoint)
    }
  }
  // Nobody was reached: a transient refusal across every device. The
  // claim row goes, the job throws, and the queue's retry sends from
  // scratch — a family missing its reminder is worse than a slow one.
  // The receipt (or, when nobody was reached, the release) lands BEFORE
  // the expired-endpoint cleanup: a cleanup failure must never leave the
  // claim held past the run — the retry would meet a live claim with the
  // same start and answer quietly, and the reminder would be lost. The
  // removal is idempotent, so it is best-effort on every path.
  if (delivered === 0 && failed > 0) {
    await deps.db.transaction(async (tx) => {
      await releaseReminderClaim(tx, data.spaceId, data.eventId, data.originalDate, lease)
    })
    await retireExpiredEndpoints(deps, expiredEndpoints)
    throw new Error(
      `Calendar reminder ${data.eventId}/${data.originalDate} reached no device (${failed} failed); the queue retries`,
    )
  }
  await deps.db.transaction(async (tx) => {
    await markReminderSent(
      tx,
      data.spaceId,
      data.eventId,
      data.originalDate,
      lease,
      deps.clock.now(),
    )
  })
  await retireExpiredEndpoints(deps, expiredEndpoints)
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

/**
 * The endpoints the push service rejected as expired go, wherever in the
 * installation they sat — but a removal that fails only logs, on every
 * path: the next send to that endpoint retires it, and the run's own
 * answer (receipt or release, already written) must not be undone.
 */
async function retireExpiredEndpoints(
  deps: CalendarReminderJobsDeps,
  endpoints: readonly string[],
): Promise<void> {
  for (const endpoint of endpoints) {
    try {
      await deps.db.transaction(async (tx) => {
        await removeSubscriptionsByEndpointAcrossSpaces(tx, endpoint)
      })
    } catch (error) {
      deps.logger.warn(
        { err: pushLogError(error), endpointHost: endpointHost(endpoint) },
        'Expired push subscription not removed; the next send to it retires it',
      )
    }
  }
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
 * space's active membership as it stands now — a member added after the
 * event is in, one the space has since lost is out, and an archived member
 * is out too (issue #23): they are no longer part of the space's life, so
 * this read is where their exclusion hangs from. A named list keeps only
 * the members that still exist and are still active.
 */
async function resolveReminderRecipients(
  deps: CalendarReminderJobsDeps,
  spaceId: string,
  stored: { reminder: CalendarEventReminder; memberIds: string[] },
): Promise<Member[]> {
  const members = await listMembers({ db: deps.db, clock: deps.clock }, spaceId)
  const active = members.filter((member) => member.archivedAt === null)
  if (stored.reminder.everyone) return active
  const named = new Set(stored.memberIds)
  return active.filter((member) => named.has(member.id))
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
  /** The device-side deduplication tag: duplicates collapse into one. */
  tag: string
  /** Where a tap lands: the event's own screen. */
  url: string
}): PushPayload {
  const i18n = createI18n({ locale: input.locale })
  if (!input.details) {
    return {
      title: i18n.t('notifications.push.neutralTitle'),
      body: i18n.t('notifications.push.neutralBody'),
      tag: input.tag,
      url: input.url,
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
        // The zone rides along (ADR-0006): a recipient in another zone
        // reads the event's own wall time for what it is.
        timeZoneName: 'short',
      }).format(input.start)
  return {
    title: input.title,
    body: i18n.t('notifications.push.detailsBody', { time: formatted }),
    tag: input.tag,
    url: input.url,
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
 * gets its events' upcoming occurrences scheduled — exactly the span
 * between the event's watermark and the horizon, so a worker down for a
 * week fills that week's gap and a healthy round adds only the days
 * since. The claims that outlived every job that could ask are pruned.
 * One transaction per space; one space's failure does not stop the
 * others.
 */
export async function extendReminderHorizons(deps: CalendarReminderJobsDeps): Promise<void> {
  const now = deps.clock.now()
  const horizonEnd = new Date(now.getTime() + REMINDER_HORIZON_DAYS * DAY_MS)
  const watermarkResetAbove = new Date(horizonEnd.getTime() + DAY_MS)
  const spaceIds = await listSpacesWithReminderEventsAcrossSpaces(deps.db)
  const failures: Array<{ spaceId: string; cause: unknown }> = []
  for (const spaceId of spaceIds) {
    try {
      await deps.db.transaction(async (tx) => {
        // The sweep reads a reminder row and then writes its watermark:
        // the space row lock keeps that read-decide-write serialised
        // against an edit committing beside it (architecture.md,
        // "Revision bookkeeping"). A space removed mid-discovery answers
        // quietly, like its pending jobs do.
        try {
          await lockSpace(tx, spaceId)
        } catch (error) {
          if (error instanceof DomainError && error.code === 'space_not_found') return
          throw error
        }
        const space = await getSpaceInTx(tx, spaceId)
        const events = await listReminderEventsInSpace(tx, spaceId)
        for (const event of events) {
          const stored = await getReminderForEvent(tx, spaceId, event.id)
          if (stored === undefined) continue
          const exceptions = await listExceptionsForEvent(tx, spaceId, event.id)
          // The watermark is how far this event's occurrences have been
          // scheduled: the round fills exactly (watermark, horizon] and
          // moves it, so a worker down for a week fills that week's gap,
          // and a healthy one adds only the days since.
          // A watermark beyond the horizon is a forward clock jump's
          // poison (a bad NTP step, a VM restore): treat it as unset and
          // let the duplicates — safe by design — wash it out.
          let watermark = stored.reminder.scheduledThrough ?? new Date(0)
          if (watermark.getTime() > watermarkResetAbove.getTime()) watermark = new Date(0)
          if (watermark.getTime() >= horizonEnd.getTime()) continue
          for (const job of reminderJobsBetween(
            event,
            exceptions,
            stored.reminder,
            space.timezone,
            now,
          )) {
            if (job.sendAt.getTime() <= watermark.getTime()) continue
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
          await advanceReminderWatermark(tx, spaceId, event.id, horizonEnd, watermarkResetAbove)
        }
      })
    } catch (cause) {
      failures.push({ spaceId, cause })
    }
  }
  // The prune covers the installation: one pass, not one per space under
  // each space's lock. Its own failure rides the aggregate, beside the
  // spaces' — it never masks them.
  try {
    await deps.db.transaction(async (tx) => {
      await deleteReminderClaimsBefore(tx, new Date(now.getTime() - REMINDER_CLAIM_RETENTION_MS))
    })
  } catch (cause) {
    failures.push({ spaceId: '(claim prune)', cause })
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.cause),
      `Extending reminder horizons failed (${failures.length}): ${failures.map((f) => f.spaceId).join(', ')}`,
    )
  }
}
