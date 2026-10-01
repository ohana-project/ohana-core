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
} from '../modules/journal/index.ts'
import type { Db } from '../platform/db/index.ts'
import { ensureQueue, startJobQueue } from '../platform/jobs/pgboss.ts'
import type { Logger } from '../platform/logging.ts'

export interface WorkerDeps {
  db: Db
  clock: JournalJobsDeps['clock']
  logger: Logger
  /** The same PostgreSQL the jobs live in (ADR-0009). */
  databaseUrl: string
}

export interface Worker {
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * The worker composition root (architecture.md, "Background jobs"): the
 * pg-boss handlers register here as modules add them. Handlers are the
 * modules' own functions, tested directly against a controllable clock;
 * start() only wires them to the queue.
 */
export function buildWorker(deps: WorkerDeps): Worker {
  let boss: PgBoss | undefined
  const jobDeps: JournalJobsDeps = { db: deps.db, clock: deps.clock }
  return {
    async start() {
      await deps.db.execute(sql`select 1`)
      boss = await startJobQueue(deps.databaseUrl)
      await ensureQueue(boss, JOURNAL_PURGE_JOB)
      await ensureQueue(boss, JOURNAL_PURGE_SWEEP_JOB)
      await boss.work<JournalPurgeJobData>(JOURNAL_PURGE_JOB, async (jobs) => {
        for (const job of jobs) await purgeTrashedEntry(jobDeps, job.data)
      })
      await boss.work(JOURNAL_PURGE_SWEEP_JOB, async () => {
        await purgeDueTrashedEntries(jobDeps)
      })
      await boss.schedule(JOURNAL_PURGE_SWEEP_JOB, JOURNAL_PURGE_SWEEP_CRON)
      deps.logger.info('Worker started')
    },
    async stop() {
      await boss?.stop()
      deps.logger.info('Worker stopped')
    },
  }
}
