import type { paths } from '@ohana/api-client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'

/*
 * The device review (issue #10, ADR-0005): the active member's server-side
 * sessions. Like the profile listing, this is online-only data — ordinary
 * queries, not the synchronised store. The query is disabled without an
 * active member: /accounts deliberately renders without a gate, and a
 * request that names no member could only be refused.
 */

/** One row of GET /me/sessions, taken from the generated contract. */
export type MemberSessionRow =
  paths['/api/v1/me/sessions']['get']['responses'][200]['content']['application/json'][number]

/** The member-scoped cache key: another member's answers can never match. */
export function memberSessionsQueryKey(memberId: string | undefined) {
  return ['member', memberId, 'sessions'] as const
}

export function useMemberSessions() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: memberSessionsQueryKey(memberId),
    enabled: memberId !== undefined,
    // The header is tied to the key's member, not re-read at request time:
    // a refetch that races a switch must answer for the key's member or
    // name no member at all.
    queryFn: async ({ queryKey }): Promise<MemberSessionRow[]> => {
      const id = queryKey[1]
      if (id === undefined) return []
      const { data, error } = await api.GET('/api/v1/me/sessions', {
        params: { header: { 'x-ohana-member': id } },
      })
      await assertOk({ error })
      return data ?? []
    },
  })
}

/**
 * Revokes one of the active member's own sessions by id. The cache is the
 * caller's business: only it knows whether the revoked row was the current
 * session (which is also a sign-out here) or another device's.
 */
export function useRevokeMemberSession() {
  return useMutation({
    mutationFn: async (sessionId: string): Promise<string> => {
      const response = await api.DELETE('/api/v1/me/sessions/{sessionId}', {
        params: { path: { sessionId } },
      })
      await assertOk(response)
      return sessionId
    },
  })
}
