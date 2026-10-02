import type { paths } from '@ohana/api-client'

/*
 * The per-member local store (issue #14, architecture.md, web rules):
 * synchronised data lives in IndexedDB, one database per retained member.
 * A sign-out deletes the member's database whole, and nothing of one
 * member's space can surface under another's. The store is read and
 * written through whole-database transactions, so an applied response and
 * its cursor always commit together.
 */

/** The sync endpoint's response, taken from the generated contract (ADR-0013). */
export type SyncResult =
  paths['/api/v1/sync']['get']['responses'][200]['content']['application/json']

export interface StoredSpace {
  id: string
  name: string
  timezone: string
  sections: { journal: boolean; calendar: boolean; wishlist: boolean }
}

export type SectionName = keyof StoredSpace['sections']

export interface StoredMemberProfile {
  id: string
  name: string
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
  role: 'owner' | 'regular'
  createdAt: string
}

/** A journal entry as the sync response carries it (issues #15 and #17). */
export interface StoredJournalEntry {
  id: string
  authorId: string
  title?: string
  text: string
  state: 'draft' | 'published'
  publishedAt?: string
  /** The entry's photos, oldest first; the bytes stream through the API. */
  images?: StoredJournalEntryImage[]
  createdAt: string
  updatedAt: string
}

/** One photo of an entry: its id, the worker's progress, the feed
 *  derivative's pixel size for laying the strip out before bytes arrive,
 *  and what the original is (the viewer offers HEIC and TIFF originals as
 *  a download; a partition synced before issue #17 carries none). */
export interface StoredJournalEntryImage {
  id: string
  state: 'processing' | 'ready' | 'failed'
  width?: number
  height?: number
  originalType?: string
}

/** A wish as the sync response carries it (issue #18). The author names
 *  the wishlist; the details, the link, and the received mark are optional
 *  — a wish without `receivedAt` is open. */
export interface StoredWish {
  id: string
  authorId: string
  title: string
  details?: string
  link?: string
  receivedAt?: string
  createdAt: string
  updatedAt: string
}

/** The member's private gift favorite (issue #19): a bookmark of someone
 *  else's wish, delivered to this member alone. The wish itself travels on
 *  its own entity, so the row is rendered joined with the wish it names. */
export interface StoredGiftFavorite {
  id: string
  wishId: string
  createdAt: string
  updatedAt: string
}

/** A gift reservation (issue #19): a wish's active claim, visible to every
 *  member except the wish's author — the author's partition never holds
 *  one, not even the tombstone of its ending. `memberId` is the reserving
 *  member; the screens name them from the profiles the store holds. */
export interface StoredGiftReservation {
  id: string
  wishId: string
  memberId: string
  createdAt: string
  updatedAt: string
}

/**
 * The recurrence a repeating event keeps (issue #21), the structured shape
 * the wire carries — the frequency and the optional until date (the last
 * day an occurrence may fall on). The stored RRULE text itself never
 * travels; the server has composed it from this shape and answers it back.
 */
export interface StoredEventRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  until?: string
}

/**
 * One original occurrence date changed or cancelled on its own (issue
 * #21). An override carries the replacement whole — an event of its own
 * kind, the series' pattern not applied to it; a cancellation carries
 * nothing: the series skips the date.
 */
export type StoredEventException =
  | { originalDate: string; kind: 'cancelled' }
  | {
      originalDate: string
      kind: 'override'
      title: string
      allDay: true
      date: string
    }
  | {
      originalDate: string
      kind: 'override'
      title: string
      allDay: false
      startsAt: string
      endsAt: string
      timezone: string
    }

/**
 * A calendar event as the sync response carries it (issues #20 and #21).
 * The two kinds keep their own fields: an all-day event carries only
 * `date` — a zoneless `YYYY-MM-DD` that never shifts wherever it is
 * viewed — and a timed event its absolute moments plus the IANA zone it
 * keeps, which the screens render in the device's local time with that
 * zone as the indication. A repeating event carries its recurrence and
 * the exceptions it has accumulated; the device expands the occurrences
 * from this one row, offline included.
 */
export interface StoredEventReminder {
  leadMinutes: number
  recipients: { everyone: true; memberIds?: never } | { memberIds: string[]; everyone?: never }
}

export interface StoredCalendarEvent {
  id: string
  creatorId: string
  title: string
  allDay: boolean
  date?: string
  startsAt?: string
  endsAt?: string
  timezone?: string
  recurrence?: StoredEventRecurrence
  exceptions?: StoredEventException[]
  /** The event's one reminder (issue #22), riding the event's DTO. */
  reminder?: StoredEventReminder
  createdAt: string
  updatedAt: string
}

export interface MemberSnapshot {
  space: StoredSpace | undefined
  members: StoredMemberProfile[]
  entries: StoredJournalEntry[]
  wishes: StoredWish[]
  favorites: StoredGiftFavorite[]
  reservations: StoredGiftReservation[]
  events: StoredCalendarEvent[]
  /** The last revision the device has applied; undefined until the first sync lands. */
  revision: string | undefined
  /** When the last sync succeeded, in epoch milliseconds. */
  syncedAt: number | undefined
  /**
   * The sections whose full data the device has promised to fetch again but
   * has not yet: a re-shown section or a store upgrade wrote the replay
   * promise (cursor '0'), and the replay has not landed (ADR-0014). List
   * screens whose section is here say "nothing downloaded" instead of
   * showing the partial rows an interrupted replay left; a screen showing
   * one row may still show a row it holds — real, the server having
   * filtered it — without claiming anything about the rest.
   */
  pendingReplay: SectionName[]
}

const DB_PREFIX = 'ohana.sync.'

function memberDbName(memberId: string): string {
  // The id is a UUID, so it is safe inside a database name.
  return `${DB_PREFIX}${memberId}`
}

function openMemberDb(memberId: string, create = true): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 2 added the journal entries store (issue #15); version 3 the
    // wishlist's wishes (issue #18); version 4 the gift favorites and the
    // gift reservations (issue #19); version 5 the calendar's events
    // (issue #20). The upgrade runs for fresh databases and for the
    // partitions of members who synced before any existed, so every store
    // creation is guarded.
    const request = indexedDB.open(memberDbName(memberId), 5)
    request.onupgradeneeded = (event) => {
      // The versions travel on the version-change event, not the request.
      const oldVersion = event.oldVersion
      if (!create && oldVersion === 0) {
        // The read path never creates: the database vanished between the
        // listing and this open (a concurrent sign-out), so the honest
        // answer is "nothing stored", not a fresh empty database. A
        // version bump on an existing database is not that: its upgrade
        // runs and the read proceeds.
        request.transaction?.abort()
        return
      }
      const db = request.result
      if (!db.objectStoreNames.contains('space')) db.createObjectStore('space', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('members')) {
        db.createObjectStore('members', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('wishes')) {
        db.createObjectStore('wishes', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('giftFavorites')) {
        db.createObjectStore('giftFavorites', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('giftReservations')) {
        db.createObjectStore('giftReservations', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (oldVersion >= 1 && oldVersion < 5) {
        // The sections whose stores the upgrade passes on its way to
        // version 5: a device that synced before a store existed advanced
        // its cursor while ignoring its changes, so only a replay from 0
        // can deliver them. The journal arrived with version 2, the
        // wishlist's stores with versions 3 and 4 (wishes, then the gift
        // favorites and reservations — one section), and the calendar's
        // events with version 5. Every upgrade — chained jumps included —
        // replays exactly what it never received (ADR-0014).
        const added: SectionName[] = []
        if (oldVersion < 2) added.push('journal')
        if (oldVersion < 4) added.push('wishlist')
        added.push('calendar')
        upgradeReplay(request, added)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Opening the local store failed'))
  })
}

/**
 * The store upgrades' cursor reset (ADR-0014): the upgrade added the
 * `added` sections' stores, so a device that had already advanced its
 * cursor holds none of their rows and only a replay from revision 0 can
 * deliver them. The cursor goes to 0 and the replay promise names the
 * added sections merged with any promise already open (an upgrade can
 * chain: v1 straight to v4 adds the journal and the wishlist in one
 * step), so the screens answer honestly until the replay lands. A
 * partition whose first apply never committed holds no cursor, and stays
 * honestly empty: resetting it would claim data it does not hold.
 */
function upgradeReplay(request: IDBOpenDBRequest, added: SectionName[]): void {
  const meta = request.transaction?.objectStore('meta')
  if (meta === undefined) return
  const read = meta.get('cursor')
  read.onsuccess = () => {
    if (read.result === undefined) return
    const readPromise = meta.get('pendingReplay')
    readPromise.onsuccess = () => {
      meta.put({ key: 'cursor', revision: '0' })
      const stored =
        (readPromise.result?.sections as SectionName[] | undefined) ??
        // No promise row at all means the last apply landed whole.
        []
      const merged = new Set<SectionName>([...stored, ...added])
      meta.put({ key: 'pendingReplay', sections: [...merged] })
    }
  }
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The local store request failed'))
  })
}

/** Reads the member's whole partition; a device without data reads an empty snapshot. */
export async function readMemberSnapshot(memberId: string): Promise<MemberSnapshot> {
  const empty: MemberSnapshot = {
    space: undefined,
    members: [],
    entries: [],
    wishes: [],
    favorites: [],
    reservations: [],
    events: [],
    revision: undefined,
    syncedAt: undefined,
    pendingReplay: [],
  }
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) {
    // Every browser this supports implements both; the guard keeps the
    // empty answer honest where storage does not exist at all.
    return empty
  }
  const names = await indexedDB.databases()
  if (!names.some((database) => database.name === memberDbName(memberId))) {
    return empty
  }
  const db = await openMemberDb(memberId, false).catch((error: unknown) => {
    // A database that vanished mid-read reads as nothing stored. The name
    // check is structural: AbortError is a DOMException, which is not an
    // Error instance in every implementation.
    if ((error as { name?: string } | undefined)?.name === 'AbortError') {
      return undefined
    }
    throw error
  })
  if (db === undefined) {
    return empty
  }
  try {
    const tx = db.transaction(
      [
        'space',
        'members',
        'entries',
        'wishes',
        'giftFavorites',
        'giftReservations',
        'events',
        'meta',
      ],
      'readonly',
    )
    const [spaces, members, entries, wishes, favorites, reservations, events, meta] =
      await Promise.all([
        requestAsPromise(tx.objectStore('space').getAll()),
        requestAsPromise(tx.objectStore('members').getAll()),
        requestAsPromise(tx.objectStore('entries').getAll()),
        requestAsPromise(tx.objectStore('wishes').getAll()),
        requestAsPromise(tx.objectStore('giftFavorites').getAll()),
        requestAsPromise(tx.objectStore('giftReservations').getAll()),
        requestAsPromise(tx.objectStore('events').getAll()),
        requestAsPromise(tx.objectStore('meta').getAll()),
      ])
    const cursor = meta.find((row) => row.key === 'cursor')?.revision as string | undefined
    const syncedAt = meta.find((row) => row.key === 'syncedAt')?.at as number | undefined
    const pendingReplay =
      (meta.find((row) => row.key === 'pendingReplay')?.sections as SectionName[] | undefined) ?? []
    return {
      space: (spaces[0] as StoredSpace | undefined) ?? undefined,
      members: members as StoredMemberProfile[],
      entries: entries as StoredJournalEntry[],
      wishes: wishes as StoredWish[],
      favorites: favorites as StoredGiftFavorite[],
      reservations: reservations as StoredGiftReservation[],
      events: events as StoredCalendarEvent[],
      revision: cursor,
      syncedAt,
      pendingReplay,
    }
  } finally {
    db.close()
  }
}

type MetaRow =
  | { key: 'cursor'; revision: string }
  | { key: 'syncedAt'; at: number }
  | { key: 'pendingReplay'; sections: SectionName[] }

export interface AppliedSync {
  /** The cursor the store holds after the apply. */
  cursor: string
  /** Whether this response is what the store applied. */
  applied: boolean
}

/**
 * Applies a sync response in one transaction: the tombstoned rows go, the
 * upserts land over them, and the cursor is written with both — so an
 * interrupted apply leaves the previous revision and is simply retried,
 * and a row delivered with both an upsert and a tombstone in one response
 * ends up stored.
 *
 * When the new sections map hides a section, the section's rows are
 * dropped in the same transaction (ADR-0011, ADR-0014): the map on the
 * space row is what the client's copy follows. When it shows a section
 * that was hidden before, the cursor is written as 0 instead of the
 * response's revision, and the replay promise names the section: a delta
 * cannot carry rows older than the cursor, so the next sync fetches the
 * section's full data.
 *
 * The apply answers the request the engine sent at `since`: when the
 * stored cursor has moved on (another tab's apply, a run that landed
 * meanwhile), the response is stale — writing it would clobber a replay
 * promise or resurrect dropped rows — and nothing is written; the engine
 * reruns from the stored cursor. The replay promise clears when an apply
 * lands without a re-show, and the re-show's own apply writes the promise
 * with the cursor at 0 — except inside the replay itself, which already
 * carries every section whole, so a re-show there only moves the cursor.
 * The engine always names its `since`; without it (the tests' sequential
 * applies) the staleness guard does not engage.
 */
export async function applySyncResult(
  memberId: string,
  result: SyncResult,
  since?: string,
): Promise<AppliedSync> {
  const db = await openMemberDb(memberId)
  try {
    // The stored cursor is only resolved once the transaction has committed.
    return await new Promise<AppliedSync>((resolve, reject) => {
      const tx = db.transaction(
        [
          'space',
          'members',
          'entries',
          'wishes',
          'giftFavorites',
          'giftReservations',
          'events',
          'meta',
        ],
        'readwrite',
      )
      const spaceStore = tx.objectStore('space')
      const memberStore = tx.objectStore('members')
      const entryStore = tx.objectStore('entries')
      const wishStore = tx.objectStore('wishes')
      const favoriteStore = tx.objectStore('giftFavorites')
      const reservationStore = tx.objectStore('giftReservations')
      const eventStore = tx.objectStore('events')
      const metaStore = tx.objectStore('meta')
      let storedRevision = result.revision
      let applied = true

      // The previous map and replay promise are read before anything is
      // written, so the hidden-to-visible decision sees the state the
      // device had. The reads run in order: a request's result is only its
      // own once that request has succeeded.
      const metaRequest = metaStore.getAll()
      metaRequest.onsuccess = () => {
        const metaRows = metaRequest.result as MetaRow[]
        const storedCursor = metaRows.find((row) => row.key === 'cursor')?.revision ?? '0'
        if (since !== undefined && storedCursor !== since) {
          // Stale: the store no longer sits on the cursor this request was
          // sent from (another tab's apply, a run that landed meanwhile).
          // Nothing of it may land — write nothing, and hand the engine the
          // stored cursor so its rerun asks for what the store now needs.
          applied = false
          storedRevision = storedCursor
          return
        }
        const previousRequest = spaceStore.getAll()
        previousRequest.onsuccess = () => {
          const previous = previousRequest.result[0] as StoredSpace | undefined

          // Tombstones go first: within one response, an upsert of a row is
          // the newer fact (the contributor's rows are what exists now), so
          // it must outrank a tombstone of the same row — a resync from
          // revision 0 replays the space's whole tombstone history.
          for (const tombstone of result.tombstones) {
            if (tombstone.entity === 'member') memberStore.delete(tombstone.entityId)
            if (tombstone.entity === 'journal_entry') entryStore.delete(tombstone.entityId)
            if (tombstone.entity === 'wishlist_wish') wishStore.delete(tombstone.entityId)
            if (tombstone.entity === 'wishlist_gift_favorite') {
              favoriteStore.delete(tombstone.entityId)
            }
            if (tombstone.entity === 'wishlist_gift_reservation') {
              reservationStore.delete(tombstone.entityId)
            }
            if (tombstone.entity === 'calendar_event') eventStore.delete(tombstone.entityId)
          }
          for (const change of result.changes) {
            if (change.entity === 'space') spaceStore.put(change.space)
            if (change.entity === 'member') memberStore.put(change.member)
            if (change.entity === 'journal_entry') entryStore.put(change.entry)
            if (change.entity === 'wishlist_wish') wishStore.put(change.wish)
            if (change.entity === 'wishlist_gift_favorite') favoriteStore.put(change.favorite)
            if (change.entity === 'wishlist_gift_reservation') {
              reservationStore.put(change.reservation)
            }
            if (change.entity === 'calendar_event') eventStore.put(change.event)
          }

          let revision = result.revision
          const nextSpace = result.changes.find((change) => change.entity === 'space')
          if (nextSpace !== undefined) {
            if (!nextSpace.space.sections.journal) entryStore.clear()
            if (!nextSpace.space.sections.wishlist) {
              wishStore.clear()
              favoriteStore.clear()
              reservationStore.clear()
            }
            if (!nextSpace.space.sections.calendar) eventStore.clear()
          }
          // A re-shown section writes the replay promise: the cursor goes
          // to 0 and the section's full data has to come again before the
          // screens may claim it (ADR-0014). The promise is per section, so
          // another section's replay never questions this one's rows, and
          // any apply that lands without a re-show — the replay above all,
          // which carries every section whole — clears the promises with
          // its cursor.
          const reshowed = (Object.keys(previous?.sections ?? {}) as SectionName[]).filter(
            (section) =>
              previous !== undefined &&
              nextSpace !== undefined &&
              !previous.sections[section] &&
              nextSpace.space.sections[section],
          )
          if (reshowed.length > 0 && since !== '0') revision = '0'
          // The replay response carries every section whole, so a re-show
          // inside it opens no promise of its own: the cursor moves and
          // nothing stays owed.
          const pendingReplay: SectionName[] = revision === '0' ? reshowed : []
          storedRevision = revision
          const cursor: MetaRow = { key: 'cursor', revision }
          const stamped: MetaRow = { key: 'syncedAt', at: Date.now() }
          metaStore.put(cursor)
          metaStore.put(stamped)
          metaStore.put({ key: 'pendingReplay', sections: pendingReplay })
        }
        previousRequest.onerror = () =>
          reject(previousRequest.error ?? new Error('The read failed'))
      }
      metaRequest.onerror = () => reject(metaRequest.error ?? new Error('The read failed'))
      tx.oncomplete = () => resolve({ cursor: storedRevision, applied })
      tx.onerror = () => reject(tx.error ?? new Error('Applying the sync result failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Applying the sync result was aborted'))
    })
  } finally {
    db.close()
  }
}

/** Removes the member's whole partition — the sign-out cleanup (ADR-0005). */
export function deleteMemberData(memberId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(memberDbName(memberId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Deleting the local store failed'))
    request.onblocked = () => resolve()
  })
}
