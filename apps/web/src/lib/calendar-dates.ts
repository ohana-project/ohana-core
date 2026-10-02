import type { Locale } from '@ohana/i18n'
import { zoneCity, currentOffset as zoneOffset } from '@/lib/timezones.ts'

/*
 * The calendar's date and time rules (issue #20): the one place the two
 * kinds are turned into what a device shows. An all-day event's `date` is
 * a zoneless `YYYY-MM-DD` and is never pushed through a `Date`
 * constructor — `new Date('2026-10-19')` reads UTC midnight, which a
 * UTC− zone would show as the 18th — so the date's parts are read
 * directly. A timed event's instants are shown in the device's local time,
 * and the event's own zone names where the wall time came from — the
 * indication the design puts beside the converted time.
 */

export interface DateOnly {
  year: number
  /** 1–12. */
  month: number
  day: number
}

/**
 * Reads a `YYYY-MM-DD` string into its parts, or undefined when the shape
 * or the calendar date itself is not real (the server refuses such dates,
 * so a miss here is a malformed row, not an expected answer).
 */
export function parseDateOnly(date: string): DateOnly | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return undefined
  return { year, month, day }
}

/** The `YYYY-MM-DD` form of the parts. */
export function formatDateOnly({ year, month, day }: DateOnly): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`
}

/** Today's date in the device's zone, as the all-day kind names its days. */
export function todayDateOnly(now: Date = new Date()): DateOnly {
  // The device-local parts, read without zone conversion surprises: the
  // local components of the moment.
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  }
}

/** The device-local `YYYY-MM-DD` an instant falls on — where the month grid places a timed event. */
export function localDateKey(instant: string): string {
  const at = new Date(instant)
  return formatDateOnly({
    year: at.getFullYear(),
    month: at.getMonth() + 1,
    day: at.getDate(),
  })
}

/**
 * The date key `days` away from `key` — the one-day margins the
 * occurrence windows are padded with, so a timed occurrence a zone shift
 * lands on the drawn edge is not lost to the wall-date bounds (issue #21).
 * A malformed key answers itself.
 */
export function shiftDateKey(key: string, days: number): string {
  const at = Date.parse(`${key}T00:00:00Z`)
  if (
    Number.isNaN(at) ||
    formatDateOnly(parseDateOnly(key) ?? { year: 0, month: 1, day: 1 }) !== key
  ) {
    return key
  }
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

/** The device-local day-of-week of a calendar date: 0 = Monday … 6 = Sunday. */
export function dayOfWeek(date: DateOnly): number {
  // The UTC reading of the date's own midnight is the date itself; the
  // local weekday of a zoneless date is taken from that same reading
  // shifted so the answer does not depend on the device's offset.
  const utcDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  return (utcDay + 6) % 7
}

export interface MonthDay {
  date: DateOnly
  /** Belongs to the month being shown. */
  inMonth: boolean
}

/**
 * The month grid the screen draws: Monday-first, six weeks, the leading
 * and trailing days of the neighbouring months filling the rows
 * (docs/design/screens/calendar.html).
 */
export function monthGrid(year: number, month: number): MonthDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days: MonthDay[] = []
  const push = (d: Date): void => {
    days.push({
      date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
      inMonth: d.getUTCMonth() + 1 === month,
    })
  }
  for (let back = lead; back > 0; back--) {
    push(new Date(Date.UTC(year, month - 1, 1 - back)))
  }
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    push(new Date(Date.UTC(year, month - 1, day)))
  }
  // Six weeks of seven keep every month the same height, like the
  // prototype's grid; the leading days already complete the first row.
  while (days.length < 42) {
    const last = days.at(-1)?.date
    if (last === undefined) break
    push(new Date(Date.UTC(last.year, last.month - 1, last.day + 1)))
  }
  return days
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The previous month's `{year, month}` for the grid navigation. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/** The next month's `{year, month}` for the grid navigation. */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/**
 * The zoneless kinds are formatted at their own UTC midnight, so the label
 * is the date itself in every device zone: without the named zone a
 * UTC− device would read the anchor as its previous evening and shift
 * every all-day label a day back.
 */
function utcFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
}

/** «5 октября» — the day's label in the locale. */
export function formatDayLong(date: DateOnly, locale: Locale): string {
  return utcFormatter(locale, { day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  )
}

/** «31 января 2027 г.» — the day's label with its year: the year is part
 *  of a series' end date, where «до 31 января» alone could be any of them
 *  (issue #21). Anchored at the UTC midnight like the zoneless labels, so
 *  it reads the date itself in every device zone. */
export function formatDayOfYear(date: DateOnly, locale: Locale): string {
  return utcFormatter(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  )
}

/** «СУББОТА, 3 ОКТЯБРЯ 2026» — the event screen's date line. */
export function formatDayFull(date: DateOnly, locale: Locale): string {
  return utcFormatter(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)))
}

/** «Октябрь 2026» — the month heading: the standalone month name and the
 *  year, the capital the prototype's heading carries. */
export function formatMonthTitle(year: number, month: number, locale: Locale): string {
  const name = utcFormatter(locale, { month: 'long' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
  const capitalised = name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  return `${capitalised} ${year}`
}

/** «Пн» … «Вс» — the grid's day-of-week headers, Monday first. */
export function weekdayHeaders(locale: Locale): string[] {
  const format = utcFormatter(locale, { weekday: 'short' })
  // 2023-01-02 was a Monday.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(Date.UTC(2023, 0, 2 + index))),
  )
}

/** «14:30» — the device-local time of a timed event's moment. */
export function formatLocalTime(instant: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))
}

/** «14:30» — the moment read in the event's own zone, the wall time its creator picked. */
export function formatZonedTime(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))
}

const DAY_MS = 86_400_000

/** The zone's offset at the instant, in seconds east of UTC — the reading
 *  the composition below stands on. (The mirror of the API's
 *  platform/timezone.ts: the same wall time must compose to the same
 *  instant on both sides, offline included — the shared expansion cases in
 *  features/calendar/recurrence.test.ts pin the agreement.) */
function zoneOffsetSeconds(zone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)
    if (part === undefined) throw new Error(`The zone lookup produced no ${type}`)
    return Number(part.value)
  }
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  )
  return (asUtc - instant.getTime()) / 1000
}

/**
 * The absolute instant of a wall time in a zone: `date` is `YYYY-MM-DD`,
 * `time` is `HH:MM`. When the wall time sits inside a spring-forward gap
 * and does not exist, the pre-transition offset lands past the gap, and
 * that shifted-forward moment is the answer; when a fall-back repeats the
 * wall time, the earlier instant wins — the first occurrence, where a
 * viewer living there first expects the event. The very rules the API
 * composes with, kept side by side so a recurring occurrence reads the
 * same on every device (issue #21).
 */
export function wallTimeToInstant(date: string, time: string, zone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(naive)) {
    throw new Error(`“${date}T${time}” is not a wall time`)
  }
  const before = zoneOffsetSeconds(zone, new Date(naive - DAY_MS)) * 1000
  const after = zoneOffsetSeconds(zone, new Date(naive + DAY_MS)) * 1000
  const real = [naive - before, naive - after].filter(
    (candidate) => zoneOffsetSeconds(zone, new Date(candidate)) * 1000 === naive - candidate,
  )
  return new Date(real.length > 0 ? Math.min(...real) : naive - before)
}

/** The `YYYY-MM-DD` the moment falls on in the given zone — the editor's
 *  date field when a timed event is edited: the wall date the event keeps. */
export function zonedDateKey(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** The zone's label like the prototypes: «Москва (UTC+3)» — the city the
 *  zone's tail spells and the offset the picker sorts by, the same
 *  vocabulary `lib/timezones.ts` labels its options with. */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  return `${zoneCity(zone)} (${zoneOffset(zone, at)})`
}

/**
 * Whether the event's zone is worth an indication beside the device's
 * local time: when the device is in another zone, the converted time needs
 * its origin named (issue #1, story 63). The comparison reads each side's
 * offset at the moment — abbreviations repeat across zones with different
 * offsets, offsets do not.
 */
export function zoneDiffersFromDevice(zone: string, at: Date = new Date()): boolean {
  const offsetOf = (target: string | undefined): string | undefined => {
    try {
      return new Intl.DateTimeFormat('en', {
        ...(target === undefined ? {} : { timeZone: target }),
        timeZoneName: 'shortOffset',
      })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value
    } catch {
      return undefined
    }
  }
  const eventOffset = offsetOf(zone)
  const deviceOffset = offsetOf(undefined)
  if (eventOffset === undefined || deviceOffset === undefined) return true
  return eventOffset !== deviceOffset
}
