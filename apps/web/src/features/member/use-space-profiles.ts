import { useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'
import type { MemberMe } from '@/features/member/use-member-session.ts'

/*
 * Member-facing profile data is online-only for now; the synchronised
 * store arrives with the sync engine (issue #14). The API names no space —
 * the member's own space is the only one a member can ever read.
 */
export function useSpaceProfiles() {
  return useQuery({
    queryKey: ['member', 'profiles'],
    queryFn: async (): Promise<MemberMe['member'][]> => {
      const { data, error } = await api.GET('/api/v1/members')
      await assertOk({ error })
      return data ?? []
    },
  })
}
