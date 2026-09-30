/*
 * The session registry (architecture.md, web rules): which members are
 * signed in on this device, and which one is active. It stores member and
 * space names only — never tokens, which stay in the browser-managed
 * session cookies.
 */

export interface StoredMemberSession {
  memberId: string
  spaceId: string
  spaceName: string
  /** The provisioned name, shown when no display name is set. */
  name: string
  displayName?: string
}

const SESSIONS_KEY = 'ohana.sessions'
const ACTIVE_KEY = 'ohana.activeMember'

function readSessions(): StoredMemberSession[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredMemberSession[]) : []
  } catch {
    return []
  }
}

function writeSessions(sessions: StoredMemberSession[]): void {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

/** The retained sign-ins on this device, first sign-in first. */
export function listStoredSessions(): StoredMemberSession[] {
  return readSessions()
}

/** Adds a sign-in (or refreshes it) and makes it the active one. */
export function saveSession(session: StoredMemberSession): void {
  const sessions = readSessions().filter((candidate) => candidate.memberId !== session.memberId)
  sessions.push(session)
  writeSessions(sessions)
  setActiveMemberId(session.memberId)
}

/** Updates the stored display name after onboarding. */
export function renameSession(memberId: string, displayName: string | undefined): void {
  const sessions = readSessions()
  const stored = sessions.find((candidate) => candidate.memberId === memberId)
  if (stored === undefined) return
  writeSessions(
    sessions.map((candidate) =>
      candidate.memberId === memberId ? { ...candidate, displayName } : candidate,
    ),
  )
}

/** Forgets the sign-in; another retained one becomes active. */
export function removeSession(memberId: string): void {
  const remaining = readSessions().filter((candidate) => candidate.memberId !== memberId)
  writeSessions(remaining)
  if (getActiveMemberId() === memberId) {
    const next = remaining.at(-1)
    if (next === undefined) {
      window.localStorage.removeItem(ACTIVE_KEY)
    } else {
      setActiveMemberId(next.memberId)
    }
  }
}

export function getActiveMemberId(): string | undefined {
  const value = window.localStorage.getItem(ACTIVE_KEY)
  return value === null || value.length === 0 ? undefined : value
}

export function setActiveMemberId(memberId: string): void {
  window.localStorage.setItem(ACTIVE_KEY, memberId)
}
