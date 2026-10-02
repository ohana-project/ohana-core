import { describe, expect, test } from 'vitest'
import {
  dayOfWeek,
  formatDateOnly,
  formatDayFull,
  formatLocalTime,
  formatZonedTime,
  localDateKey,
  monthGrid,
  nextMonth,
  parseDateOnly,
  previousMonth,
  todayDateOnly,
  zoneDiffersFromDevice,
  zoneLabel,
} from './calendar-dates.ts'

// The device-local answers below are pinned to UTC, whatever zone the
// machine that runs them sits in; the runtime re-reads this between calls.
process.env.TZ = 'UTC'

/*
 * The calendar's date rules (issue #20): the all-day kind's date is read
 * as parts, never through a Date constructor whose UTC reading would shift
 * it a day in the UTC− zones; the month grid is Monday-first; a timed
 * event's moment is read in the device's zone and, beside it, in the
 * zone the event keeps.
 */
describe('parseDateOnly', () => {
  test('reads the parts of a real date', () => {
    expect(parseDateOnly('2026-10-19')).toEqual({ year: 2026, month: 10, day: 19 })
  })

  test('refuses an impossible date or a stray shape', () => {
    expect(parseDateOnly('2026-02-30')).toBeUndefined()
    expect(parseDateOnly('2026-13-01')).toBeUndefined()
    expect(parseDateOnly('2026-00-10')).toBeUndefined()
    expect(parseDateOnly('20261019')).toBeUndefined()
    expect(parseDateOnly('2026-10-19T00:00:00Z')).toBeUndefined()
  })
})

describe('formatDateOnly and todayDateOnly', () => {
  test('round-trips through the parts', () => {
    const today = todayDateOnly(new Date(2026, 9, 2, 23, 55))
    expect(formatDateOnly(today)).toBe(
      `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
    )
  })
})

describe('localDateKey', () => {
  test('places an instant on the device-local day', () => {
    // The tests run with TZ=UTC, where the moment is the 3rd before
    // midnight and the 4th from it.
    expect(localDateKey('2026-10-03T21:00:00.000Z')).toBe('2026-10-03')
    expect(localDateKey('2026-10-03T23:00:00.000Z')).toBe('2026-10-03')
    expect(localDateKey('2026-10-04T00:30:00.000Z')).toBe('2026-10-04')
  })
})

describe('monthGrid', () => {
  test('draws Monday-first six weeks with the neighbours filling the rows', () => {
    const grid = monthGrid(2026, 9) // September 2026 starts on a Tuesday.
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({
      date: { year: 2026, month: 8, day: 31 },
      inMonth: false,
    })
    expect(grid[1]).toEqual({ date: { year: 2026, month: 9, day: 1 }, inMonth: true })
    expect(grid.at(-1)).toEqual({ date: { year: 2026, month: 10, day: 11 }, inMonth: false })
    expect(dayOfWeek({ year: 2026, month: 9, day: 1 })).toBe(1) // Tuesday.
    expect(dayOfWeek({ year: 2026, month: 9, day: 7 })).toBe(0) // Monday.
  })

  test('a month that starts on Monday and spans exactly five weeks still draws six', () => {
    // November 2026 starts on a Sunday (grid position 6) and has 30 days.
    const grid = monthGrid(2026, 11)
    expect(grid).toHaveLength(42)
    expect(grid[6]).toEqual({ date: { year: 2026, month: 11, day: 1 }, inMonth: true })
  })

  test('the year turns with December and January', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 })
  })
})

describe('formatting', () => {
  test('the device-local time and the event zone’s wall time', () => {
    const instant = '2026-10-03T15:00:00.000Z'
    // The test environment runs in UTC.
    expect(formatLocalTime(instant)).toBe('15:00')
    expect(formatZonedTime(instant, 'Europe/Moscow')).toBe('18:00')
    expect(formatZonedTime(instant, 'America/New_York')).toBe('11:00')
  })

  test('the zone label names the city and the offset', () => {
    expect(zoneLabel('Europe/Moscow', new Date('2026-10-03T15:00:00Z'))).toBe('Moscow (UTC+3)')
    expect(zoneLabel('America/New_York', new Date('2026-10-03T15:00:00Z'))).toBe('New York (UTC-4)')
  })

  test('the full date line and the device-zone comparison', () => {
    expect(formatDayFull({ year: 2026, month: 10, day: 3 }, 'ru')).toBe(
      'суббота, 3 октября 2026 г.',
    )
    // The device runs in UTC; Moscow differs, UTC does not.
    expect(zoneDiffersFromDevice('Europe/Moscow', new Date('2026-10-03T15:00:00Z'))).toBe(true)
    expect(zoneDiffersFromDevice('UTC', new Date('2026-10-03T15:00:00Z'))).toBe(false)
  })
})
