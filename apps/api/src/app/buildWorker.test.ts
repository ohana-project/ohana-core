import { sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { describe, expect, test } from 'vitest'
import { JOURNAL_PURGE_JOB, JOURNAL_PURGE_SWEEP_JOB } from '../modules/journal/index.ts'
import {
  createDraft,
  type JournalActor,
  type JournalDeps,
  trashEntry,
} from '../modules/journal/service.ts'
import { createDb } from '../platform/db/index.ts'
import { createPgBossJobSender, startJobQueue } from '../platform/jobs/pgboss.ts'
import { createSilentLogger } from '../platform/logging.ts'
import { createTestHarness } from '../testing/harness.ts'
import { buildWorker } from './buildWorker.ts'

const DAY_MS = 24 * 60 * 60 * 1000

describe('buildWorker', () => {
  test('starts pg-boss against the test PostgreSQL, schedules the sweep, and stops cleanly', async () => {
    const harness = await createTestHarness()
    const boss = await startJobQueue(harness.environment.databaseUrl, createSilentLogger())
    try {
      const worker = buildWorker({
        db: harness.db,
        clock: harness.clock,
        logger: createSilentLogger(),
        boss,
      })
      await worker.start()

      // The sweep's cron is registered, so a restart never loses it.
      const schedules = await boss.getSchedules(JOURNAL_PURGE_SWEEP_JOB)
      expect(schedules.length).toBeGreaterThan(0)

      await worker.stop()
    } finally {
      await boss.stop()
      await harness.close()
    }
  })

  test('a queued purge job reaches the journal handler and deletes the due entry', async () => {
    const harness = await createTestHarness()
    const boss = await startJobQueue(harness.environment.databaseUrl, createSilentLogger())
    try {
      // The worker starts first, as the deployment does: its start() is
      // what ensures the queues exist — a send into a queue nobody created
      // is refused outright, and the api must not depend on this order.
      const worker = buildWorker({
        db: harness.db,
        clock: harness.clock,
        logger: createSilentLogger(),
        boss,
      })
      await worker.start()

      // The trash runs through the real sender, exactly as the api process
      // would: the job lands in the queue with its 30-day delay.
      const sender = createPgBossJobSender(boss)
      const deps: JournalDeps = { db: harness.db, clock: harness.clock, jobs: sender }
      const space = await harness.createSpace({ name: 'Очередь' })
      const author = await harness.createMember(space.id, { name: 'Аня' })
      const actor: JournalActor = { memberId: author.id, spaceId: space.id, role: 'regular' }
      const created = await createDraft(deps, actor, { text: 'ждёт своего часа' })
      const { entry } = await trashEntry(deps, actor, created.id)

      // The retention runs out. The scheduled job itself waits for its
      // start-after, so the test hands the worker a second, immediately
      // runnable job for the same entry — the at-least-once shape the
      // queue promises.
      harness.clock.advance(31 * DAY_MS)
      await boss.send(JOURNAL_PURGE_JOB, { spaceId: space.id, entryId: entry.id })

      // The handler's own re-checks make the wait bounded: the entry is
      // due the moment the worker is up. The queue's own row tells the
      // story when the wait runs out.
      const deadline = Date.now() + 30_000
      let gone = false
      while (Date.now() < deadline) {
        const rows = await harness.db.execute<{ state: string }>(
          sql`select state from journal_entries where id = ${entry.id}`,
        )
        if (rows.rows.length === 0) {
          gone = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!gone) {
        const jobs = await harness.db.execute<{ name: string; state: string; retrycount: number }>(
          sql`select name, state::text as state, retry_count as retrycount from pgboss.job order by name`,
        )
        console.log('queue state at timeout', JSON.stringify(jobs.rows))
      }
      expect(gone).toBe(true)

      await worker.stop()
    } finally {
      await boss.stop()
      await harness.close()
    }
  })

  test('fails to start when the database is unreachable', async () => {
    const unreachableUrl = 'postgresql://ohana:ohana@127.0.0.1:59999/none'
    const unreachable = createDb(unreachableUrl)
    try {
      const worker = buildWorker({
        db: unreachable.db,
        clock: { now: () => new Date() },
        logger: createSilentLogger(),
        // The boss is never started: the worker's first statement is what
        // the entrypoint sees fail.
        boss: new PgBoss({ connectionString: unreachableUrl }),
      })
      await expect(worker.start()).rejects.toThrow()
    } finally {
      await unreachable.close()
    }
  })
})
