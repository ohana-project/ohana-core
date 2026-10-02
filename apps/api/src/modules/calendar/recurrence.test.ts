import { describe, expect, test } from 'vitest'
import { wallTimeToInstant } from '../../platform/timezone.ts'
import {
  composeRrule,
  expandOccurrenceDates,
  isOccurrenceDate,
  occurrenceInstants,
  parseRrule,
  type Recurrence,
  type TimedFrame,
} from './recurrence.ts'

/*
 * The recurrence engine's tests (issue #21). The expansion cases below are
 * the shared table: the very same cases, verbatim, live in the web client's
 * `apps/web/src/features/calendar/recurrence.test.ts`, because the client
 * must expand occurrences with the same rules the server keeps (the ticket's
 * acceptance criteria) while api and web share no domain package (ADR-0013)
 * — the table is the contract's double entry book. When a case changes
 * here, change it there in the same commit.
 *
 * The timed cases pin the DST behaviour of the expansion: the wall time
 * repeats in the event's zone, so a spring forward keeps the wall time at a
 * different UTC instant, a wall time inside the spring-forward gap moves to
 * the gap's far side (the composition's documented convention), and the
 * occurrence's length is the series' wall length, not whatever the day's
 * offsets do to it.
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

/** The timed frame a case's series stands for: the wall start and the wall length. */
function timedFrame(series: SharedCase['series']): TimedFrame {
  if (
    series.timezone === undefined ||
    series.startTime === undefined ||
    series.endTime === undefined
  ) {
    throw new Error('A timed case names its zone and its wall pair')
  }
  const startMinutes =
    Number(series.startTime.slice(0, 2)) * 60 + Number(series.startTime.slice(3, 5))
  const endMinutes = Number(series.endTime.slice(0, 2)) * 60 + Number(series.endTime.slice(3, 5))
  return {
    timezone: series.timezone,
    startTime: series.startTime,
    durationMinutes: endMinutes - startMinutes,
  }
}

describe('occurrence expansion (the shared table)', () => {
  for (const shared of SHARED_CASES) {
    test(shared.name, () => {
      const dates = expandOccurrenceDates(
        shared.series.date,
        shared.recurrence,
        shared.window.from,
        shared.window.to,
      )
      expect(dates).toEqual(shared.dates)
      if (shared.series.allDay || shared.starts === undefined) return
      const frame = timedFrame(shared.series)
      for (const date of dates) {
        const instants = occurrenceInstants(frame, date)
        expect(instants.startsAt.toISOString()).toBe(shared.starts[date])
        if (shared.ends !== undefined) {
          expect(instants.endsAt.toISOString()).toBe(shared.ends[date])
        }
      }
    })
  }
})

describe('rrule composition and parsing', () => {
  test('an all-day series composes the date form of until', () => {
    expect(composeRrule({ frequency: 'weekly' }, { allDay: true })).toBe('FREQ=WEEKLY')
    expect(composeRrule({ frequency: 'monthly', until: '2027-06-30' }, { allDay: true })).toBe(
      'FREQ=MONTHLY;UNTIL=20270630',
    )
  })

  test('a timed series composes until as the end of its last day in the zone', () => {
    // The last day's 23:59 in Berlin: the instant cutoff that keeps every
    // occurrence whose wall date is the until date, and nothing later.
    expect(
      composeRrule(
        { frequency: 'daily', until: '2027-06-30' },
        { allDay: false, timezone: 'Europe/Berlin' },
      ),
    ).toBe('FREQ=DAILY;UNTIL=20270630T215900Z')
  })

  test('parsing answers the recurrence the composition encoded', () => {
    expect(parseRrule('FREQ=WEEKLY', { allDay: true })).toEqual({ frequency: 'weekly' })
    expect(parseRrule('FREQ=MONTHLY;UNTIL=20270630', { allDay: true })).toEqual({
      frequency: 'monthly',
      until: '2027-06-30',
    })
    expect(
      parseRrule('FREQ=DAILY;UNTIL=20270630T215900Z', { allDay: false, timezone: 'Europe/Berlin' }),
    ).toEqual({
      frequency: 'daily',
      until: '2027-06-30',
    })
  })

  test('a foreign RRULE feature is refused on the read path too', () => {
    const foreign = [
      'FREQ=SECONDLY',
      'FREQ=MINUTELY',
      'FREQ=HOURLY',
      'FREQ=WEEKLY;INTERVAL=2',
      'FREQ=WEEKLY;BYDAY=MO',
      'FREQ=DAILY;COUNT=5',
      'FREQ=DAILY;UNTIL=20270630;BYMONTHDAY=1',
      'daily',
      'FREQ=WEEKLY;UNTIL=not-a-date',
      '',
    ]
    for (const rrule of foreign) {
      expect(() => parseRrule(rrule, { allDay: true })).toThrow()
    }
  })

  test('the composition and the parse round-trip every frequency', () => {
    const frequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const
    for (const frequency of frequencies) {
      const plain: Recurrence = { frequency }
      expect(parseRrule(composeRrule(plain, { allDay: true }), { allDay: true })).toEqual(plain)
      const bounded: Recurrence = { frequency, until: '2030-12-31' }
      expect(
        parseRrule(composeRrule(bounded, { allDay: false, timezone: 'Asia/Yekaterinburg' }), {
          allDay: false,
          timezone: 'Asia/Yekaterinburg',
        }),
      ).toEqual(bounded)
    }
  })
})

describe('occurrence membership', () => {
  const series: Recurrence = { frequency: 'weekly' }

  test('the series’ own dates are occurrences', () => {
    expect(isOccurrenceDate('2026-01-05', series, '2026-01-05')).toBe(true)
    expect(isOccurrenceDate('2026-01-05', series, '2026-02-16')).toBe(true)
  })

  test('a date off the pattern is not', () => {
    expect(isOccurrenceDate('2026-01-05', series, '2026-01-06')).toBe(false)
    expect(isOccurrenceDate('2026-01-05', series, '2026-01-04')).toBe(false)
    expect(isOccurrenceDate('2026-01-05', series, '2025-12-29')).toBe(false)
  })

  test('until bounds the membership', () => {
    const bounded: Recurrence = { frequency: 'daily', until: '2026-01-10' }
    expect(isOccurrenceDate('2026-01-01', bounded, '2026-01-10')).toBe(true)
    expect(isOccurrenceDate('2026-01-01', bounded, '2026-01-11')).toBe(false)
  })

  test('monthly membership skips the months without the day', () => {
    const monthly: Recurrence = { frequency: 'monthly' }
    expect(isOccurrenceDate('2026-01-31', monthly, '2026-03-31')).toBe(true)
    expect(isOccurrenceDate('2026-01-31', monthly, '2026-02-28')).toBe(false)
    expect(isOccurrenceDate('2026-01-31', monthly, '2026-04-30')).toBe(false)
  })

  test('yearly membership is the month and the day, February 29 only in leap years', () => {
    const yearly: Recurrence = { frequency: 'yearly' }
    expect(isOccurrenceDate('2024-02-29', yearly, '2028-02-29')).toBe(true)
    expect(isOccurrenceDate('2024-02-29', yearly, '2026-02-28')).toBe(false)
    expect(isOccurrenceDate('2026-03-08', yearly, '2027-03-08')).toBe(true)
    expect(isOccurrenceDate('2026-03-08', yearly, '2027-03-09')).toBe(false)
  })

  test('a malformed date is no occurrence', () => {
    expect(isOccurrenceDate('2026-01-05', series, '2026-13-01')).toBe(false)
    expect(isOccurrenceDate('2026-01-05', series, 'not-a-date')).toBe(false)
  })
})

describe('the wall time composition the expansion stands on', () => {
  test('the first occurrence composes like any other', () => {
    // The table derives each series' frame from its first wall pair; this
    // pins that the composition the tests rely on is the one the service
    // stores with (platform/timezone.ts).
    const startsAt = wallTimeToInstant('2026-03-01', '18:00', 'Europe/Berlin')
    expect(startsAt.toISOString()).toBe('2026-03-01T17:00:00.000Z')
  })
})
