import { sql } from 'drizzle-orm'
import { afterAll, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { createPgBossJobSender, ensureQueue, startJobQueue } from './pgboss.ts'

/*
 * The queue's integration test (issue #16, ADR-0009): the pinned pg-boss
 * version runs against the real PostgreSQL 18 the tests use, and a job
 * submitted through the jobs port shares the domain transaction's fate —
 * delivered on commit, gone on rollback. This is the seam the reminder and
 * photo tickets build on.
 */

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

test('the pinned pg-boss starts against PostgreSQL 18', async () => {
  const boss = await startJobQueue(harness.environment.databaseUrl)
  try {
    await ensureQueue(boss, 'jobs-integration-start')
  } finally {
    await boss.stop()
  }
})

test('a job sent inside a transaction commits with the domain change', async () => {
  const queue = 'jobs-integration-commit'
  const boss = await startJobQueue(harness.environment.databaseUrl)
  try {
    await ensureQueue(boss, queue)
    const sender = createPgBossJobSender(boss)
    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the job was never delivered')), 15_000)
      void boss.work(queue, async (jobs) => {
        clearTimeout(timer)
        resolve(jobs[0]?.data)
      })
    })

    await harness.db.transaction(async (tx) => {
      await sender.sendInTx(tx, { name: queue, data: { answer: 42 } })
    })

    expect(await received).toEqual({ answer: 42 })
  } finally {
    await boss.stop()
  }
})

test('a rollback takes the job with the domain change', async () => {
  const queue = 'jobs-integration-rollback'
  const boss = await startJobQueue(harness.environment.databaseUrl)
  try {
    await ensureQueue(boss, queue)
    const sender = createPgBossJobSender(boss)

    const rolledBack = harness.db.transaction(async (tx) => {
      await sender.sendInTx(tx, { name: queue, data: { answer: 0 } })
      throw new Error('the domain change was refused')
    })
    await expect(rolledBack).rejects.toThrow('the domain change was refused')

    const rows = await harness.db.execute<{ count: string }>(
      sql`select count(*)::text as count from pgboss.job where name = ${queue}`,
    )
    // The rolled-back submission must have left no row behind — not even a
    // cancelled or dead one.
    expect(rows.rows.map((row) => row.count)).toEqual(['0'])
  } finally {
    await boss.stop()
  }
})

test('a scheduled submission carries its start-after moment', async () => {
  const queue = 'jobs-integration-schedule'
  const boss = await startJobQueue(harness.environment.databaseUrl)
  try {
    await ensureQueue(boss, queue)
    const sender = createPgBossJobSender(boss)
    const startAfter = new Date(Date.now() + 60 * 60 * 1000)
    await harness.db.transaction(async (tx) => {
      await sender.sendInTx(tx, { name: queue, data: { sooner: false }, startAfter })
      await sender.sendInTx(tx, { name: queue, data: { sooner: true } })
    })

    const rows = await harness.db.execute<{ data: { sooner: boolean }; startafter: unknown }>(
      sql`select data, start_after as "startafter" from pgboss.job where name = ${queue}`,
    )
    const scheduled = rows.rows.find((row) => row.data.sooner === false)
    const immediate = rows.rows.find((row) => row.data.sooner === true)
    // The driver's answer for a raw timestamptz need not be a Date; the
    // moment it names is what the claim is about.
    expect(scheduled === undefined ? NaN : new Date(scheduled.startafter as string).getTime()).toBe(
      startAfter.getTime(),
    )
    expect(
      immediate === undefined ? Infinity : new Date(immediate.startafter as string).getTime(),
    ).toBeLessThanOrEqual(Date.now())
  } finally {
    await boss.stop()
  }
})
