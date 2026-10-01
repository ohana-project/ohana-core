import { createHash, randomBytes } from 'node:crypto'
import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { hashPassword, MIN_ADMIN_PASSWORD_LENGTH, verifyPassword } from '../../platform/password.ts'
import { MAX_TRASH_RETENTION_DAYS, MIN_TRASH_RETENTION_DAYS } from './contracts.ts'
import {
  deleteAdminSessionByTokenHash,
  deleteAdminSessionsForAdministrator,
  deleteExpiredAdminSessions,
  getAdministrator,
  getAdministratorById,
  getAdminSessionByTokenHash,
  getInstanceSettings,
  insertAdministratorIfAbsent,
  insertAdminSession,
  updateAdministratorPassword,
  upsertInstanceSettings,
} from './repository.ts'
import type { Administrator } from './tables.ts'

export interface AdminDeps {
  db: Db
  clock: Clock
}

/** The actor attached to authenticated administrative requests. */
export interface AdminActor {
  kind: 'admin'
  administratorId: string
}

const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000

export type BootstrapResult = 'created' | 'exists' | 'unconfigured'

function invalidCredentials(): DomainError {
  return new DomainError('invalid_credentials', 'The password is wrong', 401)
}

function assertPasswordLength(password: string): void {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'password_too_short',
      `The administrative password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long`,
      400,
    )
  }
}

function tokenHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Verifies the password against the administrator's stored hash. */
async function requireAdministrator(
  administrator: Administrator | undefined,
  password: string,
): Promise<Administrator> {
  if (
    administrator === undefined ||
    !(await verifyPassword(password, administrator.passwordHash))
  ) {
    throw invalidCredentials()
  }
  return administrator
}

/**
 * Provisions the first instance administrator from deployment configuration
 * (ADR-0005). An administrator that already exists is never overwritten by
 * configuration; with no administrator and no configured password the server
 * warns and serves until the operator sets one.
 */
export async function ensureInitialAdministrator(
  deps: AdminDeps,
  initialPassword: string | undefined,
): Promise<BootstrapResult> {
  const administrator = await getAdministrator(deps.db)
  if (administrator !== undefined) return 'exists'
  if (initialPassword === undefined) return 'unconfigured'
  const passwordHash = await hashPassword(initialPassword)
  return deps.db.transaction(async (tx) => {
    const created = await insertAdministratorIfAbsent(tx, {
      passwordHash,
      now: deps.clock.now(),
    })
    return created === undefined ? 'exists' : 'created'
  })
}

export interface AdminSessionGrant {
  token: string
  expiresAt: Date
}

export async function signInAdmin(deps: AdminDeps, password: string): Promise<AdminSessionGrant> {
  const administrator = await requireAdministrator(await getAdministrator(deps.db), password)
  const now = deps.clock.now()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_MS)
  await deps.db.transaction(async (tx) => {
    await deleteExpiredAdminSessions(tx, now)
    await insertAdminSession(tx, {
      administratorId: administrator.id,
      tokenHash: tokenHashOf(token),
      now,
      expiresAt,
    })
  })
  return { token, expiresAt }
}

export async function authenticateAdmin(
  deps: AdminDeps,
  token: string | undefined,
): Promise<AdminActor | undefined> {
  if (token === undefined || token.length === 0) return undefined
  const session = await getAdminSessionByTokenHash(deps.db, tokenHashOf(token), deps.clock.now())
  return session === undefined
    ? undefined
    : { kind: 'admin', administratorId: session.administratorId }
}

export async function signOutAdmin(deps: AdminDeps, token: string | undefined): Promise<void> {
  if (token === undefined || token.length === 0) return
  await deps.db.transaction((tx) => deleteAdminSessionByTokenHash(tx, tokenHashOf(token)))
}

/** Changes the password from the administrative area. Ongoing sessions stay valid. */
export async function changeAdminPassword(
  deps: AdminDeps,
  actor: AdminActor,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  assertPasswordLength(newPassword)
  const administrator = await requireAdministrator(
    await getAdministratorById(deps.db, actor.administratorId),
    currentPassword,
  )
  const passwordHash = await hashPassword(newPassword)
  await deps.db.transaction((tx) =>
    updateAdministratorPassword(tx, administrator.id, passwordHash, deps.clock.now()),
  )
}

/**
 * Emergency recovery run from the server (ADR-0005): sets a new password and
 * revokes every administrative session. Creates the administrator when
 * bootstrap has not run yet.
 */
export async function resetAdminPassword(deps: AdminDeps, newPassword: string): Promise<void> {
  assertPasswordLength(newPassword)
  const passwordHash = await hashPassword(newPassword)
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    const existing = await getAdministrator(tx)
    if (existing === undefined) {
      await insertAdministratorIfAbsent(tx, { passwordHash, now })
      return
    }
    await updateAdministratorPassword(tx, existing.id, passwordHash, now)
    await deleteAdminSessionsForAdministrator(tx, existing.id)
  })
}

/*
 * Installation settings (ADR-0007): the trash retention the worker purges
 * by. The settings row may not exist (nothing was ever changed), so reads
 * answer the default ADR-0007 names.
 */

export const DEFAULT_TRASH_RETENTION_DAYS = 30

export interface InstanceSettingsView {
  trashRetentionDays: number
}

/**
 * The trash retention every trash read and the purge job compute with. Runs
 * inside the caller's transaction when one is passed, so a use case that
 * both changes data and derives a date from the setting sees one value.
 */
export async function readTrashRetentionDays(executor: Executor): Promise<number> {
  const settings = await getInstanceSettings(executor)
  return settings?.trashRetentionDays ?? DEFAULT_TRASH_RETENTION_DAYS
}

/** The instance settings as the administrative area reads them. */
export async function getSettings(deps: AdminDeps): Promise<InstanceSettingsView> {
  return { trashRetentionDays: await readTrashRetentionDays(deps.db) }
}

/** Saves the instance settings; unknown fields never reach this surface. */
export async function updateSettings(
  deps: AdminDeps,
  changes: { trashRetentionDays?: number },
): Promise<InstanceSettingsView> {
  const trashRetentionDays = changes.trashRetentionDays
  if (
    trashRetentionDays === undefined ||
    !Number.isInteger(trashRetentionDays) ||
    trashRetentionDays < MIN_TRASH_RETENTION_DAYS ||
    trashRetentionDays > MAX_TRASH_RETENTION_DAYS
  ) {
    throw new DomainError(
      'invalid_trash_retention',
      `Trash retention must be between ${MIN_TRASH_RETENTION_DAYS} and ${MAX_TRASH_RETENTION_DAYS} days`,
      400,
    )
  }
  const saved = await deps.db.transaction((tx) =>
    upsertInstanceSettings(tx, { trashRetentionDays, now: deps.clock.now() }),
  )
  return { trashRetentionDays: saved.trashRetentionDays }
}
