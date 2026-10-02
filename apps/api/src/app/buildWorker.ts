import { sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import {
  JOURNAL_PURGE_JOB,
  JOURNAL_PURGE_SWEEP_CRON,
  JOURNAL_PURGE_SWEEP_JOB,
  type JournalJobsDeps,
  type JournalPurgeJobData,
  purgeDueTrashedEntries,
  purgeTrashedEntry,
  touchEntryRevision,
} from '../modules/journal/index.ts'
import {
  deleteEntryImageObjects,
  generateEntryImageDerivatives,
  MEDIA_DELETE_JOB,
  MEDIA_DERIVATIVES_JOB,
  MEDIA_QUEUE_SETUPS,
  type MediaDeleteJobData,
  type MediaDerivativesJobData,
  type MediaJobsDeps,
} from '../modules/media/index.ts'
import type { Db } from '../platform/db/index.ts'
import { createPgBossJobSender, ensureQueues } from '../platform/jobs/pgboss.ts'
import type { Logger } from '../platform/logging.ts'
import type { ObjectStorage } from '../platform/storage/index.ts'

export interface WorkerDeps {
  db: Db
  clock: JournalJobsDeps['clock']
  logger: Logger
  /** The photos' storage: the derivatives land there, the purges clean up there. */
  storage: ObjectStorage
  /**
   * The pg-boss instance the worker claims jobs through — started by the
   * entrypoint from configuration, handed in explicitly like every other
   * dependency (architecture.md, "Composition").
   */
  boss: PgBoss
}

export interface Worker {
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * The worker composition root (architecture.md, "Background jobs"): the
 * pg-boss handlers register here as modules add them. Handlers are the
 * modules' own functions, tested directly against a controllable clock;
 * start() only wires them to the queue — and makes sure the queues exist,
 * because a job sent by the api into a queue nobody created would have had
 * nowhere to land.
 */
export function buildWorker(deps: WorkerDeps): Worker {
  // The worker's own sender: the purge schedules the photos' cleanup inside
  // its transactions, the way the api's use cases schedule theirs.
  const jobs = createPgBossJobSender(deps.boss)
  const jobDeps: JournalJobsDeps = { db: deps.db, clock: deps.clock, jobs }
  const mediaJobDeps: MediaJobsDeps = {
    db: deps.db,
    clock: deps.clock,
    storage: deps.storage,
    touchEntry: touchEntryRevision,
  }
  return {
    async start() {
      await deps.db.execute(sql`select 1`)
      await ensureQueues(deps.boss, [
        { name: JOURNAL_PURGE_JOB },
        { name: JOURNAL_PURGE_SWEEP_JOB },
        ...MEDIA_QUEUE_SETUPS,
      ])
      await deps.boss.work<JournalPurgeJobData>(JOURNAL_PURGE_JOB, async (jobs) => {
        for (const job of jobs) await purgeTrashedEntry(jobDeps, job.data)
      })
      await deps.boss.work<MediaDerivativesJobData>(MEDIA_DERIVATIVES_JOB, async (jobs) => {
        for (const job of jobs) await generateEntryImageDerivatives(mediaJobDeps, job.data)
      })
      await deps.boss.work<MediaDeleteJobData>(MEDIA_DELETE_JOB, async (jobs) => {
        for (const job of jobs) await deleteEntryImageObjects(deps, job.data)
      })
      await deps.boss.work(JOURNAL_PURGE_SWEEP_JOB, async () => {
        await purgeDueTrashedEntries(jobDeps)
      })
      await deps.boss.schedule(JOURNAL_PURGE_SWEEP_JOB, JOURNAL_PURGE_SWEEP_CRON)
      deps.logger.info('Worker started')
    },
    async stop() {
      await deps.boss.stop()
      deps.logger.info('Worker stopped')
    },
  }
}
