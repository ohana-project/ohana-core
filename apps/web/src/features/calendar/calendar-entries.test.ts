import { describe, expect, test } from 'vitest'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import {
  AGENDA_WINDOW_DAYS,
  calendarOccurrences,
  eventsByDate,
  upcomingEvents,
} from './calendar-entries.ts'

/*
 * The screens' read-side derivation with a repeating event in the
 * partition (issue #21): the series becomes the occurrences the window
 * holds, the cancelled ones skipped, an override standing in its own
 * shoes — and the agenda's window bounds only the repeating series, never
 * a one-time event. The device here is UTC, so a wall date and its local
 * day are the same string and the derivations read plainly.
 */

process.env.TZ = 'UTC'

const NOW = new Date('2026-10-05T12:00:00.000Z')

function stored(event: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: '01900000-0000-7000-8000-000000000421',
    creatorId: '01900000-0000-7000-8000-000000000001',
    title: 'Серия',
    allDay: true,
    date: '2026-10-05',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...event,
  }
}

const ONE_TIME = stored({ id: '01900000-0000-7000-8000-000000000431', title: 'Разовое' })

const WEEKLY = stored({
  id: '01900000-0000-7000-8000-000000000432',
  title: 'Ужин у бабушки',
  allDay: false,
  date: undefined,
  startsAt: '2026-10-05T15:00:00.000Z',
  endsAt: '2026-10-05T18:00:00.000Z',
  timezone: 'Europe/Moscow',
  recurrence: { frequency: 'weekly' },
})

describe('the partition with a series in it (issue #21)', () => {
  test('a one-time event passes through; the series becomes its occurrences', () => {
    const occurrences = calendarOccurrences([ONE_TIME, WEEKLY], '2026-10-01', '2026-10-18')
    expect(occurrences.map((occurrence) => [occurrence.id, occurrence.seriesId])).toEqual([
      [ONE_TIME.id, undefined],
      [`${WEEKLY.id}:2026-10-05`, WEEKLY.id],
      [`${WEEKLY.id}:2026-10-12`, WEEKLY.id],
    ])
    // The occurrence reads as the series does on its date: the same wall
    // time, the same zone, the series' creator.
    const second = occurrences[2]
    expect(second).toMatchObject({
      originalDate: '2026-10-12',
      title: 'Ужин у бабушки',
      allDay: false,
      startsAt: '2026-10-12T15:00:00.000Z',
      endsAt: '2026-10-12T18:00:00.000Z',
      timezone: 'Europe/Moscow',
      creatorId: WEEKLY.creatorId,
    })
  })

  test('a cancelled occurrence is skipped; an override stands in its place', () => {
    const withExceptions: StoredCalendarEvent = {
      ...WEEKLY,
      exceptions: [
        { originalDate: '2026-10-12', kind: 'cancelled' },
        {
          originalDate: '2026-10-19',
          kind: 'override',
          title: 'Поход в театр',
          allDay: true,
          date: '2026-10-19',
        },
      ],
    }
    const occurrences = calendarOccurrences([withExceptions], '2026-10-01', '2026-10-31')
    expect(occurrences.map((occurrence) => occurrence.originalDate)).toEqual([
      '2026-10-05',
      '2026-10-19',
      '2026-10-26',
    ])
    const overridden = occurrences.find((occurrence) => occurrence.originalDate === '2026-10-19')
    expect(overridden).toMatchObject({
      title: 'Поход в театр',
      allDay: true,
      date: '2026-10-19',
      seriesId: WEEKLY.id,
    })
    expect(overridden?.startsAt).toBeUndefined()
  })

  test('the day buckets place the occurrences by the device-local day', () => {
    const byDate = eventsByDate(calendarOccurrences([WEEKLY], '2026-10-01', '2026-10-18'))
    expect([...byDate.keys()]).toEqual(['2026-10-05', '2026-10-12'])
  })
})

describe('the agenda with a series in it (issue #21)', () => {
  test('the series joins the agenda for the season ahead, in day order', () => {
    const upcoming = upcomingEvents([WEEKLY], NOW)
    expect(upcoming.length).toBeGreaterThan(4)
    expect(upcoming[0]).toMatchObject({ originalDate: '2026-10-05', seriesId: WEEKLY.id })
    // Mondays all: the window holds the season's occurrences.
    const dates = upcoming.map((occurrence) => occurrence.originalDate)
    expect(dates).toContain('2026-11-30')
    expect(new Set(dates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay()))).toEqual(
      new Set([1]),
    )
  })

  test('the window bounds the series, never a one-time event', () => {
    const farFuture = stored({
      id: '01900000-0000-7000-8000-000000000433',
      title: 'Далёкий день',
      date: '2027-10-19',
    })
    const upcoming = upcomingEvents([ONE_TIME, farFuture, WEEKLY], NOW)
    // The one-time events answer as always: today's and next year's stand;
    // the series stops at the window's edge.
    expect(upcoming.some((occurrence) => occurrence.id === ONE_TIME.id)).toBe(true)
    expect(upcoming.some((occurrence) => occurrence.id === farFuture.id)).toBe(true)
    const seriesDates = upcoming
      .filter((occurrence) => occurrence.seriesId === WEEKLY.id)
      .map((occurrence) => occurrence.originalDate)
    expect(seriesDates.length).toBeLessThanOrEqual(AGENDA_WINDOW_DAYS / 7 + 1)
    expect(seriesDates).not.toContain('2026-12-14')
  })

  test('a timed occurrence still running from yesterday evening stays', () => {
    const lateCall = stored({
      id: '01900000-0000-7000-8000-000000000434',
      title: 'Ночной созвон',
      allDay: false,
      date: undefined,
      startsAt: '2026-10-04T22:00:00.000Z',
      endsAt: '2026-10-05T02:00:00.000Z',
      timezone: 'Europe/Moscow',
      recurrence: { frequency: 'daily' },
    })
    const upcoming = upcomingEvents([lateCall], new Date('2026-10-05T13:00:00.000Z'))
    // 02:00Z has passed by 13:00Z: the occurrence of today is over and
    // gone from the agenda, and the daily series answers from tomorrow on.
    const dates = upcoming.map((occurrence) => occurrence.originalDate)
    expect(dates[0]).toBe('2026-10-06')
    expect(dates).not.toContain('2026-10-05')
    // The running rule itself: at half past midnight the same occurrence
    // is still on.
    const running = upcomingEvents([lateCall], new Date('2026-10-05T00:30:00.000Z'))
    expect(running.map((occurrence) => occurrence.originalDate)).toContain('2026-10-05')
  })
})
