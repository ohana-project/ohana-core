import { describe, expect, test } from 'vitest'
import { instantToWallTime, wallTimeToInstant, zoneOffsetSeconds } from './timezone.ts'

/*
 * The wall-time composition the calendar's time-zone round trips stand on
 * (issue #20): fixed offsets, the DST changeover in both directions, and
 * the two peculiar wall times a transition creates — the one that does not
 * exist (spring-forward gap) and the one that happens twice (fall-back).
 * The choices are documented on wallTimeToInstant and pinned here.
 */
describe('wallTimeToInstant', () => {
  test('composes a fixed-offset zone', () => {
    // MSK is UTC+3 all year; Novosibirsk UTC+7.
    expect(wallTimeToInstant('2026-10-03', '18:00', 'Europe/Moscow').toISOString()).toBe(
      '2026-10-03T15:00:00.000Z',
    )
    expect(wallTimeToInstant('2026-01-15', '09:00', 'Asia/Novosibirsk').toISOString()).toBe(
      '2026-01-15T02:00:00.000Z',
    )
  })

  test('composes through the DST change in both directions', () => {
    // New York is on summer time (UTC−4) in October and winter time (UTC−5)
    // from the first Sunday of November.
    expect(wallTimeToInstant('2026-10-03', '18:00', 'America/New_York').toISOString()).toBe(
      '2026-10-03T22:00:00.000Z',
    )
    expect(wallTimeToInstant('2026-11-03', '18:00', 'America/New_York').toISOString()).toBe(
      '2026-11-03T23:00:00.000Z',
    )
  })

  test('maps a wall time inside the spring-forward gap forward past the gap', () => {
    // 2026-03-08 02:30 does not exist in New York: the clocks jump 02:00 →
    // 03:00. The composition answers 02:30 EDT — 06:30Z.
    expect(wallTimeToInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    )
  })

  test('maps a repeated wall time to its first occurrence', () => {
    // 2026-11-01 01:30 happens twice in New York. The composition keeps the
    // first (daylight) occurrence — 05:30Z, not the standard-time 06:30Z.
    expect(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    )
  })
})

describe('instantToWallTime', () => {
  test('round-trips an ordinary wall time', () => {
    for (const [date, time, zone] of [
      ['2026-10-03', '18:00', 'Europe/Moscow'],
      ['2026-10-03', '18:00', 'America/New_York'],
      ['2026-11-03', '18:00', 'America/New_York'],
      ['2026-01-15', '09:00', 'Asia/Novosibirsk'],
      ['2026-04-07', '23:05', 'Pacific/Chatham'],
    ] as const) {
      const wall = instantToWallTime(wallTimeToInstant(date, time, zone), zone)
      expect(wall).toEqual({ date, time })
    }
  })
})

describe('zoneOffsetSeconds', () => {
  test('follows the zone’s offset at the instant', () => {
    expect(zoneOffsetSeconds('Europe/Moscow', new Date('2026-10-03T15:00:00Z'))).toBe(3 * 3600)
    expect(zoneOffsetSeconds('America/New_York', new Date('2026-10-03T22:00:00Z'))).toBe(-4 * 3600)
    expect(zoneOffsetSeconds('America/New_York', new Date('2026-11-03T23:00:00Z'))).toBe(-5 * 3600)
  })
})
