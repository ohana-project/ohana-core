import type { Locale } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import type { StoredCalendarEvent, StoredEventReminder } from '@/data/local-store.ts'
import {
  formatDayLong,
  formatLocalTime,
  formatZonedTime,
  parseDateOnly,
  wallTimeToInstant,
  zoneDiffersFromDevice,
  zoneLabel,
} from '@/lib/calendar-dates.ts'

/*
 * The time a calendar event shows (issue #20, the acceptance criteria): a
 * timed event shows in the device's local time, with the zone it keeps
 * named beside it when the device is in another zone — the origin of the
 * wall time the creator picked, «18:00 · Москва (UTC+3)». An all-day event
 * never shows a time at all: its date is the whole truth, wherever it is
 * viewed.
 */

export interface EventTimeParts {
  primary: string
  secondary?: string
}

/**
 * The one-line summary the lists show, and the detail's two lines. Takes
 * the translator and locale explicitly, so the derivation stays a pure
 * function the screens call from render.
 */
export function eventTimeParts(
  event: StoredCalendarEvent,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: Locale,
): EventTimeParts {
  if (event.allDay) {
    const date =
      event.date === undefined
        ? ''
        : formatDayLong(parseDateOnly(event.date) ?? { year: 0, month: 1, day: 1 }, locale)
    return { primary: t('calendar.allDayLine', { date }) }
  }
  if (event.startsAt === undefined) {
    return { primary: t('calendar.unspecifiedTime') }
  }
  const at = new Date(event.startsAt)
  const start = formatLocalTime(event.startsAt)
  const end = event.endsAt === undefined ? undefined : formatLocalTime(event.endsAt)
  const local = end === undefined ? start : t('calendar.timeRange', { start, end })
  const zone = event.timezone
  if (zone === undefined) {
    return { primary: local }
  }
  if (!zoneDiffersFromDevice(zone, at)) {
    return { primary: local, secondary: zoneLabel(zone, at) }
  }
  const zoneStart = formatZonedTime(event.startsAt, zone)
  const zoneEnd = event.endsAt === undefined ? undefined : formatZonedTime(event.endsAt, zone)
  const zoneRange =
    zoneEnd === undefined ? zoneStart : t('calendar.timeRange', { start: zoneStart, end: zoneEnd })
  return {
    primary: local,
    secondary: t('calendar.originZoneLine', { time: zoneRange, zone: zoneLabel(zone, at) }),
  }
}

/** The time line a list row shows: the local time first, the origin beside it. */
export function EventTimeLine({
  event,
  className,
}: {
  event: StoredCalendarEvent
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const { primary, secondary } = eventTimeParts(event, t, i18n.language as Locale)
  return (
    <span className={className}>
      {secondary === undefined ? primary : `${primary} · ${secondary}`}
    </span>
  )
}

/** The lead choices the editor offers (issue #22), the prototype's set:
 *  the API takes any minute count; these are the ones a family plans in. */
export const REMINDER_LEAD_CHOICES = [15, 60, 120, 1440, 10080] as const

/**
 * «За 2 часа» … — the lead's label, the editor's option and the event
 * screen's reminder row sharing the vocabulary; an off-list stored lead
 * (the API takes any minute count) reads the custom line.
 */
export function reminderLeadLabelKey(minutes: number) {
  return REMINDER_LEAD_CHOICES.includes(minutes as (typeof REMINDER_LEAD_CHOICES)[number])
    ? {
        15: 'calendar.reminderLead15',
        60: 'calendar.reminderLead60',
        120: 'calendar.reminderLead120',
        1440: 'calendar.reminderLeadDay',
        10080: 'calendar.reminderLeadWeek',
      }[minutes as (typeof REMINDER_LEAD_CHOICES)[number]]
    : ('calendar.reminderLeadCustom' as const)
}

/** The lead's label through a structurally typed translator, so the
 *  caller may work with the string — the event screen lowercases it into
 *  its mid-sentence shape («напоминание за 2 часа»). */
export function reminderLeadLabel(
  minutes: number,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  return t(reminderLeadLabelKey(minutes), { minutes })
}

/**
 * The moment the reminder fires, «в 16:00, в пятницу»: a timed event's
 * start minus the lead; an all-day occurrence has no instant of its own,
 * and its reminder anchors to the morning of its wall date in the space's
 * zone — the server's own convention (apps/api calendar/reminders.ts) —
 * so the screen reads the same anchor. Both render in the device's local
 * time; the weekday goes to the catalogue as its keyword, so the ICU
 * message carries the grammar («в пятницу», "on Friday"). Undefined where
 * no anchor exists to subtract the lead from.
 */
export function reminderFireLine(
  event: StoredCalendarEvent,
  spaceZone: string,
  t: (key: string, values?: Record<string, unknown>) => string,
): string | undefined {
  const reminder = event.reminder
  if (reminder === undefined) return undefined
  let anchor: Date | undefined
  if (event.allDay) {
    anchor =
      event.date === undefined ? undefined : wallTimeToInstant(event.date, '09:00', spaceZone)
  } else {
    anchor = event.startsAt === undefined ? undefined : new Date(event.startsAt)
  }
  if (anchor === undefined) return undefined
  const fires = new Date(anchor.getTime() - reminder.leadMinutes * 60_000)
  const time = formatLocalTime(fires.toISOString())
  const day = WEEKDAY_KEYWORDS[fires.getDay()] ?? 'monday'
  return t('calendar.reminderAtLine', { time, day })
}

/** The day-of-week keyword the reminder line's ICU select switches over. */
const WEEKDAY_KEYWORDS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

/** The recipients a reminder goes to, each as its id and name: the stored
 *  recipient ids named through the profiles. Everyone resolves at send
 *  time to the space's active membership, so the row names the active
 *  profiles (issue #22). */
export function reminderRecipients(
  reminder: StoredEventReminder,
  profiles: { id: string; name: string; displayName?: string; archivedAt?: string }[],
  fallbackName: string,
): { id: string; name: string }[] {
  const ids =
    reminder.recipients.everyone === true
      ? profiles.filter((profile) => profile.archivedAt === undefined).map((profile) => profile.id)
      : reminder.recipients.memberIds
  return ids.map((id) => {
    const profile = profiles.find((candidate) => candidate.id === id)
    return { id, name: profile?.displayName ?? profile?.name ?? fallbackName }
  })
}

/**
 * The length of a timed event, «3 ч 30 мин»; undefined when it cannot be
 * one. Takes the translator like `eventTimeParts`.
 */
export function eventDuration(
  event: StoredCalendarEvent,
  t: (key: string, values?: Record<string, unknown>) => string,
): string | undefined {
  if (event.allDay || event.startsAt === undefined || event.endsAt === undefined) return undefined
  const minutes = Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000)
  if (minutes <= 0) return undefined
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return t('calendar.durationMinutes', { count: rest })
  if (rest === 0) return t('calendar.durationHours', { count: hours })
  return t('calendar.durationHoursMinutes', { hours, minutes: rest })
}
