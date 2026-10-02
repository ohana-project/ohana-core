import { describe, expect, test } from 'vitest'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import { eventDateKey } from '@/features/calendar/calendar-entries.ts'
import {
  formatDayLong,
  formatMonthTitle,
  localDateKey,
  zoneDiffersFromDevice,
} from './calendar-dates.ts'

/*
 * The calendar's date rules away from UTC (issue #20): the acceptance
 * criterion pins an all-day event's date wherever the device sits, so the
 * same derivations are read again from a negative-offset zone, where a
 * `new Date('2026-10-19')` regression would pull the birthday to the 18th.
 * The device here is Los Angeles.
 */

process.env.TZ = 'America/Los_Angeles'

const BIRTHDAY: StoredCalendarEvent = {
  id: '01900000-0000-7000-8000-000000000411',
  creatorId: '01900000-0000-7000-8000-000000000001',
  title: 'День рождения Люды',
  allDay: true,
  date: '2026-10-19',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
}

describe('calendar dates in America/Los_Angeles', () => {
  test('an all-day event keeps its date; the device never shifts it', () => {
    expect(eventDateKey(BIRTHDAY)).toBe('2026-10-19')
    expect(localDateKey('2026-10-19T05:00:00.000Z')).toBe('2026-10-18')
  })

  test('the zoneless labels are the date itself, not the device’s reading of its midnight', () => {
    // The formatters anchor the date at its UTC midnight deliberately: an
    // unanchored label would read Oct 19 as Oct 18 here, and the October
    // heading as September.
    expect(formatDayLong({ year: 2026, month: 10, day: 19 }, 'ru')).toBe('19 октября')
    expect(formatMonthTitle(2026, 10, 'ru')).toBe('Октябрь 2026')
  })

  test('a timed event lands on the device-local day', () => {
    // Midnight in Los Angeles is 07:00Z in October (PDT): a call at 06:30Z
    // is 23:30 of the evening before, and the grid places it on the 18th
    // while its RFC 3339 string still says the 19th.
    const lateCall: StoredCalendarEvent = {
      ...BIRTHDAY,
      id: '01900000-0000-7000-8000-000000000412',
      title: 'Созвон',
      allDay: false,
      startsAt: '2026-10-19T06:30:00.000Z',
      endsAt: '2026-10-19T07:00:00.000Z',
      date: undefined,
    }
    expect(eventDateKey(lateCall)).toBe('2026-10-18')
  })

  test('the zone indication compares offsets, and equals mean no flag', () => {
    // The device runs Pacific time: the same-offset zone reads the same,
    // Moscow differs.
    expect(zoneDiffersFromDevice('America/Los_Angeles')).toBe(false)
    expect(zoneDiffersFromDevice('Europe/Moscow', new Date('2026-10-19T12:00:00.000Z'))).toBe(true)
    expect(zoneDiffersFromDevice('UTC', new Date('2026-10-19T12:00:00.000Z'))).toBe(true)
  })
})
