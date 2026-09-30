import { createHash, randomBytes } from 'node:crypto'
import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { getSpace, getSpaceInTx, lockSpace } from '../spaces/index.ts'
import type { AccessCodeStatus } from './contracts.ts'
import {
  deleteExpiredMemberSessionsAcrossSpaces,
  deleteMemberSessionById,
  deleteMemberSessionByTokenHashAcrossSpaces,
  expireAccessCodeRow,
  findAccessCodeByHashAcrossSpaces,
  findMemberSessionByTokenHashAcrossSpaces,
  getAccessCodeRow,
  insertAccessCode,
  insertMemberSession,
  listAccessCodesInSpace,
  listLiveMemberSessionsForMember,
  redeemAccessCodeByHashAcrossSpaces,
  revokeAccessCodeRow,
  sweepMemberCodesForIssue,
  touchMemberSessionByTokenHashAcrossSpaces,
} from './repository.ts'
import type { AccessCode, MemberSession } from './tables.ts'

export interface AccessDeps {
  db: Db
  clock: Clock
  /**
   * The member lookup the port covers for the members module, which sits
   * above access in the dependency order (architecture.md, "Composition"):
   * the composition root wires it to the members module's read.
   */
  findMemberInSpace(
    executor: Executor,
    spaceId: string,
    memberId: string,
  ): Promise<MemberAccount | undefined>
}

/** The member data access needs, kept structural so members satisfies it. */
export interface MemberAccount {
  id: string
  spaceId: string
  role: 'owner' | 'regular'
  name: string
  displayName: string | null
  onboardedAt: Date | null
}

/** The actor attached to authenticated member requests. */
export interface MemberActor {
  kind: 'member'
  memberId: string
  spaceId: string
  role: 'owner' | 'regular'
  /** The session that authorised the request, for the device review. */
  sessionId: string
}

/*
 * Codes are the only anti-guessing defence (ADR-0005): eight characters
 * from a 32-symbol alphabet without the ambiguous 0/О, 1/I/L, so every
 * symbol is unambiguous at a glance. 32 symbols are exactly 5 bits, so
 * eight characters draw 40 bits from the CSPRNG without modulo bias.
 */
export const ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const ACCESS_CODE_TTL_MS = 24 * 60 * 60 * 1000

// Member sessions are long-lived device sign-ins (ADR-0005: a new sign-in
// adds a session rather than terminating existing ones; review and
// revocation arrive with the device list). Administrative sessions stay
// short-lived because they protect every space at once.
export const MEMBER_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000

/** Last-used time is stamped at most once per interval of activity. */
export const MEMBER_SESSION_TOUCH_INTERVAL_MS = 60_000

/** Draws eight alphabet characters from 5 cryptographically random bytes. */
export function generateAccessCode(): string {
  const bytes = randomBytes(5)
  let bits = 0n
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte)
  let code = ''
  for (let index = 0; index < 8; index++) {
    const shift = BigInt(35 - index * 5)
    code += ACCESS_CODE_ALPHABET[Number((bits >> shift) & 0b11111n)]
  }
  return code
}

/** The displayed form: XXXX-XXXX. */
export function formatAccessCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/*
 * The device description (ADR-0005's minimal device review) derives from
 * the sign-in request's user agent as two parts — browser and platform.
 * The parts are stored untranslated and composed in the client, whose
 * language decides the connecting word; the product names (Chrome, iPhone)
 * look the same in every locale.
 */

export interface DeviceDescription {
  browser: string
  platform: string
}

function firstMatch(userAgent: string, pairs: readonly (readonly [string, string])[]): string {
  for (const [fragment, name] of pairs) {
    if (userAgent.includes(fragment)) return name
  }
  return ''
}

/**
 * Reads the browser and the platform out of a user agent. Order matters:
 * Chromium-based agents embed other browsers' fragments, so the specific
 * browser is checked first, and each platform's token comes before the
 * generic ones (Edge ships Edg/, EdgA/ on Android, EdgiOS on iOS; Chrome
 * on iOS is CriOS; Firefox on iOS is FxiOS). Samsung Internet and Opera on
 * iOS are deliberately left unread: they would need vendor tokens that
 * other agents never carry, and they then fall back to the honest
 * engine-level answer (Chrome, Safari). iPadOS 13+ Safari sends the
 * desktop Mac agent, so such an iPad reads as macOS — indistinguishable
 * server-side and accepted as such.
 */
export function describeDevice(userAgent: string | undefined): DeviceDescription {
  if (userAgent === undefined || userAgent.length === 0) return { browser: '', platform: '' }
  const browser = firstMatch(userAgent, [
    ['Edg/', 'Edge'],
    ['EdgA/', 'Edge'],
    ['EdgiOS', 'Edge'],
    ['OPR', 'Opera'],
    ['FxiOS', 'Firefox'],
    ['Firefox', 'Firefox'],
    ['CriOS', 'Chrome'],
    ['Chrome', 'Chrome'],
    ['Safari', 'Safari'],
  ])
  const platform = firstMatch(userAgent, [
    ['iPhone', 'iPhone'],
    ['iPad', 'iPad'],
    ['Android', 'Android'],
    ['Windows', 'Windows'],
    ['Mac OS X', 'macOS'],
    ['CrOS', 'ChromeOS'],
    ['Linux', 'Linux'],
  ])
  return { browser, platform }
}

/**
 * Accepts any letter case, with or without the hyphen, and returns the
 * canonical eight-character form — or undefined for anything that is not
 * shaped like a code.
 */
export function normalizeAccessCode(raw: string): string | undefined {
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, '')
  const pattern = new RegExp(`^[${ACCESS_CODE_ALPHABET}]{8}$`)
  return pattern.test(cleaned) ? cleaned : undefined
}

function codeHashOf(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export type AccessCodeIssuer =
  | { kind: 'administrator'; administratorId: string }
  | { kind: 'member'; memberId: string }

export interface IssuedAccessCode {
  id: string
  memberId: string
  /** The plaintext, shown once at issuance — it is never stored. */
  code: string
  status: 'issued'
  createdAt: Date
  expiresAt: Date
  statusChangedAt: Date
}

/**
 * Issues a fresh code for the member. Issuing is replacing (ADR-0005):
 * older unused codes become replaced and expired ones materialise their
 * status, so a member never holds two live codes at once. The change
 * touches no synchronised rows, so the space revision is not spent.
 */
export async function issueAccessCode(
  deps: AccessDeps,
  spaceId: string,
  memberId: string,
  issuer: AccessCodeIssuer,
): Promise<IssuedAccessCode> {
  const now = deps.clock.now()
  return deps.db.transaction(async (tx) => {
    // The space row lock serialises concurrent issuances for the space, so
    // two racing "issue" requests cannot both leave a live code behind.
    await lockSpace(tx, spaceId)
    const member = await deps.findMemberInSpace(tx, spaceId, memberId)
    if (member === undefined) {
      throw new DomainError('member_not_found', `Member ${memberId} does not exist`, 404)
    }
    await sweepMemberCodesForIssue(tx, spaceId, memberId, now)
    const code = generateAccessCode()
    const created = await insertAccessCode(tx, {
      spaceId,
      memberId,
      issuerAdministratorId: issuer.kind === 'administrator' ? issuer.administratorId : undefined,
      issuerMemberId: issuer.kind === 'member' ? issuer.memberId : undefined,
      codeHash: codeHashOf(code),
      now,
      expiresAt: new Date(now.getTime() + ACCESS_CODE_TTL_MS),
    })
    return {
      id: created.id,
      memberId: created.memberId,
      code: formatAccessCode(code),
      status: 'issued',
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      statusChangedAt: created.statusChangedAt,
    }
  })
}

export interface AccessCodeListItem {
  id: string
  memberId: string
  /** The stored status, with issued-past-expiry reported as expired. */
  status: AccessCodeStatus
  createdAt: Date
  expiresAt: Date
  statusChangedAt: Date
}

/**
 * Lists a space's codes for the administrative area, newest first. Expiry
 * is derived at read time — a GET never writes; the status materialises on
 * the member's next code write.
 */
export async function listAccessCodes(
  deps: AccessDeps,
  spaceId: string,
): Promise<AccessCodeListItem[]> {
  // The codes of an unknown space answer 404 like every other route that
  // names a space, instead of an empty list.
  await getSpace(deps, spaceId)
  const rows = await listAccessCodesInSpace(deps.db, spaceId)
  const now = deps.clock.now()
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    status: derivedStatus(row, now),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    statusChangedAt: row.statusChangedAt,
  }))
}

function derivedStatus(row: AccessCode, now: Date): AccessCodeStatus {
  if (row.status === 'issued' && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return row.status as AccessCodeStatus
}

/**
 * Revokes a live code. A code in any other state cannot be revoked: it has
 * already expired, been used, been replaced, or been revoked, and the
 * specific error says which. Like redemption, this is one compare-and-set
 * on the code row, so it takes no space row lock.
 */
export async function revokeAccessCode(
  deps: AccessDeps,
  spaceId: string,
  codeId: string,
): Promise<AccessCodeListItem> {
  const now = deps.clock.now()
  const outcome = await deps.db.transaction(async (tx) => {
    const row = await revokeAccessCodeRow(tx, spaceId, codeId, now)
    if (row !== undefined) return { kind: 'revoked', row } as const
    const existing = await getAccessCodeRow(tx, spaceId, codeId)
    if (existing === undefined) return { kind: 'unknown' } as const
    return { kind: 'refused', status: derivedStatus(existing, now), codeId: existing.id } as const
  })

  // An expired code materialises its status in its own transaction, so the
  // write survives the refused answer.
  if (outcome.kind === 'refused' && outcome.status === 'expired') {
    await deps.db.transaction((tx) => expireAccessCodeRow(tx, spaceId, outcome.codeId, now))
  }

  if (outcome.kind === 'unknown') {
    throw new DomainError('access_code_not_found', `Access code ${codeId} does not exist`, 404)
  }
  if (outcome.kind === 'refused') {
    throw refusalForStatus(outcome.status, outcome.codeId)
  }

  return {
    id: outcome.row.id,
    memberId: outcome.row.memberId,
    status: 'revoked',
    createdAt: outcome.row.createdAt,
    expiresAt: outcome.row.expiresAt,
    statusChangedAt: outcome.row.statusChangedAt,
  }
}

const REFUSALS = {
  redeemed: { code: 'access_code_used', httpStatus: 409, message: 'has already been redeemed' },
  expired: { code: 'access_code_expired', httpStatus: 410, message: 'has expired' },
  replaced: { code: 'access_code_replaced', httpStatus: 409, message: 'has been replaced' },
  revoked: { code: 'access_code_revoked', httpStatus: 409, message: 'has already been revoked' },
} as const

function refusalForStatus(status: AccessCodeStatus, codeId: string): DomainError {
  if (status === 'issued') {
    // Unreachable: the compare-and-set covers issued-and-live codes, and a
    // concurrent winner commits its terminal status before the loser reads.
    throw new Error(`Access code ${codeId} is still issued but was not changed`)
  }
  const refusal = REFUSALS[status]
  return new DomainError(
    refusal.code,
    `Access code ${codeId} ${refusal.message}`,
    refusal.httpStatus,
  )
}

export interface RedeemResult {
  token: string
  expiresAt: Date
  memberId: string
  spaceId: string
  spaceName: string
  role: 'owner' | 'regular'
  name: string
  displayName: string | null
  needsOnboarding: boolean
}

/**
 * Redeems a code: one live redemption, one new session, existing sessions
 * untouched (ADR-0005). The status flip and the session insert share one
 * transaction, so a code is never spent without a session to show for it.
 * No space row lock is taken: the redemption is one compare-and-set on the
 * code row, and no synchronised row changes, so the revision-lock order
 * has nothing to serialise here. The device description is derived from
 * the sign-in request's user agent and stored for the device review.
 */
export async function redeemAccessCode(
  deps: AccessDeps,
  rawCode: string,
  userAgent?: string,
): Promise<RedeemResult> {
  const normalized = normalizeAccessCode(rawCode)
  if (normalized === undefined) {
    throw new DomainError('access_code_invalid', 'The code is not shaped like a code', 401)
  }
  const codeHash = codeHashOf(normalized)
  const now = deps.clock.now()

  const outcome = await deps.db.transaction(async (tx) => {
    const row = await redeemAccessCodeByHashAcrossSpaces(tx, codeHash, now)
    if (row === undefined) {
      const existing = await findAccessCodeByHashAcrossSpaces(tx, codeHash)
      if (existing === undefined) return { kind: 'invalid' } as const
      const status = derivedStatus(existing, now)
      if (status === 'issued') {
        // Still issued but the compare-and-set lost: a concurrent
        // redemption won the race, so this one is a used code.
        return { kind: 'refused', status: 'redeemed', codeId: existing.id } as const
      }
      return {
        kind: 'refused',
        status,
        codeId: existing.id,
        spaceId: existing.spaceId,
      } as const
    }
    // The rest of the redemption shares this one transaction (architecture,
    // "Transactions"): a code is never spent without a session to show for
    // it, and a failure rolls the spent status back.
    const member = await deps.findMemberInSpace(tx, row.spaceId, row.memberId)
    if (member === undefined) {
      // The composite foreign key makes this unreachable for a live member;
      // a vanished row must not yield a session. The throw — not a returned
      // refusal — is what rolls the spent status back with the transaction.
      throw new DomainError('access_code_invalid', 'The code names no live member', 401)
    }
    const space = await getSpaceInTx(tx, row.spaceId)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_MS)
    await deleteExpiredMemberSessionsAcrossSpaces(tx, now)
    await insertMemberSession(tx, {
      spaceId: row.spaceId,
      memberId: row.memberId,
      tokenHash: codeHashOf(token),
      ...describeDevice(userAgent),
      now,
      expiresAt,
    })
    return { kind: 'redeemed', member, spaceName: space.name, token, expiresAt } as const
  })

  // The refusal itself writes nothing, but an expired code materialises its
  // status in its own transaction: inside the failed one it would roll back.
  if (outcome.kind === 'refused' && outcome.status === 'expired') {
    await deps.db.transaction((tx) => expireAccessCodeRow(tx, outcome.spaceId, outcome.codeId, now))
  }

  if (outcome.kind === 'invalid') {
    throw new DomainError('access_code_invalid', 'No code matches', 401)
  }
  if (outcome.kind === 'refused') {
    throw refusalForStatus(outcome.status, outcome.codeId)
  }

  return {
    token: outcome.token,
    expiresAt: outcome.expiresAt,
    memberId: outcome.member.id,
    spaceId: outcome.member.spaceId,
    spaceName: outcome.spaceName,
    role: outcome.member.role,
    name: outcome.member.name,
    displayName: outcome.member.displayName,
    needsOnboarding: outcome.member.onboardedAt === null,
  }
}

/**
 * Resolves the request's member from the X-Ohana-Member header and the
 * session cookie named for that same member (ADR-0005). Any other cookie
 * the browser sends grants nothing, and an administrative session never
 * authorises a member route. A live authentication also stamps the
 * session's last-used time, throttled to one write per interval so the
 * device review shows a fresh "last used" without writing on every read.
 */
export async function authenticateMember(
  deps: AccessDeps,
  memberId: string | undefined,
  token: string | undefined,
): Promise<MemberActor | undefined> {
  if (memberId === undefined || memberId.length === 0) return undefined
  if (token === undefined || token.length === 0) return undefined
  const tokenHash = codeHashOf(token)
  const now = deps.clock.now()
  const session = await findMemberSessionByTokenHashAcrossSpaces(deps.db, tokenHash, now)
  if (session === undefined || session.memberId !== memberId) return undefined
  const staleBefore = new Date(now.getTime() - MEMBER_SESSION_TOUCH_INTERVAL_MS)
  // Strictly older, matching the compare-and-set's `lt`: at the boundary
  // exactly one of the two decides, and it is the SQL.
  if (session.lastUsedAt.getTime() < staleBefore.getTime()) {
    await touchMemberSessionByTokenHashAcrossSpaces(deps.db, tokenHash, staleBefore, now)
  }
  const member = await deps.findMemberInSpace(deps.db, session.spaceId, session.memberId)
  if (member === undefined) return undefined
  return {
    kind: 'member',
    memberId: member.id,
    spaceId: member.spaceId,
    role: member.role,
    sessionId: session.id,
  }
}

/**
 * Deletes the named member's session for this token. The delete is scoped
 * to the member, matching the authentication rule: a token only ever acts
 * for the member its cookie is named for. Other devices keep theirs.
 */
export async function signOutMember(
  deps: AccessDeps,
  memberId: string,
  token: string | undefined,
): Promise<void> {
  if (token === undefined || token.length === 0) return
  await deps.db.transaction((tx) =>
    deleteMemberSessionByTokenHashAcrossSpaces(tx, memberId, codeHashOf(token)),
  )
}

export interface MemberSessionListItem {
  id: string
  /** The browser and platform captured at sign-in; '' when unknown. */
  browser: string
  platform: string
  createdAt: Date
  lastUsedAt: Date
}

/**
 * Lists the member's own live sessions for the device review (ADR-0005's
 * minimal session controls): device description, created, last used. The
 * list is a read; expired sessions filter out at read time and materialise
 * nowhere — the next sign-in sweeps them.
 */
export async function listMemberSessions(
  deps: AccessDeps,
  spaceId: string,
  memberId: string,
): Promise<MemberSessionListItem[]> {
  const rows = await listLiveMemberSessionsForMember(deps.db, spaceId, memberId, deps.clock.now())
  return rows.map((row: MemberSession) => ({
    id: row.id,
    browser: row.browser,
    platform: row.platform,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }))
}

/**
 * Revokes one of the member's own sessions (ADR-0005). The delete is
 * scoped to the authenticated member and space, so another member's or
 * space's session id deletes nothing and reads back as unknown — 404,
 * like every resource the actor cannot see. Revoking revokes exactly one
 * session: the other devices, and other members on the same device, keep
 * theirs.
 */
export async function revokeMemberSession(
  deps: AccessDeps,
  spaceId: string,
  memberId: string,
  sessionId: string,
): Promise<void> {
  const deleted = await deps.db.transaction((tx) =>
    deleteMemberSessionById(tx, spaceId, memberId, sessionId),
  )
  if (!deleted) {
    throw new DomainError(
      'member_session_not_found',
      `Member session ${sessionId} does not exist`,
      404,
    )
  }
}
