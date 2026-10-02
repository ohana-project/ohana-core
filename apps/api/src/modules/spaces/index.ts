export {
  type MemberSpaceDto,
  MemberSpaceDtoSchema,
  SpaceSyncChangeSchema,
  toMemberSpaceDto,
} from './contracts.ts'
export {
  SECTION_IDS,
  type SectionId,
  type SpaceSections,
  sectionVisibility,
} from './policy.ts'
export { sectionGate } from './routes.ts'
export {
  assertTimezone,
  advanceSpaceRevision,
  createSpace,
  getSpace,
  getSpaceInTx,
  lockSpace,
  requireVisibleSectionInTx,
  type SpacesDeps,
} from './service.ts'
export { spacesSyncContributor } from './sync.ts'
export type { Space } from './tables.ts'
