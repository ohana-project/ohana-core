import { describe, expect, test } from 'vitest'
import { wallTimeToInstant, zoneOffsetSeconds } from './timezone.ts'

/*
 * The wall-time composition the calendar's time-zone round trips stand on
 * (issue #20): fixed offsets, the DST changeover in both directions, and
 * the two peculiar wall times a transition creates — the one that does not
 * exist (spring-forward gap) and the one that happens twice (fall-back) —
 * east and west of UTC both, since the transitions run opposite ways. The
 * choices are documented on wallTimeToInstant and pinned here.
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
    // Berlin turned the other way a week earlier: summer time (UTC+2) in
    // early October, winter time (UTC+1) past the change.
    expect(wallTimeToInstant('2026-10-03', '18:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-03T16:00:00.000Z',
    )
    expect(wallTimeToInstant('2026-11-03', '18:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-11-03T17:00:00.000Z',
    )
  })

  test('maps a wall time inside the spring-forward gap forward past the gap, west of UTC', () => {
    // 2026-03-08 02:30 does not exist in New York: the clocks jump 02:00 →
    // 03:00. The composition answers 03:30 EDT — the wall reading the gap
    // leaves behind — 07:30Z.
    expect(wallTimeToInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    )
  })

  test('maps a wall time inside the spring-forward gap forward past the gap, east of UTC', () => {
    // Berlin jumps 02:00 → 03:00 CET → CEST on 2026-03-29, a transition at
    // 01:00Z. The nonexistent 02:30 answers 03:30 CEST — 01:30Z.
    expect(wallTimeToInstant('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })

  test('maps a repeated wall time to its first occurrence, west of UTC', () => {
    // 2026-11-01 01:30 happens twice in New York. The composition keeps the
    // first (daylight) occurrence — 05:30Z, not the standard-time 06:30Z.
    expect(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    )
  })

  test('maps a repeated wall time to its first occurrence, east of UTC', () => {
    // Berlin falls back 03:00 CEST → 02:00 CET on 2026-10-25 (01:00Z), so
    // 02:30 happens twice: 00:30Z (summer) and 01:30Z (winter). The first
    // — the summer one — wins.
    expect(wallTimeToInstant('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    )
  })

  test('reads the southern hemisphere’s opposite transitions', () => {
    // Sydney springs forward on 2026-10-04 (02:30 does not exist: the
    // answer is 03:30 AEDT, 16:30Z on the 3rd in UTC terms — wait, the
    // clocks jump 02:00 → 03:00 at 16:00Z on the 3rd), and falls back on
    // 2026-04-05, where 02:30 repeats and the first (AEDT) one wins.
    expect(wallTimeToInstant('2026-10-04', '02:30', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-03T16:30:00.000Z',
    )
    expect(wallTimeToInstant('2026-04-05', '02:30', 'Australia/Sydney').toISOString()).toBe(
      '2026-04-04T15:30:00.000Z',
    )
  })

  test('reads the zone’s offset at an instant', () => {
    expect(zoneOffsetSeconds('Europe/Moscow', new Date('2026-10-03T15:00:00Z'))).toBe(3 * 3600)
    expect(zoneOffsetSeconds('America/New_York', new Date('2026-10-03T22:00:00Z'))).toBe(-4 * 3600)
    expect(zoneOffsetSeconds('America/New_York', new Date('2026-11-03T23:00:00Z'))).toBe(-5 * 3600)
  })
})
