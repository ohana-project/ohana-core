import type { StoredJournalEntry, StoredMemberProfile } from '@/data/local-store.ts'

/*
 * The journal's read-side derivation (issue #15): pure selection over the
 * synchronised partition, so the screens answer online and offline from
 * the same code (ADR-0002). The server has already filtered what this
 * member may see — published entries of the space and their own drafts —
 * so nothing here re-decides visibility.
 */

/** The shared feed: published entries, newest first, the API's feed order. */
export function journalFeed(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return entries
    .filter((entry) => entry.state === 'published')
    .sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.id.localeCompare(a.id),
    )
}

/** The author's own drafts, newest edit first — the separate list. */
export function journalDrafts(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return entries
    .filter((entry) => entry.state === 'draft')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
}

export function entryById(
  entries: StoredJournalEntry[],
  entryId: string,
): StoredJournalEntry | undefined {
  return entries.find((entry) => entry.id === entryId)
}

/** One sticky month label's group of the feed (docs/design/screens/diary.html). */
export interface EntryMonthGroup {
  /** The month's number, 1–12, what the label formatter takes. */
  month: number
  year: number
  entries: StoredJournalEntry[]
}

/**
 * The feed under its month labels (issue #69): the prototype groups the
 * diary by the month each entry was shared. The month is the shown
 * moment's — the same clock `entryDay` formats the card's meta line
 * with — so a label never claims a day its cards do not show. The feed
 * arrives newest first, so the groups come out the same way and one
 * group per month follows from contiguity alone.
 */
export function entryMonthGroups(feed: StoredJournalEntry[]): EntryMonthGroup[] {
  const groups: EntryMonthGroup[] = []
  for (const entry of feed) {
    const date = new Date(entryTimestamp(entry))
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const last = groups.at(-1)
    if (last === undefined || last.year !== year || last.month !== month) {
      groups.push({ year, month, entries: [entry] })
    } else {
      last.entries.push(entry)
    }
  }
  return groups
}

/**
 * The entry screen's next-entry line (issue #70, docs/design/screens/
 * diary-entry.html): the published entry the feed reads right after this
 * one. A draft is not in the feed, so it has no next, and neither has the
 * feed's last entry.
 */
export function nextEntryInFeed(
  entries: StoredJournalEntry[],
  entryId: string,
): StoredJournalEntry | undefined {
  const feed = journalFeed(entries)
  const index = feed.findIndex((entry) => entry.id === entryId)
  return index === -1 ? undefined : feed[index + 1]
}

/**
 * The author's display name from the synchronised profiles; the id is the
 * entry's only attribution on the wire, and the profiles travel on their
 * own sync entity, so a rename never leaves entries stale.
 */
export function authorName(
  authorId: string,
  profiles: StoredMemberProfile[],
  fallback: string,
): string {
  const profile = profiles.find((candidate) => candidate.id === authorId)
  return profile?.displayName ?? profile?.name ?? fallback
}

/** The feed's meta line: "21 сентября". */
export function entryDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
    .format(new Date(iso))
    .toLocaleLowerCase(locale)
}

/** The entry screen's meta line: "21 сентября 2026 · 17:40". */
export function entryMoment(iso: string, locale: string): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
  return formatted.toLocaleLowerCase(locale)
}

/** The first lines of an entry for the feed's excerpt. */
export function entryExcerpt(text: string, limit = 160): string {
  const singleSpaced = text.replace(/\s+/g, ' ').trim()
  // Cut by code points, not UTF-16 units: an emoji at the boundary must
  // not leave a lone surrogate before the ellipsis.
  const characters = Array.from(singleSpaced)
  if (characters.length <= limit) return singleSpaced
  return `${characters.slice(0, limit).join('').trimEnd()}…`
}

/** A published entry is shown with the moment it was shared, a draft with its last edit. */
export function entryTimestamp(entry: StoredJournalEntry): string {
  return entry.state === 'published' ? (entry.publishedAt ?? entry.createdAt) : entry.updatedAt
}
