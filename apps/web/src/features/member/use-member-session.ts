import type { paths } from '@ohana/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import {
  getActiveMemberId,
  removeSession,
  type StoredMemberSession,
  saveSession,
} from '@/data/session-registry.ts'

/*
 * The member session probe mirrors the administrative one: 200 means the
 * active member's session cookie is valid, any rejection means signed out —
 * that is a state, not a failure. The registry provides the member named in
 * X-Ohana-Member; the API client injects it (data/api.ts).
 */

const memberSessionQueryKey = ['member', 'session'] as const

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
    saveSession(stored)
    // The refresh settles before the caller navigates, so the next screen's
    // gate decides on the new session, not on the stale signed-out answer.
    await queryClient.invalidateQueries({ queryKey: memberSessionQueryKey })
  }
}

/** Forgets the active sign-in after the API deletes its session. */
export function useMemberSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const memberId = getActiveMemberId()
      if (memberId === undefined) throw new ApiError('unexpected')
      // The route requires the member's name, and the type asks for it
      // explicitly; the middleware would also set it.
      const response = await api.DELETE('/api/v1/me/session', {
        params: { header: { 'x-ohana-member': memberId } },
      })
      await assertOk(response)
    },
    // Only success forgets the sign-in: a failed request must keep the
    // entry so the member can retry the sign-out.
    onSuccess: () => {
      const memberId = getActiveMemberId()
      if (memberId !== undefined) removeSession(memberId)
      void queryClient.invalidateQueries({ queryKey: memberSessionQueryKey })
    },
  })
}
