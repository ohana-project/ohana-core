import { sql } from 'drizzle-orm'
import {
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
import { administrators } from '../admin/tables.ts'
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

/**
 * Access codes (ADR-0005): one-time 8-character codes an owner or the
 * instance administrator issues for a specific member. Only the SHA-256
 * hash is stored — the plaintext is shown once at issuance. The tables in
 * this module are not synchronised (the administrative area and sign-in
 * are online-only), so they carry no revision and write no tombstones.
 */
export const accessCodes = pgTable(
  'access_codes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The member this code signs in, referenced through the composite key
    // so the database rejects a cross-space reference (ADR-0016).
    memberId: uuid('member_id').notNull(),
    // Exactly one of the two issuers is set (ADR-0005): owners issue codes
    // for their own space, the instance administrator for any space.
    issuerAdministratorId: uuid('issuer_administrator_id').references(() => administrators.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    issuerMemberId: uuid('issuer_member_id'),
    codeHash: text('code_hash').notNull(),
    status: text('status').notNull().default('issued'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // When the row entered its current status.
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('access_codes_code_hash_key').on(table.codeHash),
    unique('access_codes_space_id_id_key').on(table.spaceId, table.id),
    unique('access_codes_space_id_issuer_member_id_key').on(
      table.spaceId,
      table.issuerMemberId,
    ),
    foreignKey({
      name: 'access_codes_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
    foreignKey({
      name: 'access_codes_space_id_issuer_member_id_fk',
      columns: [table.spaceId, table.issuerMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
    check(
      'access_codes_status_allowed',
      sql`${table.status} in ('issued', 'redeemed', 'expired', 'replaced', 'revoked')`,
    ),
    check(
      'access_codes_single_issuer',
      sql`(${table.issuerAdministratorId} is null) <> (${table.issuerMemberId} is null)`,
    ),
  ],
)

/**
 * Member sessions, one per signed-in device (ADR-0005). Only the SHA-256
 * hash of the cookie token is stored. Sessions never authorise anything
 * administrative: administrative routes read a different cookie backed by
 * a different table.
 */
export const memberSessions = pgTable(
  'member_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('member_sessions_token_hash_key').on(table.tokenHash),
    unique('member_sessions_space_id_id_key').on(table.spaceId, table.id),
    index('member_sessions_expires_at_idx').on(table.expiresAt),
    index('member_sessions_member_id_idx').on(table.memberId),
    foreignKey({
      name: 'member_sessions_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type AccessCode = typeof accessCodes.$inferSelect
export type MemberSession = typeof memberSessions.$inferSelect
