import { useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import type { MemberMe } from '@/features/member/use-member-session.ts'

/*
 * Member-facing profile data is online-only for now; the synchronised
 * store arrives with the sync engine (issue #14). The API names no space —
 * the member's own space is the only one a member can ever read. The key
 * is member-scoped: a cached answer must never surface for another member.
 */
export function useSpaceProfiles() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: ['member', memberId, 'profiles'],
    queryFn: async (): Promise<MemberMe['member'][]> => {
      const { data, error } = await api.GET('/api/v1/members')
      await assertOk({ error })
      return data ?? []
    },
  })
}
