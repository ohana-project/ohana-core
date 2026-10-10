import type { StoredCalendarEvent, StoredMemberProfile } from '@/data/local-store.ts'
import { formatDateOnly } from '@/lib/calendar-dates.ts'
import { describe, expect, it } from 'vitest'
import { BIRTHDAY_SOON_DAYS, nearBirthdays } from './wishlist-entries.ts'

/*
 * The near-birthday derivation (issue #66): the wishlists overview's pills
 * and note read the calendar's events, because the data model carries no
 * link between an event and a member — a title that carries a birthday
 * word and begins a member's name is all there is. The tests pin what the
 * matching may and may not claim.
 */

const LYUDA: StoredMemberProfile = {
  id: '01900000-0000-7000-8000-000000000003',
  name: 'Люда',
  role: 'regular',
  createdAt: '2026-08-15T10:00:00.000Z',
}
const DIMA: StoredMemberProfile = {
  id: '01900000-0000-7000-8000-000000000002',
  name: 'Дима',
  role: 'regular',
  createdAt: '2026-08-14T10:00:00.000Z',
}

/** The device-local day key `days` from the run's today, normalized
 *  through the calendar so month and year rollovers stay honest. */
function dayKeyFromNow(days: number): string {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return formatDateOnly({ year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate() })
}

function event(overrides?: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: '01900000-0000-7000-8000-000000000401',
    creatorId: DIMA.id,
    title: 'День рождения Люды',
    allDay: true,
    date: dayKeyFromNow(21),
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

describe('nearBirthdays', () => {
  it("finds a member's birthday inside the month ahead, counted in days", () => {
    const near = nearBirthdays([event()], [LYUDA, DIMA], new Date())
    expect(near.get(LYUDA.id)?.daysUntil).toBe(21)
    expect(near.get(LYUDA.id)?.occurrence.title).toBe('День рождения Люды')
    expect(near.has(DIMA.id)).toBe(false)
  })

  it('keeps the soon window at a month', () => {
    expect(BIRTHDAY_SOON_DAYS).toBe(30)
    const far = nearBirthdays(
      [event({ date: dayKeyFromNow(BIRTHDAY_SOON_DAYS + 1) })],
      [LYUDA],
      new Date(),
    )
    expect(far.has(LYUDA.id)).toBe(false)
    const edge = nearBirthdays(
      [event({ date: dayKeyFromNow(BIRTHDAY_SOON_DAYS) })],
      [LYUDA],
      new Date(),
    )
    expect(edge.get(LYUDA.id)?.daysUntil).toBe(BIRTHDAY_SOON_DAYS)
  })

  it('answers a birthday today with zero days', () => {
    const near = nearBirthdays([event({ date: dayKeyFromNow(0) })], [LYUDA], new Date())
    expect(near.get(LYUDA.id)?.daysUntil).toBe(0)
  })

  it('reads a repeating birthday series through its next occurrence', () => {
    const lastYear = dayKeyFromNow(21 - 365)
    const near = nearBirthdays(
      [event({ date: lastYear, recurrence: { frequency: 'yearly' } })],
      [LYUDA],
      new Date(),
    )
    expect(near.get(LYUDA.id)?.daysUntil).toBe(21)
  })

  it('keeps the nearest of several birthday events', () => {
    const near = nearBirthdays(
      [event({ id: 'e1', date: dayKeyFromNow(21) }), event({ id: 'e2', date: dayKeyFromNow(5) })],
      [LYUDA],
      new Date(),
    )
    expect(near.get(LYUDA.id)?.daysUntil).toBe(5)
  })

  it("does not call a member's other events birthdays", () => {
    const near = nearBirthdays(
      [event({ title: 'Люда — зубной врач', date: dayKeyFromNow(3) })],
      [LYUDA],
      new Date(),
    )
    expect(near.has(LYUDA.id)).toBe(false)
  })

  it("does not call a birthday without a member's name", () => {
    const near = nearBirthdays([event({ title: 'День рождения фирмы' })], [LYUDA], new Date())
    expect(near.has(LYUDA.id)).toBe(false)
  })

  it("matches the name at a word's head, not inside one", () => {
    const near = nearBirthdays(
      [event({ title: 'Саня заедет — день рождения семьи' })],
      [LYUDA],
      new Date(),
    )
    expect(near.has(LYUDA.id)).toBe(false)
  })

  it('skips archived members', () => {
    const near = nearBirthdays(
      [event()],
      [{ ...LYUDA, archivedAt: '2026-09-20T10:00:00.000Z' }],
      new Date(),
    )
    expect(near.has(LYUDA.id)).toBe(false)
  })
})
