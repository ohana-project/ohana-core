/**
 * The journal module's public surface: what the composition root mounts
 * and wires — the member-facing routes, the sync contributor, and the
 * worker handlers the buildWorker composition root registers. Everything
 * else is the module's interior; tests import it directly.
 */

export {
  JOURNAL_PURGE_JOB,
  JOURNAL_PURGE_SWEEP_CRON,
  JOURNAL_PURGE_SWEEP_JOB,
  JOURNAL_SENT_QUEUES,
  type JournalJobsDeps,
  type JournalPurgeJobData,
  purgeDueTrashedEntries,
  purgeTrashedEntry,
} from './jobs.ts'
export { journalRoutes } from './routes.ts'
export { journalSyncContributor } from './sync.ts'
