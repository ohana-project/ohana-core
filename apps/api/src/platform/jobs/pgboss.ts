import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import type { Tx } from '../db/index.ts'
import type { JobSender, JobSubmission } from './index.ts'

/*
 * The pg-boss implementation of the jobs port (ADR-0009). One PgBoss
 * instance per process talks to the application's PostgreSQL; the queue
 * schema is pg-boss's own, maintained by its start(), not a Drizzle
 * migration.
 */

/**
 * Starts a pg-boss instance against the application database. start() runs
 * or checks the queue schema's migrations and arms maintenance; several
 * instances (api and worker) may share one installation, the way pg-boss
 * is built to run.
 */
export async function startJobQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl })
  await boss.start()
  return boss
}

/** Creates the queue a set of handlers reads, idempotently. */
export async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  await boss.createQueue(name)
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
