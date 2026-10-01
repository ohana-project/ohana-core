export {
  advanceSpaceRevision,
  createSpace,
  getSpace,
  getSpaceInTx,
  lockSpace,
  type SpacesDeps,
} from './service.ts'
export {
  assertSectionVisible,
  SECTION_IDS,
  sectionGate,
  type SectionGateDeps,
  type SectionId,
  sectionVisibility,
  type SpaceSections,
} from './policy.ts'
export type { Space } from './tables.ts'
