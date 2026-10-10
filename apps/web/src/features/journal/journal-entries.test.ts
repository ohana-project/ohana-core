import { describe, expect, it } from 'vitest'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { entryMonthGroups, journalFeed } from './journal-entries.ts'

/*
 * The feed's read-side derivation (issue #15) and, since the design-parity
 * pass (issue #69), its month grouping: the sticky month labels
 * (docs/design/screens/diary.html) group the published feed by the month
 * its cards already show.
 */

function entry(overrides?: Partial<StoredJournalEntry>): StoredJournalEntry {
  return {
    id: `01900000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
    authorId: '01900000-0000-7000-8000-000000000001',
    title: 'Запись',
    text: 'Текст записи',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
    images: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  }
}

describe('entryMonthGroups', () => {
  it('groups the feed into months, newest month first', () => {
    const september = entry({ publishedAt: '2026-09-21T14:00:00.000Z' })
    const august = entry({ publishedAt: '2026-08-30T14:00:00.000Z' })
    // The feed is newest first, so the raw order is already grouped.
    const groups = entryMonthGroups(journalFeed([august, september]))

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ year: 2026, month: 9 })
    expect(groups[0]?.entries).toEqual([september])
    expect(groups[1]).toMatchObject({ year: 2026, month: 8 })
    expect(groups[1]?.entries).toEqual([august])
  })

  it('keeps one group per month with the feed order inside it', () => {
    const newest = entry({ title: 'Новая', publishedAt: '2026-09-21T14:00:00.000Z' })
    const middle = entry({ title: 'Средняя', publishedAt: '2026-09-06T14:00:00.000Z' })
    const june = entry({ title: 'Июньская', publishedAt: '2026-06-01T14:00:00.000Z' })
    const groups = entryMonthGroups(journalFeed([june, middle, newest]))

    expect(groups).toHaveLength(2)
    expect(groups[0]?.entries.map((row) => row.title)).toEqual(['Новая', 'Средняя'])
    expect(groups[1]?.entries.map((row) => row.title)).toEqual(['Июньская'])
  })

  it('splits December and January across the year boundary', () => {
    const january = entry({ publishedAt: '2026-01-04T14:00:00.000Z' })
    const december = entry({ publishedAt: '2025-12-28T14:00:00.000Z' })
    const groups = entryMonthGroups(journalFeed([december, january]))

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ year: 2026, month: 1 })
    expect(groups[1]).toMatchObject({ year: 2025, month: 12 })
  })

  it('answers no groups for an empty feed', () => {
    expect(entryMonthGroups([])).toEqual([])
  })
})
