import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { DomainError } from '../../platform/errors.ts'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { spaces } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

describe('POST /api/v1/spaces', () => {
  test('requires administrative authentication', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Smith family' },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'unauthorized', message: expect.any(String) },
      })
      const created = await harness.db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.name, 'Smith family'))
      expect(created).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  test('rejects before the payload is parsed', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: '{not json',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('unauthorized')
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

  test('reports malformed JSON as a client error with a stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/echo', async (request) => request.body)
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        payload: '{not json',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        error: { code: 'invalid_json', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })

  test('reports oversized payloads as a client error with a stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/echo', async (request) => request.body)
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        payload: JSON.stringify({ blob: 'x'.repeat(1_200_000) }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({
        error: { code: 'payload_too_large', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })
})
