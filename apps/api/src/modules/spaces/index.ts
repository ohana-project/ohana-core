export {
  assertSectionVisible,
  SECTION_IDS,
  type SectionGateDeps,
  type SectionId,
  type SpaceSections,
  sectionGate,
  sectionVisibility,
} from './policy.ts'
export {
  advanceSpaceRevision,
  createSpace,
  getSpace,
  getSpaceInTx,
  lockSpace,
  type SpacesDeps,
} from './service.ts'
export type { Space } from './tables.ts'
