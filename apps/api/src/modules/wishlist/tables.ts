import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

/**
 * A wish (issue #18, CONTEXT.md): something a member would like for
 * themselves, recorded in their wishlist and visible to the whole space.
 * The details and the link are optional; the link is an http(s) URL when
 * present — the contracts refuse everything else at the door, and the
 * check keeps a hand-written UPDATE from storing anything else. A wish is
 * open until its author marks it received; `received_at` carries that
 * moment, and null means open.
 */
export const wishes = pgTable(
  'wishes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The wish's author is the only member who may edit, remove, or mark it
    // received (issue #18); the composite foreign key keeps the reference
    // inside one space (ADR-0016).
    authorMemberId: uuid('author_member_id').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    link: text('link'),
    // Set when the author marks the wish received; null while it is open.
    receivedAt: timestamp('received_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('wishes_space_id_id_key').on(table.spaceId, table.id),
    check(
      'wishes_link_is_http_url',
      sql`${table.link} is null or ${table.link} ~ '^https?://[^[:space:]]+$'`,
    ),
    // The per-member wishlist reads by author; the space-wide browse reads
    // every author's wishes in creation order.
    index('wishes_author_idx').on(table.spaceId, table.authorMemberId, table.createdAt),
    // The sync contributor's delta scans one space's rows past a revision.
    index('wishes_sync_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'wishes_space_id_author_member_id_fk',
      columns: [table.spaceId, table.authorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type Wish = typeof wishes.$inferSelect

/**
 * A gift favorite (issue #19, CONTEXT.md): a member's private bookmark of
 * someone else's wish as a possible gift. Only the member who made it ever
 * sees it — the routes and the sync contributor deliver it to that member
 * alone (policy.ts) — and it reserves nothing. The row carries no state:
 * un-favoriting deletes it, and the member-scoped tombstone the delete
 * writes carries it out of that one member's devices.
 */
export const giftFavorites = pgTable(
  'gift_favorites',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The member whose private bookmark this is. The composite foreign keys
    // keep every reference inside one space (ADR-0016).
    memberId: uuid('member_id').notNull(),
    wishId: uuid('wish_id').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('gift_favorites_space_id_id_key').on(table.spaceId, table.id),
    // One favorite per member per wish: the bookmark is a toggle, and the
    // unique index is the race-free statement of that.
    unique('gift_favorites_member_wish_key').on(table.spaceId, table.memberId, table.wishId),
    // The owner's listing reads by member in creation order; the sync
    // contributor's delta scans one member's rows past a revision.
    index('gift_favorites_member_idx').on(table.spaceId, table.memberId, table.createdAt),
    // The wish's removal deletes the wish's favorites and tombstones each
    // favoriter's own.
    index('gift_favorites_wish_idx').on(table.spaceId, table.wishId),
    // The sync contributor's delta scans one space's rows past a revision.
    index('gift_favorites_sync_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'gift_favorites_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
    foreignKey({
      name: 'gift_favorites_space_id_wish_id_fk',
      columns: [table.spaceId, table.wishId],
      foreignColumns: [wishes.spaceId, wishes.id],
    }),
  ],
)

export type GiftFavorite = typeof giftFavorites.$inferSelect

/**
 * A gift reservation (issue #19, CONTEXT.md): a member's claim that they
 * intend to give a particular wish, visible to every member except the
 * wish's author, so that relatives do not buy the same gift. The row
 * exists exactly while the reservation is active — cancelling it, marking
 * the wish received, or removing the wish deletes it — so the unique index
 * on the wish is the "at most one active reservation" rule, race-free.
 * The member-scoped tombstones the deletion writes reach every member
 * except the author, who never learns a reservation existed.
 */
export const giftReservations = pgTable(
  'gift_reservations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The member who reserved the wish — the only one who can cancel.
    memberId: uuid('member_id').notNull(),
    wishId: uuid('wish_id').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('gift_reservations_space_id_id_key').on(table.spaceId, table.id),
    // At most one active reservation per wish (issue #19): two members
    // reaching for the same free wish cannot both hold it.
    unique('gift_reservations_wish_key').on(table.spaceId, table.wishId),
    // The sync contributor's delta scans one space's rows past a revision;
    // the visible listing joins the wish for its author.
    index('gift_reservations_sync_idx').on(table.spaceId, table.revision),
    // The wish's received mark and the wish's removal both end the
    // reservation (issue #19) and tombstone it per member.
    index('gift_reservations_wish_idx').on(table.spaceId, table.wishId),
    foreignKey({
      name: 'gift_reservations_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
    foreignKey({
      name: 'gift_reservations_space_id_wish_id_fk',
      columns: [table.spaceId, table.wishId],
      foreignColumns: [wishes.spaceId, wishes.id],
    }),
  ],
)

export type GiftReservation = typeof giftReservations.$inferSelect
