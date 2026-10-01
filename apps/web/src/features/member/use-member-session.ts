import type { paths } from '@ohana/api-client'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk, responseStatus } from '@/data/api-error.ts'
import { deleteMemberData, readMemberSnapshot } from '@/data/local-store.ts'
import {
  getActiveMemberId,
  listStoredSessions,
  removeSession,
  type StoredMemberSession,
  saveSession,
  setActiveMemberId,
} from '@/data/session-registry.ts'

/*
 * The member session probe mirrors the administrative one: 200 means the
 * active member's session cookie is valid, any API rejection means signed
 * out — that is a state, not a failure. A request that never reached the
 * API (offline, server unreachable) is different: a retained sign-in keeps
 * working from the local store (ADR-0002, issue #14), with the identity
 * assembled from the registry and the member's synchronised partition.
 * The registry provides the member named in X-Ohana-Member; the API client
 * injects it (data/api.ts).
 */

/** The active member's probe key; every member change resets it. */
export const memberSessionQueryKey = ['member', 'session'] as const

/** The GET /me response, taken from the generated contract (ADR-0013). */
export type MemberMe = paths['/api/v1/me']['get']['responses'][200]['content']['application/json']

export type MemberSessionStatus = 'pending' | 'signed-in' | 'signed-out'

export type MemberSessionState = { status: 'signed-out' } | { status: 'signed-in'; me: MemberMe }

/**
 * The member's identity while the API is unreachable: the registry names
 * the member and their space, the synchronised partition (when it exists)
 * fills in the role and the profile. A partition that was never downloaded
 * leaves the role unknown — the conservative `regular` — and a device that
 * never downloaded anything says so on the home screen.
 */
async function offlineIdentity(memberId: string): Promise<MemberMe | undefined> {
  const registry = listStoredSessions().find((session) => session.memberId === memberId)
  if (registry === undefined) return undefined
  const snapshot = await readMemberSnapshot(memberId)
  const profile = snapshot.members.find((member) => member.id === memberId)
  return {
    member: {
      id: memberId,
      name: registry.name,
      displayName: profile?.displayName ?? registry.displayName,
      email: profile?.email,
      phone: profile?.phone,
      interfaceLanguage: profile?.interfaceLanguage,
      role: profile?.role ?? 'regular',
      createdAt: profile?.createdAt ?? new Date(0).toISOString(),
    },
    space: {
      id: snapshot.space?.id ?? registry.spaceId,
      name: snapshot.space?.name ?? registry.spaceName,
    },
    // Whether onboarding is still owed is only knowable online; the probe
    // asks again when the connection returns.
    needsOnboarding: false,
  }
}

export function useMemberSession() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: memberSessionQueryKey,
    // A short stale time keeps route mounts from refetching the probe every
    // time; sign-in and sign-out invalidate it explicitly when the answer
    // must be fresh.
    staleTime: 30_000,
    queryFn: async (): Promise<MemberSessionState> => {
      // No retained sign-in on this device: signed out without a request.
      const memberId = getActiveMemberId()
      if (memberId === undefined) return { status: 'signed-out' }
      try {
        const { data, error, response } = await api.GET('/api/v1/me')
        if (error === undefined && data !== undefined) {
          return { status: 'signed-in', me: data }
        }
        // The API answered and refused. A 5xx behind a restarting proxy is
        // the server being unavailable, not an answer about the session —
        // a retained sign-in keeps working from the local store (ADR-0002,
        // issue #14). A 401 is the answer: the session is gone — revoked or
        // expired — and the member's presence on the device goes with it,
        // the way a sign-out would (ADR-0005). Anything else is signed out.
        const status = responseStatus(response)
        if (status >= 500) {
          const identity = await offlineIdentity(memberId)
          if (identity !== undefined) return { status: 'signed-in', me: identity }
          return { status: 'signed-out' }
        }
        if (status === 401) forgetMember(queryClient, memberId)
        return { status: 'signed-out' }
      } catch (caught) {
        // The request never reached the API — offline, or no answer at all:
        // read on, from the local store.
        const identity = await offlineIdentity(memberId)
        if (identity === undefined) throw caught
        return { status: 'signed-in', me: identity }
      }
    },
  })
}

export function useMemberSessionStatus(): {
  status: MemberSessionStatus
  me?: MemberMe
} {
  const session = useMemberSession()
  // A refetch in flight (after sign-in or sign-out invalidates the probe)
  // leaves the previous answer in `data`; deciding on it would bounce the
  // member to the wrong screen. With the probe's stale time, waiting out a
  // fetch cannot loop: a fresh cache never refetches on remount.
  if (session.isPending || session.isFetching) return { status: 'pending' }
  if (session.isError || session.data.status === 'signed-out') return { status: 'signed-out' }
  return { status: 'signed-in', me: session.data.me }
}

/** Stores a fresh sign-in, makes it active, and refreshes the probe. */
export function useRedeemedSignIn() {
  const queryClient = useQueryClient()
  return async (
    member: { id: string; name: string; displayName?: string },
    space: { id: string; name: string },
  ): Promise<void> => {
    const stored: StoredMemberSession = {
      memberId: member.id,
      spaceId: space.id,
      spaceName: space.name,
      name: member.name,
      displayName: member.displayName,
    }
    // Adding a sign-in for another member must leave none of the previous
    // member's cached answers in place (ADR-0005: the space boundary holds
    // on the device too); the same member's new device session changes no
    // member-scoped data, so its probe alone is refreshed.
    const previousMemberId = getActiveMemberId()
    saveSession(stored)
    if (previousMemberId === member.id) {
      await queryClient.invalidateQueries({ queryKey: memberSessionQueryKey })
    } else {
      await queryClient.resetQueries()
    }
  }
}

/**
 * Switches the device's active retained sign-in (ADR-0005: a client-side
 * choice between independent sessions). Every query is reset, not merely
 * invalidated: the cached answers belong to the previous member's space,
 * and no screen may show them while the requests already name the next
 * member.
 */
export function useSwitchMember() {
  const queryClient = useQueryClient()
  return (memberId: string) => {
    if (getActiveMemberId() === memberId) return
    setActiveMemberId(memberId)
    void queryClient.resetQueries()
  }
}

/**
 * Forgets a member on this device: the registry entry goes, the member's
 * cached answers are cleared without refetching — their headers are
 * pinned to the member, so a request under that name could only be
 * refused — and the remaining queries reset for whoever is active now.
 * The queries are reset in place rather than removed: a screen still
 * observing the departed member's key keeps the same query, and a reset
 * query does not fetch again on re-render — a removed query would be
 * rebuilt and refetched under the pinned header. Called after the API has
 * ended the member's session (sign-out, or revoking the session this
 * device is using).
 */
export function forgetMember(queryClient: QueryClient, memberId: string): void {
  removeSession(memberId)
  // The member's synchronised partition goes with the sign-out (issue #14):
  // one database per member, deleted whole. A storage failure must not keep
  // the session alive, so the deletion runs on its own.
  void deleteMemberData(memberId).catch(() => {})
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['member', memberId] })) {
    query.reset()
  }
  void queryClient.resetQueries({
    predicate: (query) => query.queryKey[0] !== 'member' || query.queryKey[1] !== memberId,
  })
}

/**
 * Signs the given member out after the API deletes their session. The
 * member travels with the mutation, so the request and the cleanup always
 * concern the member the dialog named — never whoever is active by the
 * time the request goes out. A failed request keeps the entry so the
 * member can retry.
 */
export function useMemberSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (memberId: string): Promise<string> => {
      const response = await api.DELETE('/api/v1/me/session', {
        params: { header: { 'x-ohana-member': memberId } },
      })
      await assertOk(response)
      return memberId
    },
    onSuccess: (memberId) => forgetMember(queryClient, memberId),
  })
}
