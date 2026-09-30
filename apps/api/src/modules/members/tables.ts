import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
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
  ],
)

export type Member = typeof members.$inferSelect
