import { afterAll, describe, expect, test } from 'vitest'
import { DomainError } from '../../platform/errors.ts'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { getSpaceById } from './repository.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

describe('POST /api/v1/spaces', () => {
  test('creates a space and returns its representation', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Smith family' },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body).toEqual({
        id: expect.any(String),
        name: 'Smith family',
        revision: '0',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })

      const stored = await getSpaceById(harness.db, body.id)
      expect(stored).toBeDefined()
      expect(stored?.name).toBe('Smith family')
      expect(stored?.revision).toBe(0n)
      expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      await app.close()
    }
  })

  test('rejects an empty name with a validation error', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: '' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        error: { code: 'validation_failed', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })

  test('rejects unknown properties', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Smith family', plan: 'enterprise' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_failed')
    } finally {
      await app.close()
    }
  })
})

describe('error handling', () => {
  test('returns 404 with a machine-readable code for unknown routes', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/nope' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'not_found', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })

  test('maps domain errors to their status and stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/api/v1/boom', async () => {
      throw new DomainError('space_not_found', 'No such space', 404)
    })
    await app.ready()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/boom' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'space_not_found', message: 'No such space' },
      })
    } finally {
      await app.close()
    }
  })
})
