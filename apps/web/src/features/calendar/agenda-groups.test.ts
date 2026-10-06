import { describe, expect, it } from 'vitest'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import { agendaGroups } from './agenda-groups.ts'
import type { CalendarOccurrence } from './calendar-entries.ts'

/*
 * The agenda's grouping (issue #73): the prototype draws «Сегодня» always —
 * a muted row when the day is empty —, «Завтра» when it holds events, and
 * the rest as month groups with the prototype's dated labels. The grouping
 * is a pure pass over the upcoming list, so the screen only renders it.
 */

// The timed kind reads the device-local day; pinned to UTC, like the
// screens' tests, so the local answers are deterministic.
process.env.TZ = 'UTC'

const TODAY = { year: 2026, month: 10, day: 1 }

let nextId = 0

function timed(startsAt: string, overrides?: Partial<StoredCalendarEvent>): CalendarOccurrence {
  nextId += 1
  return {
    id: `event-${nextId}`,
    creatorId: 'member-1',
    title: `Событие ${nextId}`,
    allDay: false,
    startsAt,
    endsAt: startsAt.replace('10:00', '11:00'),
    timezone: 'Europe/Moscow',
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

function allDay(date: string, overrides?: Partial<StoredCalendarEvent>): CalendarOccurrence {
  nextId += 1
  return {
    id: `event-${nextId}`,
    creatorId: 'member-1',
    title: `Событие ${nextId}`,
    allDay: true,
    date,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

/** The group at `index`, or a failure — indexed access reads easier in
 *  these assertions than `at()`'s undefined. */
function group(groups: ReturnType<typeof agendaGroups>, index: number) {
  const found = groups[index]
  if (found === undefined) throw new Error(`no group at ${index}`)
  return found
}

describe('agendaGroups', () => {
  it('today comes first even when empty; tomorrow only when it holds events', () => {
    const groups = agendaGroups([allDay('2026-10-19')], TODAY)
    expect(groups).toHaveLength(2)
    expect(group(groups, 0)).toMatchObject({ kind: 'today', events: [] })
    expect(group(groups, 1)).toMatchObject({ kind: 'month' })
    expect(group(groups, 1).date).toEqual({ year: 2026, month: 10, day: 19 })
  })

  it('today, tomorrow, then the month groups in the order the days come', () => {
    const groups = agendaGroups(
      [
        timed('2026-10-01T10:00:00.000Z'),
        timed('2026-10-02T10:00:00.000Z'),
        allDay('2026-10-19'),
        timed('2026-11-05T10:00:00.000Z'),
      ],
      TODAY,
    )
    expect(groups.map((entry) => entry.kind)).toEqual(['today', 'tomorrow', 'month', 'month'])
    expect(group(groups, 0).events).toHaveLength(1)
    expect(group(groups, 1).events).toHaveLength(1)
    expect(group(groups, 2).events).toHaveLength(1)
    expect(group(groups, 3).date).toEqual({ year: 2026, month: 11, day: 5 })
  })

  it('a day with several events keeps the day order inside its group', () => {
    // The day's own order, as `upcomingEvents` hands it over: the all-day
    // event at the front, then the timed ones by their start.
    const groups = agendaGroups(
      [allDay('2026-10-02'), timed('2026-10-02T10:00:00.000Z'), timed('2026-10-02T18:00:00.000Z')],
      TODAY,
    )
    expect(groups).toHaveLength(2)
    expect(group(groups, 1).events.map((event) => event.allDay)).toEqual([true, false, false])
    expect(group(groups, 1).events[2]?.startsAt).toBe('2026-10-02T18:00:00.000Z')
  })

  it('an event still running from yesterday joins its own month group', () => {
    const groups = agendaGroups(
      [
        timed('2026-09-30T23:00:00.000Z', { endsAt: '2026-10-01T02:00:00.000Z' }),
        timed('2026-10-19T10:00:00.000Z'),
      ],
      TODAY,
    )
    // Today's group opens the agenda (empty); September's running event is
    // grouped by its own month, ahead of October's days.
    expect(groups.map((entry) => entry.kind)).toEqual(['today', 'month', 'month'])
    expect(group(groups, 1).date).toEqual({ year: 2026, month: 9, day: 30 })
    expect(group(groups, 2).date).toEqual({ year: 2026, month: 10, day: 19 })
  })
})
