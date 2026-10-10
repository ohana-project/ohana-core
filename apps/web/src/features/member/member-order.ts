import type { StoredMemberProfile } from '@/data/local-store.ts'

/*
 * The stack's order (issue #62): the active members, the owner leading,
 * then the elders by creation. The store reads rows in key order, so the
 * order is decided here, not by the storage. One place answers for every
 * display that stacks a space's members — the member shell's switcher and
 * the spaces sheet and accounts rows (issue #64) — so the two can never
 * disagree.
 */
export function orderedActiveMembers(profiles: StoredMemberProfile[]): StoredMemberProfile[] {
  return profiles
    .filter((profile) => profile.archivedAt === undefined)
    .sort((a, b) => {
      if ((a.role === 'owner') !== (b.role === 'owner')) return a.role === 'owner' ? -1 : 1
      // ISO timestamps and UUIDs order by code unit; a locale collation
      // would only add a table lookup between equal forms.
      return a.createdAt === b.createdAt
        ? a.id < b.id
          ? -1
          : 1
        : a.createdAt < b.createdAt
          ? -1
          : 1
    })
}
