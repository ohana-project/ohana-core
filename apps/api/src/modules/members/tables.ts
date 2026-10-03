import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { spaces } from '../spaces/tables.ts'

export const memberRoles = ['owner', 'regular'] as const

export const interfaceLanguages = ['ru', 'en'] as const

export const members = pgTable(
  'members',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The provisioned name the administrative area and owners see.
    name: text('name').notNull(),
    // Optional profile fields (ADR-0005): set at onboarding, shown to the
    // member's space as information, never login identifiers.
    displayName: text('display_name'),
    email: text('email'),
    phone: text('phone'),
    interfaceLanguage: text('interface_language').$type<(typeof interfaceLanguages)[number]>(),
    role: text('role').notNull().$type<(typeof memberRoles)[number]>(),
    // Set when the member completes onboarding (ADR-0005); null until the
    // first sign-in, which is what sends a fresh redemption to onboarding.
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    // Set when the member is archived (issue #23, ADR-0005): they can no
    // longer sign in, but their published history and attribution remain,
    // and a new access code restores them while their private state exists.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Set by the private-state purge (issue #23): the drafts and gift
    // favorites are gone, and restoration is no longer offered (ADR-0005).
    privateStatePurgedAt: timestamp('private_state_purged_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Other space-owned tables reference members through this composite key,
    // so the database rejects a cross-space reference (ADR-0016).
    unique('members_space_id_id_key').on(table.spaceId, table.id),
    check('members_role_allowed', sql`${table.role} in ('owner', 'regular')`),
    check('members_interface_language_allowed', sql`${table.interfaceLanguage} in ('ru', 'en')`),
    // The private-state purge's sweep asks across spaces for archived
    // members whose retention has run out — a clearly named maintenance
    // query (architecture.md, "Space scoping").
    index('members_purge_idx')
      .on(table.archivedAt)
      .where(sql`${table.privateStatePurgedAt} is null and ${table.archivedAt} is not null`),
  ],
)

export type Member = typeof members.$inferSelect
