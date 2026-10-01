import { sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, describe, expect, test } from 'vitest'
import { instanceSettings } from '../modules/admin/tables.ts'
import { JOURNAL_PURGE_SWEEP_JOB } from '../modules/journal/index.ts'
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

const harness = await createTestHarness()

// The retention is an installation-wide singleton other test files may
// have changed (the files share one database); these tests assume the
// 30-day default.
await harness.db.delete(instanceSettings)

const DAY_MS = 24 * 60 * 60 * 1000

describe('buildWorker', () => {
  test('starts pg-boss against the test PostgreSQL, schedules the sweep, and stops cleanly', async () => {
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
    }
  })

  test('a queued purge job reaches the journal handler and deletes the due entry', async () => {
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
      // would: the job lands in the queue scheduled for its deletion date,
      // and only this sender's payload reaches the handler.
      const sender = createPgBossJobSender(boss)
      const deps: JournalDeps = { db: harness.db, clock: harness.clock, jobs: sender }
      const space = await harness.createSpace({ name: 'Очередь' })
      const author = await harness.createMember(space.id, { name: 'Аня' })
      const actor: JournalActor = { memberId: author.id, spaceId: space.id, role: 'regular' }
      const created = await createDraft(deps, actor, { text: 'ждёт своего часа' })
      const { entry, purgeAt } = await trashEntry(deps, actor, created.id)

      // pg-boss compares a job's start-after with the database's own
      // clock, not the harness's: the harness epoch is in the real past,
      // so the job is runnable the moment the worker polls. The handler
      // then re-checks due-ness on the controllable clock — which this
      // test has to move for the purge to be due.
      expect(purgeAt.getTime()).toBeLessThan(Date.now())
      harness.clock.advance(31 * DAY_MS)

      // The wait is bounded, and the queue's own rows tell the story when
      // it times out.
      const deadline = Date.now() + 30_000
      let gone = false
      let queueRows = ''
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
        const jobs = await harness.db.execute<{ name: string; state: string }>(
          sql`select name, state::text as state from pgboss.job order by name`,
        )
        queueRows = JSON.stringify(jobs.rows)
      }
      expect(gone, `queue rows at timeout: ${queueRows}`).toBe(true)

      await worker.stop()
    } finally {
      await boss.stop()
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

  afterAll(async () => {
    await harness.close()
  })
})
