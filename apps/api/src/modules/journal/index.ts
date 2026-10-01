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
  type JournalJobsDeps,
  type JournalPurgeJobData,
  purgeDueTrashedEntries,
  purgeTrashedEntry,
} from './jobs.ts'
export { journalRoutes } from './routes.ts'
export { journalSyncContributor } from './sync.ts'

/**
 * The queues this module's use cases send to — the list the api process
 * ensures exist, so the first trash never meets a queue the worker has
 * not created (architecture.md, "Background jobs"). The worker ensures
 * its own full set, including the sweep's queue. The one name here is
 * JOURNAL_PURGE_JOB's, written literally so the queue list travels with
 * the comment that explains it.
 */
export const JOURNAL_SENT_QUEUES = ['journal-purge-entry'] as const
