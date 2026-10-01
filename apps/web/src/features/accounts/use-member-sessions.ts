import type { paths } from '@ohana/api-client'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'

/*
 * The device review (issue #10, ADR-0005): a member's server-side
 * sessions. Like the profile listing, this is online-only data — ordinary
 * queries, not the synchronised store. Without a member the query is
 * disabled outright (skipToken): /accounts deliberately renders without a
 * gate, and a request that names no member could only be refused. The
 * member arrives from the caller, so one source of truth answers for both
 * the screen and the requests.
 */

/** One row of GET /me/sessions, taken from the generated contract. */
export type MemberSessionRow =
  paths['/api/v1/me/sessions']['get']['responses'][200]['content']['application/json'][number]

/** The member-scoped cache key: another member's answers can never match. */
export function memberSessionsQueryKey(memberId: string | undefined) {
  return ['member', memberId, 'sessions'] as const
}

export function useMemberSessions(memberId: string | undefined) {
  return useQuery({
    queryKey: memberSessionsQueryKey(memberId),
    // The header is pinned to this key's member, not re-read at request
    // time: a refetch that races a switch answers for the key's member.
    queryFn:
      memberId === undefined
        ? skipToken
        : async (): Promise<MemberSessionRow[]> => {
            const { data, error } = await api.GET('/api/v1/me/sessions', {
              params: { header: { 'x-ohana-member': memberId } },
            })
            await assertOk({ error })
            return data ?? []
          },
  })
}

/**
 * Revokes one of the member's own sessions by id. The member travels with
 * the mutation, so a revoke confirmed around a switch can never act for
 * another member. The cache is the caller's business: only it knows
 * whether the revoked row was the current session (which is also a
 * sign-out here) or another device's.
 */
export function useRevokeMemberSession() {
  return useMutation({
    mutationFn: async ({
      memberId,
      sessionId,
    }: {
      memberId: string
      sessionId: string
    }): Promise<string> => {
      const response = await api.DELETE('/api/v1/me/sessions/{sessionId}', {
        params: { path: { sessionId }, header: { 'x-ohana-member': memberId } },
      })
      await assertOk(response)
      return sessionId
    },
  })
}
