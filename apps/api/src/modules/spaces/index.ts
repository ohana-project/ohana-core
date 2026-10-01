export {
  SECTION_IDS,
  type SectionId,
  type SpaceSections,
  sectionVisibility,
} from './policy.ts'
export { sectionGate } from './routes.ts'
export {
  advanceSpaceRevision,
  createSpace,
  getSpace,
  getSpaceInTx,
  lockSpace,
  requireVisibleSectionInTx,
  type SpacesDeps,
} from './service.ts'
export type { Space } from './tables.ts'
