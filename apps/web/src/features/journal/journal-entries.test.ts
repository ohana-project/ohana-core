import { describe, expect, it } from 'vitest'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { journalFeed, nextEntryInFeed } from './journal-entries.ts'

/*
 * The entry screen's footer (issue #70, docs/design/screens/diary-entry.html):
 * the «СЛЕДУЮЩАЯ: …» line names the next entry of the shared feed, so the
 * selection runs over the feed order — published entries, newest first —
 * and a draft, which the feed never carries, has no next.
 */

function entry(overrides: Partial<StoredJournalEntry> & { id: string }): StoredJournalEntry {
  return {
    authorId: '01900000-0000-7000-8000-000000000001',
    text: 'Вид стоит каждого шага.',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  }
}

const NEWEST = entry({ id: 'a', title: 'Поход к Чёртову креслу' })
const MIDDLE = entry({
  id: 'b',
  title: 'Вареники с бабушкой',
  publishedAt: '2026-09-14T10:00:00.000Z',
})
const OLDEST = entry({
  id: 'c',
  title: 'У нас появился Бублик',
  publishedAt: '2026-09-06T10:00:00.000Z',
})

describe('nextEntryInFeed', () => {
  it('names the entry the feed reads next — the one published before it', () => {
    expect(nextEntryInFeed([NEWEST, MIDDLE, OLDEST], NEWEST.id)).toEqual(MIDDLE)
  })

  it('follows the feed order, not the array order', () => {
    expect(nextEntryInFeed([OLDEST, NEWEST, MIDDLE], NEWEST.id)).toEqual(MIDDLE)
  })

  it("has no next from the feed's last entry", () => {
    expect(nextEntryInFeed([NEWEST, MIDDLE, OLDEST], OLDEST.id)).toBeUndefined()
  })

  it('has no next for a draft — the feed never carries it', () => {
    const draft = entry({
      id: 'd',
      title: 'Черновик',
      state: 'draft',
      publishedAt: undefined,
    })
    expect(nextEntryInFeed([NEWEST, draft, MIDDLE], draft.id)).toBeUndefined()
  })

  it('has no next for an entry the partition does not hold', () => {
    expect(nextEntryInFeed([NEWEST, MIDDLE], 'missing')).toBeUndefined()
  })

  it('answers nothing on an empty partition', () => {
    expect(nextEntryInFeed([], NEWEST.id)).toBeUndefined()
  })
})

describe('journalFeed', () => {
  it('keeps only published entries, newest first', () => {
    const draft = entry({ id: 'd', state: 'draft', publishedAt: undefined })
    const feed = journalFeed([OLDEST, draft, NEWEST, MIDDLE])
    expect(feed.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
})
