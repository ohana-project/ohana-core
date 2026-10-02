/**
 * The journal module's public surface: what the composition root mounts
 * and wires — the member-facing routes (with the photo routes the media
 * module powers), the sync contributor, and the worker handlers the
 * buildWorker composition root registers. The photo access rules are
 * exported for the same wiring: a photo's permissions are its entry's
 * (issue #17), and the media module takes them as injected functions. All
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
export {
  assertEntryImageEditable,
  assertEntryImageEditableInTx,
  assertEntryImageViewable,
  touchEntryRevision,
} from './service.ts'
export { journalSyncContributor } from './sync.ts'
