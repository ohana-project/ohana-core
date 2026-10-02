import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import type { Tx } from '../db/index.ts'
import type { Logger } from '../logging.ts'
import type { JobSender, JobSubmission, QueueSetup } from './index.ts'

/*
 * The pg-boss implementation of the jobs port (ADR-0009). One PgBoss
 * instance per process talks to the application's PostgreSQL; the queue
 * schema is pg-boss's own, maintained by its start(), not a Drizzle
 * migration.
 */

/**
 * Arms the error listener both process kinds share: pg-boss is an
 * EventEmitter whose transient pool and maintenance failures surface as
 * `error`, and an unhandled `error` would take the whole process down.
 */
function listenForErrors(boss: PgBoss, logger: Logger): void {
  boss.on('error', (cause) => {
    logger.error({ err: cause }, 'pg-boss raised an error')
  })
}

/**
 * Starts a pg-boss instance against the application database. start() runs
 * or checks the queue schema's migrations and arms maintenance; several
 * instances (api and worker) may share one installation, the way pg-boss
 * is built to run.
 */
export async function startJobQueue(databaseUrl: string, logger: Logger): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl })
  listenForErrors(boss, logger)
  await boss.start()
  return boss
}

/**
 * Creates the queues the named jobs travel on, idempotently. Every process
 * that sends to a queue ensures it exists first: pg-boss refuses a send to
 * a queue nobody has created, and the api must not depend on a worker
 * having started before its first trash.
 */
export async function ensureQueues(boss: PgBoss, queues: readonly QueueSetup[]): Promise<void> {
  for (const queue of queues) {
    // createQueue inserts with ON CONFLICT DO NOTHING: a queue an earlier
    // deployment made would keep its old contract, so the options are
    // restated for the existing queue too.
    await boss.createQueue(queue.name, queue.options)
    if (queue.options !== undefined) {
      await boss.updateQueue(queue.name, queue.options)
    }
  }
}

/**
 * The sending instance the api processes run: it submits jobs and keeps no
 * workers, cron schedules, or maintenance of its own — the worker process
 * claims and executes (ADR-0009). The caller names the queues it will send
 * to, so the first trash never meets a queue the worker has not created.
 */
export async function startSendingJobQueue(
  databaseUrl: string,
  logger: Logger,
  queues: readonly QueueSetup[],
): Promise<{ boss: PgBoss; sender: JobSender }> {
  const boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false })
  listenForErrors(boss, logger)
  await boss.start()
  await ensureQueues(boss, queues)
  return { boss, sender: createPgBossJobSender(boss) }
}

/**
 * The transactional sender the API processes use: submissions ride the
 * caller's transaction through pg-boss's Drizzle adapter, so the job
 * commits — or rolls back — with the domain change.
 */
export function createPgBossJobSender(boss: PgBoss): JobSender {
  return {
    async sendInTx(tx: Tx, submission: JobSubmission): Promise<void> {
      await boss.send(
        submission.name,
        submission.data as object,
        submission.startAfter === undefined
          ? { db: fromDrizzle(tx, sql) }
          : { db: fromDrizzle(tx, sql), startAfter: submission.startAfter },
      )
    },
  }
}
