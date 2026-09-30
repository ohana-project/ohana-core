import type { paths } from '@ohana/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'

/*
 * The device review (issue #10, ADR-0005): the active member's server-side
 * sessions. Like the profile listing, this is online-only data — ordinary
 * queries, not the synchronised store.
 */

/** One row of GET /me/sessions, taken from the generated contract. */
export type MemberSessionRow =
  paths['/api/v1/me/sessions']['get']['responses'][200]['content']['application/json'][number]

const memberSessionsQueryKey = ['member', 'sessions'] as const

export function useMemberSessions() {
  return useQuery({
    queryKey: memberSessionsQueryKey,
    queryFn: async (): Promise<MemberSessionRow[]> => {
      const { data, error } = await api.GET('/api/v1/me/sessions')
      await assertOk({ error })
      return data ?? []
    },
  })
}

/** Revokes one of the active member's own sessions by id. */
export function useRevokeMemberSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string): Promise<string> => {
      const response = await api.DELETE('/api/v1/me/sessions/{sessionId}', {
        params: { path: { sessionId } },
      })
      await assertOk(response)
      return sessionId
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberSessionsQueryKey })
    },
  })
}
