import { skipToken, useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { assertOk } from '@/data/api-error.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import type { MemberMe } from '@/features/member/use-member-session.ts'

/*
 * The owner instruments' profile list (issue #12): online-only, because
 * the owner screens manage live membership. The member home reads the same
 * profiles from the synchronised local store (issue #14) instead. The API
 * names no space — the member's own space is the only one a member can
 * ever read. The key is member-scoped and the header pinned to it: a
 * cached answer must never surface for, or be fetched under the name of,
 * another member.
 */
export function useSpaceProfiles() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: ['member', memberId, 'profiles'],
    queryFn:
      memberId === undefined
        ? skipToken
        : async (): Promise<MemberMe['member'][]> => {
            const { data, error } = await api.GET('/api/v1/members', {
              params: { header: { 'x-ohana-member': memberId } },
            })
            await assertOk({ error })
            return data ?? []
          },
  })
}
