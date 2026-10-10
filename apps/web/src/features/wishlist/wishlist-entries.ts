import type {
  StoredCalendarEvent,
  StoredGiftFavorite,
  StoredGiftReservation,
  StoredMemberProfile,
  StoredWish,
} from '@/data/local-store.ts'
import {
  type CalendarOccurrence,
  eventDateKey,
  SOON_WINDOW_DAYS,
  upcomingEvents,
} from '@/features/calendar/calendar-entries.ts'
import { daysBetweenDateKeys, formatDateOnly } from '@/lib/calendar-dates.ts'

/*
 * The wishlist's read-side derivation (issue #18): pure selection over the
 * synchronised partition, so the screens answer online and offline from
 * the same code (ADR-0002). The server has already scoped every wish to
 * the space — the whole visible wishlist travels to every member — so
 * nothing here re-decides visibility; the only selection is whose wishes
 * and which of them are open.
 */

/** The wishlist's order: creation order, the id breaking same-moment ties. */
function byCreation(a: StoredWish, b: StoredWish): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** One member's wishes, creation order — their wishlist. */
export function wishesOf(wishes: StoredWish[], authorId: string): StoredWish[] {
  return wishes.filter((wish) => wish.authorId === authorId).sort(byCreation)
}

/** The open wishes of one member — what the space browses (issue #18). */
export function openWishesOf(wishes: StoredWish[], authorId: string): StoredWish[] {
  return wishesOf(wishes, authorId).filter((wish) => wish.receivedAt === undefined)
}

export function wishById(wishes: StoredWish[], wishId: string): StoredWish | undefined {
  return wishes.find((wish) => wish.id === wishId)
}

/**
 * The member's display name from the synchronised profiles; the id is the
 * wish's only attribution on the wire, and the profiles travel on their
 * own sync entity, so a rename never leaves a wishlist stale.
 */
export function authorName(
  authorId: string,
  profiles: StoredMemberProfile[],
  fallback: string,
): string {
  const profile = profiles.find((candidate) => candidate.id === authorId)
  return profile?.displayName ?? profile?.name ?? fallback
}

/**
 * The hostname of a wish's link, or undefined when the browser cannot
 * parse it or the `www.` strip leaves nothing (`https://www./x` parses
 * to a hostname that is only the strip itself): either way the chip has
 * no hostname to show.
 */
function linkDomain(link: string): string | undefined {
  try {
    return new URL(link).hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

/**
 * The domain chip's text: the whole hostname, however long — the row
 * wraps it rather than hiding where the link resolves (a cut-off
 * lookalike host is a hazard no truncation direction can fix) — or the
 * raw link when there is no hostname. `URL` already strips a userinfo
 * lookalike: `https://ozon.ru@evil.net/` resolves to `evil.net`, and
 * that is what the chip says.
 */
export function chipDomain(link: string): string {
  return linkDomain(link) ?? link
}

/** The wish list's meta line, for the person screen: "обновлено вчера в 21:04". */
export function wishlistUpdatedAt(wishes: StoredWish[]): string | undefined {
  if (wishes.length === 0) return undefined
  return wishes.reduce((latest, wish) => (wish.updatedAt > latest ? wish.updatedAt : latest), '')
}

/**
 * The localized moment the meta lines name ("25 сентября, 12:00"): the
 * headers' «обновлено …» rides it, lowercased like the prototype's own
 * small print.
 */
export function formatMoment(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .toLocaleLowerCase(locale)
}

/*
 * The gift favorites and the gift reservations (issue #19): pure selection
 * over the synchronised partition, like the wish rules above. The server
 * has already scoped both — a favorite travels to its maker alone, a
 * reservation to every member but the wish's author — so nothing here
 * re-decides visibility; the joining is presentation.
 */

/** The favorites' order: creation order, the id breaking same-moment ties. */
function byFavoriteCreation(a: StoredGiftFavorite, b: StoredGiftFavorite): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/**
 * The member's favorites still worth giving, favorite creation order: the
 * bookmark of an open wish that is present in the partition. A favorite
 * whose wish is absent is skipped — after an applied sync the two live and
 * die in one transaction, so the pair is only ever sighted mid-replay —
 * and a received wish is skipped with its bookmark: the idea was given, it
 * is no longer something to shortlist (issue #19).
 */
export function favoritesWithWishes(
  favorites: StoredGiftFavorite[],
  wishes: StoredWish[],
): Array<{ favorite: StoredGiftFavorite; wish: StoredWish }> {
  const joined: Array<{ favorite: StoredGiftFavorite; wish: StoredWish }> = []
  for (const favorite of [...favorites].sort(byFavoriteCreation)) {
    const wish = wishById(wishes, favorite.wishId)
    if (wish !== undefined && wish.receivedAt === undefined) {
      joined.push({ favorite, wish })
    }
  }
  return joined
}

/** The wish's active reservation, or undefined when the wish is free. */
export function reservationFor(
  reservations: StoredGiftReservation[],
  wishId: string,
): StoredGiftReservation | undefined {
  return reservations.find((reservation) => reservation.wishId === wishId)
}

/*
 * The near birthdays (issue #66): the overview's soon-birthday pills and
 * the aside's birthday note read the calendar's events, because the data
 * model carries no link between an event and a member — a title that
 * carries a birthday word and begins a member's name is all there is.
 * The matching is best-effort by design and claims no more than the
 * titles say: an event that merely names the member («Миша — зубной
 * врач») is no birthday, and a title naming nobody matches no one.
 */

/** How far ahead the overview looks for birthdays: a month of lead time
 *  to pick a gift and reserve it quietly — the product's one «скоро»
 *  window (SOON_WINDOW_DAYS), which the home's event pill shares. */
export const BIRTHDAY_SOON_DAYS = SOON_WINDOW_DAYS

const BIRTHDAY_TITLE_WORDS = ['день рождения', 'birthday'] as const

export interface NearBirthday {
  memberId: string
  /** The birthday's nearest occurrence inside the window. */
  occurrence: CalendarOccurrence
  /** The device-local days from today to the birthday, 0 when it is today. */
  daysUntil: number
  /** The occurrence's device-local day key (YYYY-MM-DD), the one the
   *  count above was computed from. */
  dayKey: string
}

function isBirthdayTitle(title: string): boolean {
  const lowered = title.toLocaleLowerCase()
  return BIRTHDAY_TITLE_WORDS.some((word) => lowered.includes(word))
}

/**
 * Whether a title's word begins the member's name: the first three letters
 * stand at a word's head, so «День рождения Люды» names Люда while «Саня»
 * does not name Аня. Declined forms that shorten the stem («Ани» from
 * «Аня») are a known miss — the honest direction for a guess to fail in.
 */
function titleNamesMember(title: string, name: string): boolean {
  const cleaned = name.trim().toLocaleLowerCase()
  const stem = cleaned.slice(0, Math.min(3, cleaned.length))
  if (stem === '') return false
  const words = title.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
  return words.some((word) => word.startsWith(stem))
}

/**
 * Each active member's nearest birthday inside the month ahead, by member
 * id: a calendar event whose title carries a birthday word and begins the
 * member's name. The occurrences come from the same expansion the agenda
 * reads, so a repeating birthday series answers through its next
 * occurrence; an archived member's birthday is nobody's errand.
 */
export function nearBirthdays(
  events: StoredCalendarEvent[],
  profiles: StoredMemberProfile[],
  now: Date,
): Map<string, NearBirthday> {
  const todayKey = formatDateOnly({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  })
  const near = new Map<string, NearBirthday>()
  for (const occurrence of upcomingEvents(events, now)) {
    const dayKey = eventDateKey(occurrence)
    if (dayKey === undefined) continue
    const daysUntil = daysBetweenDateKeys(todayKey, dayKey)
    // A day key the wall calendar cannot place (a malformed stored date
    // parses to NaN) or one already passing is no birthday ahead.
    if (!(daysUntil >= 0) || daysUntil > BIRTHDAY_SOON_DAYS) continue
    if (!isBirthdayTitle(occurrence.title)) continue
    const member = profiles.find(
      (profile) =>
        profile.archivedAt === undefined && titleNamesMember(occurrence.title, profile.name),
    )
    if (member === undefined) continue
    const existing = near.get(member.id)
    if (existing === undefined || existing.daysUntil > daysUntil) {
      near.set(member.id, { memberId: member.id, occurrence, daysUntil, dayKey })
    }
  }
  return near
}
