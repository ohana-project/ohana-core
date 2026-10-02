import type { StoredMemberProfile, StoredWish } from '@/data/local-store.ts'

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

/** The hostname of a wish's link for the row's domain chip; a malformed
 *  link (the API's contract already refuses most) shows as it is. */
export function linkDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}

/** The wish list's meta line, for the person screen: "обновлено вчера в 21:04". */
export function wishlistUpdatedAt(wishes: StoredWish[]): string | undefined {
  if (wishes.length === 0) return undefined
  return wishes.reduce((latest, wish) => (wish.updatedAt > latest ? wish.updatedAt : latest), '')
}
