import { describe, expect, test } from 'vitest'
import { createTestHarness, readTestEnvironment } from '../../testing/harness.ts'
import { createDb } from '../db/index.ts'
import { createS3Storage } from '../storage/s3.ts'

describe('GET /api/health', () => {
  test('reports ok when the database and object storage are reachable', async () => {
    const harness = await createTestHarness()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        status: 'ok',
        checks: { database: 'up', storage: 'up' },
      })
    } finally {
      await app.close()
      await harness.close()
    }
  })

  test('reports degraded when object storage is unreachable', async () => {
    const harness = await createTestHarness()
    const environment = readTestEnvironment()
    const unreachableStorage = createS3Storage({
      endpoint: 'http://127.0.0.1:9',
      region: 'us-east-1',
      accessKeyId: environment.storageAccessKey,
      secretAccessKey: environment.storageSecretKey,
      bucket: environment.storageBucket,
    })
    const app = harness.buildTestApp({ storage: unreachableStorage })
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({
        status: 'degraded',
        checks: { database: 'up', storage: 'down' },
      })
    } finally {
      await app.close()
      await harness.close()
    }
  })

  test('reports degraded when the database is unreachable', async () => {
    const harness = await createTestHarness()
    const unreachableDb = createDb('postgresql://ohana:ohana@127.0.0.1:59999/none')
    const app = harness.buildTestApp({ db: unreachableDb.db })
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({
        status: 'degraded',
        checks: { database: 'down', storage: 'up' },
      })
    } finally {
      await app.close()
      await unreachableDb.close()
      await harness.close()
    }
  })
})
