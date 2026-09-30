export { MemberRoleSchema } from './contracts.ts'
export {
  changeMemberRole,
  countMembersBySpace,
  listMembers,
  type MemberInput,
  type MemberRole,
  type MembersDeps,
  provisionMember,
} from './service.ts'
export type { Member, memberRoles } from './tables.ts'
