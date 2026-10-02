import { describe, expect, test } from 'vitest'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import { wallTimeToInstant } from '@/lib/calendar-dates.ts'
import {
  expandEvent,
  nextLiveOccurrenceDate,
  occurrenceInstants,
  occurrenceOf,
  type Recurrence,
  seriesStartDate,
  seriesTimedFrame,
  seriesTodayKey,
  type TimedFrame,
} from './recurrence.ts'

/*
 * The recurrence engine's tests, the web half (issue #21). The expansion
 * cases below are the shared table: the very same cases, verbatim, live in
 * the API's `apps/api/src/modules/calendar/recurrence.test.ts`, because the
 * client must expand occurrences with the same rules the server keeps (the
 * ticket's acceptance criteria) while api and web share no domain package
 * (ADR-0013) — the table is the contract's double entry book. When a case
 * changes here, change it there in the same commit.
 *
 * The timed cases pin the DST behaviour of the expansion: the wall time
 * repeats in the event's zone, so a spring forward keeps the wall time at a
 * different UTC instant, a wall time inside the spring-forward gap moves to
 * the gap's far side (the composition's documented convention), and the
 * occurrence's length is the series' wall length, not whatever the day's
 * offsets do to it.
 *
 * The table's cases keep every series' first occurrence off the transition
 * days — deliberately: a first occurrence that sits on one is the one
 * place the two sides read differently. The client shows the stored row
 * for that date (its copy of this file pins the fall-back case), while the
 * composition here answers from the frame; #22's reminder scheduling must
 * take the stored instants for a series' first occurrence the same way.
 */

interface SharedCase {
  name: string
  /** The series' first occurrence — the frame the stored row keeps. */
  series: {
    allDay: boolean
    date: string
    startTime?: string
    endTime?: string
    timezone?: string
  }
  /** Undefined is a one-time event; the engine answers an empty expansion. */
  recurrence: Recurrence | undefined
  /** The expansion window, wall dates in the series' own frame. */
  window: { from: string; to: string }
  /** The wall dates the series occupies in the window. */
  dates: string[]
  /** For a timed series: the start instant of each expected date, ISO UTC. */
  starts?: Record<string, string>
  /** For a timed series: the end instant of each expected date, ISO UTC. */
  ends?: Record<string, string>
}
const SHARED_CASES: SharedCase[] = [
  {
    name: 'daily repeats every day in the window',
    series: { allDay: true, date: '2026-01-01' },
    recurrence: { frequency: 'daily' },
    window: { from: '2026-01-03', to: '2026-01-07' },
    dates: ['2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'],
  },
  {
    name: 'daily stops at until',
    series: { allDay: true, date: '2026-01-01' },
    recurrence: { frequency: 'daily', until: '2026-01-05' },
    window: { from: '2026-01-01', to: '2026-12-31' },
    dates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
  },
  {
    name: 'weekly keeps the first occurrence’s weekday',
    series: { allDay: true, date: '2026-01-05' },
    recurrence: { frequency: 'weekly' },
    window: { from: '2026-01-01', to: '2026-02-28' },
    dates: [
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
      '2026-02-09',
      '2026-02-16',
      '2026-02-23',
    ],
  },
  {
    name: 'monthly on the 31st skips the months that have no 31st',
    series: { allDay: true, date: '2026-01-31' },
    recurrence: { frequency: 'monthly' },
    window: { from: '2026-01-01', to: '2026-06-30' },
    dates: ['2026-01-31', '2026-03-31', '2026-05-31'],
  },
  {
    name: 'monthly on the 29th skips a non-leap February',
    series: { allDay: true, date: '2026-01-29' },
    recurrence: { frequency: 'monthly' },
    window: { from: '2026-01-01', to: '2026-04-30' },
    dates: ['2026-01-29', '2026-03-29', '2026-04-29'],
  },
  {
    name: 'monthly on the 29th lands on a leap February',
    series: { allDay: true, date: '2024-01-29' },
    recurrence: { frequency: 'monthly' },
    window: { from: '2024-01-01', to: '2024-04-30' },
    dates: ['2024-01-29', '2024-02-29', '2024-03-29', '2024-04-29'],
  },
  {
    name: 'yearly on February 29 repeats only in leap years',
    series: { allDay: true, date: '2024-02-29' },
    recurrence: { frequency: 'yearly' },
    window: { from: '2024-01-01', to: '2029-12-31' },
    dates: ['2024-02-29', '2028-02-29'],
  },
  {
    name: 'yearly keeps the month and the day',
    series: { allDay: true, date: '2026-03-08' },
    recurrence: { frequency: 'yearly' },
    window: { from: '2026-01-01', to: '2029-12-31' },
    dates: ['2026-03-08', '2027-03-08', '2028-03-08', '2029-03-08'],
  },
  {
    name: 'until before the window leaves nothing',
    series: { allDay: true, date: '2025-06-01' },
    recurrence: { frequency: 'monthly', until: '2025-12-31' },
    window: { from: '2026-01-01', to: '2026-12-31' },
    dates: [],
  },
  {
    name: 'a window before the series starts leaves nothing',
    series: { allDay: true, date: '2026-06-01' },
    recurrence: { frequency: 'monthly' },
    window: { from: '2026-01-01', to: '2026-05-31' },
    dates: [],
  },
  {
    name: 'until on the last occurrence keeps it',
    series: { allDay: true, date: '2026-01-01' },
    recurrence: { frequency: 'daily', until: '2026-01-03' },
    window: { from: '2026-01-01', to: '2026-12-31' },
    dates: ['2026-01-01', '2026-01-02', '2026-01-03'],
  },
  {
    name: 'a far window fast-forwards a leap-day series',
    series: { allDay: true, date: '2020-02-29' },
    recurrence: { frequency: 'yearly' },
    window: { from: '2026-01-01', to: '2032-12-31' },
    dates: ['2028-02-29', '2032-02-29'],
  },
  {
    name: 'a far window fast-forwards a 31st-of-the-month series',
    series: { allDay: true, date: '2020-01-31' },
    recurrence: { frequency: 'monthly' },
    window: { from: '2026-10-01', to: '2027-04-30' },
    dates: ['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31'],
  },
  {
    name: 'weekly keeps the wall time across the EU spring forward',
    series: {
      allDay: false,
      date: '2026-03-01',
      startTime: '18:00',
      endTime: '19:30',
      timezone: 'Europe/Berlin',
    },
    recurrence: { frequency: 'weekly' },
    window: { from: '2026-03-01', to: '2026-04-30' },
    dates: [
      '2026-03-01',
      '2026-03-08',
      '2026-03-15',
      '2026-03-22',
      '2026-03-29',
      '2026-04-05',
      '2026-04-12',
      '2026-04-19',
      '2026-04-26',
    ],
    starts: {
      '2026-03-01': '2026-03-01T17:00:00.000Z',
      '2026-03-08': '2026-03-08T17:00:00.000Z',
      '2026-03-15': '2026-03-15T17:00:00.000Z',
      '2026-03-22': '2026-03-22T17:00:00.000Z',
      '2026-03-29': '2026-03-29T16:00:00.000Z',
      '2026-04-05': '2026-04-05T16:00:00.000Z',
      '2026-04-12': '2026-04-12T16:00:00.000Z',
      '2026-04-19': '2026-04-19T16:00:00.000Z',
      '2026-04-26': '2026-04-26T16:00:00.000Z',
    },
    ends: {
      '2026-03-01': '2026-03-01T18:30:00.000Z',
      '2026-03-08': '2026-03-08T18:30:00.000Z',
      '2026-03-15': '2026-03-15T18:30:00.000Z',
      '2026-03-22': '2026-03-22T18:30:00.000Z',
      '2026-03-29': '2026-03-29T17:30:00.000Z',
      '2026-04-05': '2026-04-05T17:30:00.000Z',
      '2026-04-12': '2026-04-12T17:30:00.000Z',
      '2026-04-19': '2026-04-19T17:30:00.000Z',
      '2026-04-26': '2026-04-26T17:30:00.000Z',
    },
  },
  {
    name: 'weekly keeps the wall time across the US fall back',
    series: {
      allDay: false,
      date: '2026-10-11',
      startTime: '18:00',
      endTime: '19:00',
      timezone: 'America/New_York',
    },
    recurrence: { frequency: 'weekly' },
    window: { from: '2026-10-11', to: '2026-11-30' },
    dates: [
      '2026-10-11',
      '2026-10-18',
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
    ],
    starts: {
      '2026-10-11': '2026-10-11T22:00:00.000Z',
      '2026-10-18': '2026-10-18T22:00:00.000Z',
      '2026-10-25': '2026-10-25T22:00:00.000Z',
      '2026-11-01': '2026-11-01T23:00:00.000Z',
      '2026-11-08': '2026-11-08T23:00:00.000Z',
      '2026-11-15': '2026-11-15T23:00:00.000Z',
      '2026-11-22': '2026-11-22T23:00:00.000Z',
      '2026-11-29': '2026-11-29T23:00:00.000Z',
    },
    ends: {
      '2026-10-11': '2026-10-11T23:00:00.000Z',
      '2026-10-18': '2026-10-18T23:00:00.000Z',
      '2026-10-25': '2026-10-25T23:00:00.000Z',
      '2026-11-01': '2026-11-02T00:00:00.000Z',
      '2026-11-08': '2026-11-09T00:00:00.000Z',
      '2026-11-15': '2026-11-16T00:00:00.000Z',
      '2026-11-22': '2026-11-23T00:00:00.000Z',
      '2026-11-29': '2026-11-30T00:00:00.000Z',
    },
  },
  {
    name: 'an occurrence in the spring-forward gap moves to the gap’s far side',
    series: {
      allDay: false,
      date: '2026-03-07',
      startTime: '02:30',
      endTime: '03:30',
      timezone: 'America/New_York',
    },
    recurrence: { frequency: 'daily' },
    window: { from: '2026-03-07', to: '2026-03-09' },
    dates: ['2026-03-07', '2026-03-08', '2026-03-09'],
    starts: {
      '2026-03-07': '2026-03-07T07:30:00.000Z',
      // 02:30 does not exist on the transition day: the composition keeps
      // the moment the pre-transition offset lands on, 03:30 EDT.
      '2026-03-08': '2026-03-08T07:30:00.000Z',
      '2026-03-09': '2026-03-09T06:30:00.000Z',
    },
    ends: {
      '2026-03-07': '2026-03-07T08:30:00.000Z',
      // The occurrence keeps the series' wall length (an hour), so the
      // shifted start never meets its end.
      '2026-03-08': '2026-03-08T08:30:00.000Z',
      '2026-03-09': '2026-03-09T07:30:00.000Z',
    },
  },
  {
    name: 'the fall-back’s repeated hour takes the first instant',
    series: {
      allDay: false,
      date: '2026-10-31',
      startTime: '01:30',
      endTime: '03:00',
      timezone: 'America/New_York',
    },
    recurrence: { frequency: 'daily' },
    window: { from: '2026-10-31', to: '2026-11-02' },
    dates: ['2026-10-31', '2026-11-01', '2026-11-02'],
    starts: {
      '2026-10-31': '2026-10-31T05:30:00.000Z',
      // 01:30 happens twice on the transition day (02:00 EDT falls back to
      // 01:00 EST); the first one is where a viewer living there first
      // expects the event, so the start keeps its EDT instant.
      '2026-11-01': '2026-11-01T05:30:00.000Z',
      '2026-11-02': '2026-11-02T06:30:00.000Z',
    },
    ends: {
      // The occurrence keeps the series' wall length (90 minutes), so on
      // the transition day it ends at 02:00 EST, not at the wall pair's
      // own composition — the length is the one rule that never inverts.
      '2026-10-31': '2026-10-31T07:00:00.000Z',
      '2026-11-01': '2026-11-01T07:00:00.000Z',
      '2026-11-02': '2026-11-02T08:00:00.000Z',
    },
  },
  {
    name: 'a fractional-offset zone keeps its minutes',
    series: {
      allDay: false,
      date: '2026-01-04',
      startTime: '09:15',
      endTime: '10:00',
      timezone: 'Asia/Kathmandu',
    },
    recurrence: { frequency: 'weekly' },
    window: { from: '2026-01-04', to: '2026-01-18' },
    dates: ['2026-01-04', '2026-01-11', '2026-01-18'],
    starts: {
      '2026-01-04': '2026-01-04T03:30:00.000Z',
      '2026-01-11': '2026-01-11T03:30:00.000Z',
      '2026-01-18': '2026-01-18T03:30:00.000Z',
    },
    ends: {
      '2026-01-04': '2026-01-04T04:15:00.000Z',
      '2026-01-11': '2026-01-11T04:15:00.000Z',
      '2026-01-18': '2026-01-18T04:15:00.000Z',
    },
  },
  {
    name: 'weekly keeps the wall time across the southern-hemisphere fall back',
    series: {
      allDay: false,
      date: '2026-03-29',
      startTime: '12:00',
      endTime: '13:00',
      timezone: 'Pacific/Auckland',
    },
    recurrence: { frequency: 'weekly' },
    window: { from: '2026-03-29', to: '2026-04-19' },
    dates: ['2026-03-29', '2026-04-05', '2026-04-12', '2026-04-19'],
    starts: {
      '2026-03-29': '2026-03-28T23:00:00.000Z',
      '2026-04-05': '2026-04-05T00:00:00.000Z',
      '2026-04-12': '2026-04-12T00:00:00.000Z',
      '2026-04-19': '2026-04-19T00:00:00.000Z',
    },
    ends: {
      '2026-03-29': '2026-03-29T00:00:00.000Z',
      '2026-04-05': '2026-04-05T01:00:00.000Z',
      '2026-04-12': '2026-04-12T01:00:00.000Z',
      '2026-04-19': '2026-04-19T01:00:00.000Z',
    },
  },
  {
    name: 'a timed series’ until bounds the wall date, not the UTC day',
    series: {
      allDay: false,
      date: '2026-03-28',
      startTime: '18:00',
      endTime: '19:00',
      timezone: 'Europe/Berlin',
    },
    recurrence: { frequency: 'daily', until: '2026-03-29' },
    window: { from: '2026-03-01', to: '2026-04-30' },
    dates: ['2026-03-28', '2026-03-29'],
    starts: {
      '2026-03-28': '2026-03-28T17:00:00.000Z',
      '2026-03-29': '2026-03-29T16:00:00.000Z',
    },
    ends: {
      '2026-03-28': '2026-03-28T18:00:00.000Z',
      '2026-03-29': '2026-03-29T17:00:00.000Z',
    },
  },
  {
    name: 'a one-time event expands to nothing',
    series: { allDay: true, date: '2026-05-01' },
    recurrence: undefined,
    window: { from: '2026-01-01', to: '2026-12-31' },
    dates: [],
  },
]

/** The stored row a case's series stands for: the first occurrence's
 *  instants composed the way the service composes them, the recurrence the
 *  wire carries. */
function storedEvent(
  series: SharedCase['series'],
  recurrence: Recurrence | undefined,
): StoredCalendarEvent {
  const base = {
    id: '0198c1a2-3b4c-7d8e-9f01-23456789abc0',
    creatorId: '0198c1a2-3b4c-7d8e-9f01-23456789abc1',
    title: 'Серия',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  if (series.allDay) {
    return {
      ...base,
      allDay: true,
      date: series.date,
      ...(recurrence === undefined ? {} : { recurrence }),
    }
  }
  if (
    series.timezone === undefined ||
    series.startTime === undefined ||
    series.endTime === undefined
  ) {
    throw new Error('A timed case names its zone and its wall pair')
  }
  const startsAt = wallTimeToInstant(series.date, series.startTime, series.timezone)
  const endsAt = wallTimeToInstant(series.date, series.endTime, series.timezone)
  return {
    ...base,
    allDay: false,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timezone: series.timezone,
    ...(recurrence === undefined ? {} : { recurrence }),
  }
}

describe('occurrence expansion (the shared table)', () => {
  for (const shared of SHARED_CASES) {
    test(shared.name, () => {
      const event = storedEvent(shared.series, shared.recurrence)
      const occurrences = expandEvent(event, shared.window.from, shared.window.to)
      expect(occurrences.map((occurrence) => occurrence.originalDate)).toEqual(shared.dates)
      if (shared.series.allDay || shared.starts === undefined) return
      // Every occurrence reads as the stored row would on that date: the
      // screens read the instants, so they are pinned too.
      for (const occurrence of occurrences) {
        expect(occurrence.event.startsAt).toBe(shared.starts[occurrence.originalDate])
        if (shared.ends !== undefined) {
          expect(occurrence.event.endsAt).toBe(shared.ends[occurrence.originalDate])
        }
      }
    })
  }
})

describe('the series a stored row keeps', () => {
  test('the first date is the all-day date, or the wall date the timed start reads', () => {
    expect(seriesStartDate(storedEvent({ allDay: true, date: '2026-05-01' }, undefined))).toBe(
      '2026-05-01',
    )
    const timed = storedEvent(
      {
        allDay: false,
        date: '2026-03-01',
        startTime: '18:00',
        endTime: '19:30',
        timezone: 'Europe/Berlin',
      },
      { frequency: 'weekly' },
    )
    expect(seriesStartDate(timed)).toBe('2026-03-01')
  })

  test('the timed frame reads the wall pair back out of the stored instants', () => {
    const timed = storedEvent(
      {
        allDay: false,
        date: '2026-03-01',
        startTime: '18:00',
        endTime: '19:30',
        timezone: 'Europe/Berlin',
      },
      { frequency: 'weekly' },
    )
    expect(seriesTimedFrame(timed)).toEqual({
      timezone: 'Europe/Berlin',
      startTime: '18:00',
      durationMinutes: 90,
    })
  })

  test('a one-time row expands to nothing', () => {
    const oneTime = storedEvent({ allDay: true, date: '2026-05-01' }, undefined)
    expect(expandEvent(oneTime, '2026-01-01', '2026-12-31')).toEqual([])
  })
})

describe('occurrences with exceptions applied (issue #21)', () => {
  const series = storedEvent(
    {
      allDay: false,
      date: '2026-10-05',
      startTime: '18:00',
      endTime: '21:00',
      timezone: 'Europe/Moscow',
    },
    { frequency: 'weekly' },
  )

  test('a plain occurrence is the series at its own wall time', () => {
    const occurrence = occurrenceOf(series, '2026-10-12')
    expect(occurrence).toMatchObject({
      key: `${series.id}:2026-10-12`,
      eventId: series.id,
      originalDate: '2026-10-12',
    })
    expect(occurrence?.event).toMatchObject({
      id: `${series.id}:2026-10-12`,
      title: 'Серия',
      allDay: false,
      startsAt: '2026-10-12T15:00:00.000Z',
      endsAt: '2026-10-12T18:00:00.000Z',
      timezone: 'Europe/Moscow',
    })
  })

  test('an override replaces the occurrence whole, under the same key', () => {
    const overridden: StoredCalendarEvent = {
      ...series,
      exceptions: [
        {
          originalDate: '2026-10-12',
          kind: 'override',
          title: 'Поход в театр',
          allDay: true,
          date: '2026-10-13',
        },
      ],
    }
    const occurrence = occurrenceOf(overridden, '2026-10-12')
    expect(occurrence?.key).toBe(`${series.id}:2026-10-12`)
    expect(occurrence?.event).toMatchObject({
      title: 'Поход в театр',
      allDay: true,
      date: '2026-10-13',
    })

    // The timed override carries its own moments and zone.
    const timed: StoredCalendarEvent = {
      ...series,
      exceptions: [
        {
          originalDate: '2026-10-19',
          kind: 'override',
          title: 'Ужин у Димы',
          allDay: false,
          startsAt: '2026-10-19T16:00:00.000Z',
          endsAt: '2026-10-19T19:00:00.000Z',
          timezone: 'Europe/Moscow',
        },
      ],
    }
    const later = occurrenceOf(timed, '2026-10-19')
    expect(later?.event).toMatchObject({
      title: 'Ужин у Димы',
      allDay: false,
      startsAt: '2026-10-19T16:00:00.000Z',
      timezone: 'Europe/Moscow',
    })
  })

  test('a cancelled occurrence is not there at all', () => {
    const cancelled: StoredCalendarEvent = {
      ...series,
      exceptions: [{ originalDate: '2026-10-12', kind: 'cancelled' }],
    }
    expect(occurrenceOf(cancelled, '2026-10-12')).toBeUndefined()
    const window = expandEvent(cancelled, '2026-10-01', '2026-10-31')
    expect(window.map((occurrence) => occurrence.originalDate)).not.toContain('2026-10-12')
    // The neighbours stand.
    expect(window.map((occurrence) => occurrence.originalDate)).toContain('2026-10-05')
    expect(window.map((occurrence) => occurrence.originalDate)).toContain('2026-10-19')
  })

  test('a date off the series is no occurrence', () => {
    expect(occurrenceOf(series, '2026-10-13')).toBeUndefined()
    expect(occurrenceOf(series, '2026-10-05')).toBeDefined()
  })
})

describe('the instants the client composes', () => {
  test('the frame the expansion derives composes like the API does', () => {
    // The table's own expectations already walk through this function; this
    // pins the one-call shape the screens use for a single date.
    const frame: TimedFrame = { timezone: 'Europe/Berlin', startTime: '18:00', durationMinutes: 90 }
    expect(occurrenceInstants(frame, '2026-03-29')).toEqual({
      startsAt: '2026-03-29T16:00:00.000Z',
      endsAt: '2026-03-29T17:30:00.000Z',
    })
  })
})

describe('the stored first occurrence and moved overrides (review round one)', () => {
  test('the series’ first date is the row itself, never recomposed', () => {
    // The first start sits on the fall-back day itself (2026-11-01, US
    // clocks 02:00 EDT → 01:00 EST): the stored instants are the exact
    // truth about that date, and recomposing the frame would give a
    // different end — 01:30 EDT plus the wall length lands on 01:30 EST
    // (07:00Z), while the stored end composes 03:00 EST (08:00Z).
    const fallBackFirst = storedEvent(
      {
        allDay: false,
        date: '2026-11-01',
        startTime: '01:30',
        endTime: '03:00',
        timezone: 'America/New_York',
      },
      { frequency: 'daily' },
    )
    const first = occurrenceOf(fallBackFirst, '2026-11-01')
    // Exactly what the service stored: 01:30 EDT through 03:00 EST.
    expect(first?.event.startsAt).toBe('2026-11-01T05:30:00.000Z')
    expect(first?.event.endsAt).toBe('2026-11-01T08:00:00.000Z')
    // The next day recomposes: the same wall time, both EST.
    const second = occurrenceOf(fallBackFirst, '2026-11-02')
    expect(second?.event.startsAt).toBe('2026-11-02T06:30:00.000Z')
    expect(second?.event.endsAt).toBe('2026-11-02T08:00:00.000Z')
  })

  test('an override moved into the window from a date outside it still stands', () => {
    const series = storedEvent({ allDay: true, date: '2026-10-05' }, { frequency: 'weekly' })
    // The 5th moved to the 28th: a November window never expands the 5th,
    // yet the moved occurrence is November's to show.
    const moved: StoredCalendarEvent = {
      ...series,
      exceptions: [
        {
          originalDate: '2026-10-05',
          kind: 'override',
          title: 'Перенесли',
          allDay: true,
          date: '2026-11-02',
        },
      ],
    }
    const november = expandEvent(moved, '2026-11-01', '2026-11-30')
    expect(november.map((occurrence) => occurrence.originalDate)).toEqual([
      '2026-10-05',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ])
    const movedIn = november.find((occurrence) => occurrence.originalDate === '2026-10-05')
    expect(movedIn?.event).toMatchObject({ title: 'Перенесли', date: '2026-11-02' })

    // And a move out of the drawn window is gone from it, its original
    // date silently skipped.
    const october = expandEvent(moved, '2026-10-01', '2026-10-31')
    expect(october.map((occurrence) => occurrence.originalDate)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
  })

  test('an override anchored to a date the series no longer produces is inert', () => {
    const series = storedEvent({ allDay: true, date: '2026-10-05' }, { frequency: 'weekly' })
    // The 6th (a Tuesday) was never a Monday series' occurrence: whatever
    // the override says, no screen shows it.
    const inert: StoredCalendarEvent = {
      ...series,
      exceptions: [
        {
          originalDate: '2026-10-06',
          kind: 'override',
          title: 'Призрак',
          allDay: true,
          date: '2026-10-06',
        },
      ],
    }
    expect(expandEvent(inert, '2026-10-01', '2026-10-31').map((o) => o.originalDate)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
  })
})

describe('the landing anchor (nextLiveOccurrenceDate, review round five)', () => {
  const today = '2026-10-01'

  test('a series that has run for years lands on its next date, not its first', () => {
    const series = storedEvent({ allDay: true, date: '2024-01-05' }, { frequency: 'weekly' })
    expect(nextLiveOccurrenceDate(series, today)).toBe('2026-10-02')
  })

  test('a yearly February 29 series reaches past one skipped cycle', () => {
    const leap = storedEvent({ allDay: true, date: '2024-02-29' }, { frequency: 'yearly' })
    // Searching from just past the 2024 occurrence: a two-year cap would
    // end before 2028 and fall back to the years-old first date; the
    // yearly cap reaches it.
    expect(nextLiveOccurrenceDate(leap, '2024-03-01')).toBe('2028-02-29')
    // The century's own skip: 2100 is not a leap year, so the next one is
    // eight years out — only the yearly cap spans it.
    const far = storedEvent({ allDay: true, date: '2096-02-29' }, { frequency: 'yearly' })
    expect(nextLiveOccurrenceDate(far, '2096-03-01')).toBe('2104-02-29')
  })

  test('a series whose until has passed falls back to its first live date', () => {
    const past = storedEvent(
      { allDay: true, date: '2026-01-01' },
      { frequency: 'daily', until: '2026-01-03' },
    )
    expect(nextLiveOccurrenceDate(past, today)).toBe('2026-01-01')
    // The first live one overall, not merely the first date: the 1st is
    // cancelled, the 2nd stands.
    const cancelledFirst: StoredCalendarEvent = {
      ...past,
      exceptions: [{ originalDate: '2026-01-01', kind: 'cancelled' }],
    }
    expect(nextLiveOccurrenceDate(cancelledFirst, today)).toBe('2026-01-02')
    // And when nothing is live at all, the row's own first date is the
    // last answer (the screen shows it with series actions only).
    const allGone: StoredCalendarEvent = {
      ...past,
      exceptions: [
        { originalDate: '2026-01-01', kind: 'cancelled' },
        { originalDate: '2026-01-02', kind: 'cancelled' },
        { originalDate: '2026-01-03', kind: 'cancelled' },
      ],
    }
    expect(nextLiveOccurrenceDate(allGone, today)).toBe('2026-01-01')
  })

  test('a one-time event anchors on its own date', () => {
    const oneTime = storedEvent({ allDay: true, date: '2026-01-01' }, undefined)
    expect(nextLiveOccurrenceDate(oneTime, today)).toBe('2026-01-01')
  })
})

describe('seriesTodayKey — a timed series reads its own zone', () => {
  test('a timed series reads today in its own zone', () => {
    // Noon UTC on the 1st is already one in the morning of the 2nd in
    // Auckland: the series' frame is a day ahead of the device's.
    const auckland = storedEvent(
      {
        allDay: false,
        date: '2026-10-02',
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Pacific/Auckland',
      },
      { frequency: 'daily' },
    )
    expect(seriesTodayKey(auckland, new Date('2026-10-01T12:00:00.000Z'))).toBe('2026-10-02')
  })
})
