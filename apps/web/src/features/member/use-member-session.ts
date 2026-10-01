import type { paths } from '@ohana/api-client'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'
import {
  getActiveMemberId,
  removeSession,
  type StoredMemberSession,
  saveSession,
  setActiveMemberId,
} from '@/data/session-registry.ts'

/*
 * The member session probe mirrors the administrative one: 200 means the
 * active member's session cookie is valid, any rejection means signed out —
 * that is a state, not a failure. The registry provides the member named in
 * X-Ohana-Member; the API client injects it (data/api.ts).
 */

/** The active member's probe key; every member change resets it. */
export const memberSessionQueryKey = ['member', 'session'] as const

/** The GET /me response, taken from the generated contract (ADR-0013). */
export type MemberMe = paths['/api/v1/me']['get']['responses'][200]['content']['application/json']

export type MemberSessionStatus = 'pending' | 'signed-in' | 'signed-out'

export type MemberSessionState = { status: 'signed-out' } | { status: 'signed-in'; me: MemberMe }

export function useMemberSession() {
  return useQuery({
    queryKey: memberSessionQueryKey,
    // A short stale time keeps route mounts from refetching the probe every
    // time; sign-in and sign-out invalidate it explicitly when the answer
    // must be fresh.
    staleTime: 30_000,
    queryFn: async (): Promise<MemberSessionState> => {
      // No retained sign-in on this device: signed out without a request.
      if (getActiveMemberId() === undefined) return { status: 'signed-out' }
      const { data, error } = await api.GET('/api/v1/me')
      await assertOk({ error })
      if (data === undefined) return { status: 'signed-out' }
      return { status: 'signed-in', me: data }
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
 * Forgets a member on this device: the registry entry goes, and the
 * remaining queries reset — except the departing member's own, which are
 * left unreachable instead of reset. Their headers are pinned to the
 * member, so a refetch under that name could only be refused; the stale
 * answers sit under member-scoped keys no other member can match until
 * the device unmounts them and the cache collects them. The registry
 * changes before the reset, so the next render can only rebuild queries
 * for whoever is active now. Called after the API has ended the member's
 * session (sign-out, or revoking the session this device is using).
 */
export function forgetMember(queryClient: QueryClient, memberId: string): void {
  removeSession(memberId)
  void queryClient.resetQueries({
    predicate: (query) => query.queryKey[1] !== memberId,
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
