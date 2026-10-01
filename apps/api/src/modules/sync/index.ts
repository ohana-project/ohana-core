export {
  readTombstonesSince,
  type SyncTombstoneEntry,
  type TombstoneAudience,
  type TombstoneInput,
  writeTombstones,
} from './repository.ts'
export {
  type ChangePlan,
  recordChanges,
  type SyncActor,
  type SyncContributor,
  type SyncResult,
  syncSince,
} from './service.ts'
export type { SyncTombstone } from './tables.ts'
