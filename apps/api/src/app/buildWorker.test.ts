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
import { fixedClock } from '../platform/clock.ts'
import { createDb } from '../platform/db/index.ts'
import { createPgBossJobSender, startJobQueue } from '../platform/jobs/pgboss.ts'
import { createSilentLogger } from '../platform/logging.ts'
import { createTestHarness, recordingPushSender } from '../testing/harness.ts'
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
        storage: harness.storage,
        push: recordingPushSender(),
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
      // Its clock stands past the retention, so the purge is due whenever
      // the handler runs: the job is claimable the moment the trash
      // commits, and the test must not race the worker's first poll for a
      // clock advance. The service below keeps the harness's clock — the
      // two clocks in one test are deliberate.
      const workerClock = fixedClock(new Date(harness.clock.now().getTime() + 31 * DAY_MS))
      const worker = buildWorker({
        db: harness.db,
        clock: workerClock,
        logger: createSilentLogger(),
        storage: harness.storage,
        push: recordingPushSender(),
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

      // The start-after must sit in the database's real past for the job to
      // be runnable the moment the worker polls; the harness epoch plus the
      // default retention guarantees it.
      expect(
        purgeAt.getTime(),
        'purgeAt is in the real future: pg-boss will not release the job before the wait times out',
      ).toBeLessThan(Date.now())
      // And the worker's clock must already have the entry due: a default
      // retention that grew past the offset above would otherwise surface
      // only as that same timeout.
      expect(
        purgeAt.getTime(),
        'the worker clock stands before the deletion date: the handler answers not-due and the wait times out',
      ).toBeLessThanOrEqual(workerClock.now().getTime())

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
        storage: harness.storage,
        push: recordingPushSender(),
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
