import type {
  StoredGiftFavorite,
  StoredGiftReservation,
  StoredMemberProfile,
  StoredWish,
} from '@/data/local-store.ts'

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
 * The member's favorites with the wishes they name, favorite creation
 * order. A favorite whose wish is absent is skipped: after an applied sync
 * the two live and die in one transaction, so the pair is only ever
 * sighted mid-replay, and a bookmark without its wish has nothing to show.
 */
export function favoritesWithWishes(
  favorites: StoredGiftFavorite[],
  wishes: StoredWish[],
): Array<{ favorite: StoredGiftFavorite; wish: StoredWish }> {
  const joined: Array<{ favorite: StoredGiftFavorite; wish: StoredWish }> = []
  for (const favorite of [...favorites].sort(byFavoriteCreation)) {
    const wish = wishById(wishes, favorite.wishId)
    if (wish !== undefined) joined.push({ favorite, wish })
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
