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
