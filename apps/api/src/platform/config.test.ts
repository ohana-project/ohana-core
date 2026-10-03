import { describe, expect, test } from 'vitest'
import { ConfigError, loadConfig } from './config.ts'

/*
 * The configuration's own shape (architecture.md, "Configuration and
 * logging"): read once from the environment, validated with a TypeBox
 * schema, and a bad value stops startup with a clear message. The Web
 * Push contact (issue #22) is the one value whose malformed spelling
 * fails silently at send time — every push would answer 'failed' — so
 * its validation is pinned here.
 */

const VALID_ENVIRONMENT = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ohana:test@localhost:5432/ohana',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'access',
  STORAGE_SECRET_KEY: 'secret',
  STORAGE_BUCKET: 'ohana',
}

describe('pushVapidSubject', () => {
  test('a mailto: contact passes', async () => {
    const config = await loadConfig({
      ...VALID_ENVIRONMENT,
      PUSH_VAPID_SUBJECT: 'mailto:operator@example.com',
    })
    expect(config.pushVapidSubject).toBe('mailto:operator@example.com')
  })

  test('an https: contact passes', async () => {
    const config = await loadConfig({
      ...VALID_ENVIRONMENT,
      PUSH_VAPID_SUBJECT: 'https://ohana.example/contact',
    })
    expect(config.pushVapidSubject).toBe('https://ohana.example/contact')
  })

  test('a bare word is refused — every push would fail at send time', async () => {
    await expect(loadConfig({ ...VALID_ENVIRONMENT, PUSH_VAPID_SUBJECT: 'ohana' })).rejects.toThrow(
      ConfigError,
    )
  })

  test('a scheme without an address is refused', async () => {
    await expect(
      loadConfig({ ...VALID_ENVIRONMENT, PUSH_VAPID_SUBJECT: 'mailto:' }),
    ).rejects.toThrow(ConfigError)
  })

  test('trailing junk after the address is refused', async () => {
    await expect(
      loadConfig({ ...VALID_ENVIRONMENT, PUSH_VAPID_SUBJECT: 'mailto:a@b junk text' }),
    ).rejects.toThrow(ConfigError)
  })
})
