import { describe, expect, test } from 'vitest'
import { createDb } from '../platform/db/index.ts'
import { createSilentLogger } from '../platform/logging.ts'
import { createTestHarness } from '../testing/harness.ts'
import { buildWorker } from './buildWorker.ts'

describe('buildWorker', () => {
  test('starts against a reachable database and stops cleanly', async () => {
    const harness = await createTestHarness()
    try {
      const worker = buildWorker({ db: harness.db, logger: createSilentLogger() })
      await worker.start()
      await worker.stop()
    } finally {
      await harness.close()
    }
  })

  test('fails to start when the database is unreachable', async () => {
    const unreachable = createDb('postgresql://ohana:ohana@127.0.0.1:59999/none')
    try {
      const worker = buildWorker({ db: unreachable.db, logger: createSilentLogger() })
      await expect(worker.start()).rejects.toThrow()
    } finally {
      await unreachable.close()
    }
  })
})
