import { describe, expect, test, vi } from 'vitest'

/*
 * The Web Push sender's contract, without touching a push service: the
 * library's answers are narrowed to the port's three — a 404/410 from the
 * push service is an expired subscription, everything else a transient
 * failure, and the payload travels as the JSON the service worker parses.
 * The module under test is imported after the mock below is armed.
 */

const sendNotification = vi.hoisted(() => vi.fn())
const generateVAPIDKeys = vi.hoisted(() =>
  vi.fn(() => ({ publicKey: 'public-key', privateKey: 'private-key' })),
)

vi.mock('web-push', () => ({
  default: { sendNotification, generateVAPIDKeys },
}))

const { createWebPushSender, generateVapidKeys } = await import('./webpush.ts')
const { createSilentLogger } = await import('../logging.ts')

const SUBJECT = 'mailto:push@example.com'

const CREDENTIALS = {
  endpoint: 'https://push.example/endpoint/1',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
}

describe('web push sender', () => {
  test('generated keys are the P-256 pair the protocol signs with', () => {
    const keys = generateVapidKeys()
    expect(keys).toEqual({ publicKey: 'public-key', privateKey: 'private-key' })
  })

  test('a 200 answers delivered and the payload leaves as JSON', async () => {
    const sender = createWebPushSender(
      { publicKey: 'public-key', privateKey: 'private-key' },
      createSilentLogger(),
      SUBJECT,
    )
    sendNotification.mockResolvedValueOnce(undefined)
    const result = await sender.send(CREDENTIALS, { title: 'Пора', body: 'Через 15 минут' })
    expect(result).toBe('delivered')
    const [, payload, options] = sendNotification.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ]
    expect(JSON.parse(payload)).toEqual({ title: 'Пора', body: 'Через 15 минут' })
    expect(options.vapidDetails).toEqual({
      subject: expect.stringMatching(/^mailto:/),
      publicKey: 'public-key',
      privateKey: 'private-key',
    })
    expect(options.TTL).toBeGreaterThan(0)
  })

  test('a 404 and a 410 answer expired — the push service says the subscription is gone', async () => {
    const sender = createWebPushSender(
      { publicKey: 'public-key', privateKey: 'private-key' },
      createSilentLogger(),
      SUBJECT,
    )
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 404 }))
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    expect(await sender.send(CREDENTIALS, { title: 't', body: 'b' })).toBe('expired')
    expect(await sender.send(CREDENTIALS, { title: 't', body: 'b' })).toBe('expired')
  })

  test('a throttled or network-level refusal answers failed and keeps the subscription', async () => {
    const sender = createWebPushSender(
      { publicKey: 'public-key', privateKey: 'private-key' },
      createSilentLogger(),
      SUBJECT,
    )
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 429 }))
    sendNotification.mockRejectedValueOnce(new Error('socket hung up'))
    expect(await sender.send(CREDENTIALS, { title: 't', body: 'b' })).toBe('failed')
    expect(await sender.send(CREDENTIALS, { title: 't', body: 'b' })).toBe('failed')
  })

  test('a refusal logs once per failed send, never on delivery', async () => {
    const logger = createSilentLogger()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const sender = createWebPushSender(
      { publicKey: 'public-key', privateKey: 'private-key' },
      logger,
      SUBJECT,
    )
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 429 }))
    await sender.send(CREDENTIALS, { title: 't', body: 'b' })
    expect(warn).toHaveBeenCalledTimes(1)
    sendNotification.mockResolvedValueOnce(undefined)
    await sender.send(CREDENTIALS, { title: 't', body: 'b' })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
