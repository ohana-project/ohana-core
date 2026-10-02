import { sql } from 'drizzle-orm'
import {
  boolean,
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
 * The installation's Web Push identity (issue #22, ADR-0006): the VAPID
 * key pair every push this installation sends is signed with. The pair is
 * generated on first start and persisted — a browser that subscribed once
 * must keep meeting the same application server key, or its subscriptions
 * die. Not a space-owned table: exactly one row per installation, which
 * the `singleton` unique index and its CHECK enforce, the instance
 * administrator's precedent.
 */
export const pushVapidKeys = pgTable(
  'push_vapid_keys',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    singleton: boolean('singleton').notNull().default(true),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('push_vapid_keys_singleton_key').on(table.singleton),
    check('push_vapid_keys_singleton_true', sql`${table.singleton}`),
    check(
      'push_vapid_keys_non_empty',
      sql`length(${table.publicKey}) > 0 and length(${table.privateKey}) > 0`,
    ),
  ],
)

/**
 * A device's push subscription (issue #22): one row per browser endpoint
 * a member enabled notifications on, after the user gesture the browser
 * requires. The row is the device as the reminders know it — it carries
 * the endpoint the push service delivers to and the device's own opt-in
 * to showing event details, so two devices of one member answer
 * differently without asking either.
 *
 * Not a synchronised table (the access module's precedent): the
 * subscription lives on this device alone, no other device's store has
 * any use for it, so there is no revision and no tombstone — a device
 * that leaves deletes its own row, and an expired endpoint is removed by
 * the sender that discovered it.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The member notifications are enabled for, through the composite key
    // so the database rejects a cross-space reference (ADR-0016).
    memberId: uuid('member_id').notNull(),
    /** The push service's endpoint URL — the device's address for pushes. */
    endpoint: text('endpoint').notNull(),
    /** The subscription's encryption keys, base64url (RFC 8291). */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /**
     * The device's own opt-in (ADR-0006): false, the reminders arrive with
     * neutral wording only; true, they name the event and its time.
     */
    notifyDetails: boolean('notify_details').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // One subscription per member and endpoint: a re-subscription is the
    // update, never a second row.
    unique('push_subscriptions_member_endpoint_key').on(
      table.spaceId,
      table.memberId,
      table.endpoint,
    ),
    index('push_subscriptions_member_idx').on(table.spaceId, table.memberId),
    foreignKey({
      name: 'push_subscriptions_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type PushVapidKeysRow = typeof pushVapidKeys.$inferSelect
