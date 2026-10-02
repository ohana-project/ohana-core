import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type NotificationContainer,
  type PushRegistrar,
  readStoredDetails,
  storeDetails,
  subscribeOnDevice,
  urlBase64ToUint8Array,
} from './push-client.ts'

/*
 * The browser half of the subscription flow (issue #22), driven through
 * fakes: the permission gate stands before any subscribe call, and the
 * subscription the browser mints is read back as the payload the API's PUT
 * takes.
 */

class FakeNotification implements NotificationContainer {
  permission: 'granted' | 'denied' | 'default'
  private next: 'granted' | 'denied'
  requested = 0

  constructor(
    permission: NotificationContainer['permission'],
    next: 'granted' | 'denied' = 'granted',
  ) {
    this.permission = permission
    this.next = next
  }

  async requestPermission() {
    this.requested += 1
    this.permission = this.next
    return this.permission
  }
}

class FakeSubscription {
  readonly endpoint: string
  readonly keys: { p256dh: string; auth: string }
  private readonly onUnsubscribe: (() => void) | undefined

  constructor(
    endpoint: string,
    keys: { p256dh: string; auth: string },
    onUnsubscribe?: () => void,
  ) {
    this.endpoint = endpoint
    this.keys = keys
    this.onUnsubscribe = onUnsubscribe
  }

  toJSON() {
    return { endpoint: this.endpoint, keys: this.keys }
  }

  async unsubscribe() {
    this.onUnsubscribe?.()
    return true
  }
}

function fakeRegistrar(subscription: FakeSubscription | null): PushRegistrar & {
  subscribeOptions?: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }
} {
  return {
    subscribeOptions: undefined,
    async subscribe(options) {
      this.subscribeOptions = options
      return subscription as never
    },
    async getSubscription() {
      return subscription
    },
  }
}

const PUBLIC_KEY =
  'BGr5ELMqT2NlXWpvZdFwqFlOoZSPQxKMyh0Fh-_KqVvDQIY_P8f7PZnH0sOzM6GNog1VvY6dS7V0Q8j2p6lmesi'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url with padding and url-safe alphabet back to bytes', () => {
    const bytes = urlBase64ToUint8Array('A-b_')
    expect([...bytes]).toEqual([3, 230, 255])
  })

  it('round-trips the VAPID key shape the browser signs up against', () => {
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY)
    expect(bytes.length).toBe(65)
  })
})

describe('subscribeOnDevice', () => {
  it('asks only when the permission is still unset, then registers with the key bytes', async () => {
    const notification = new FakeNotification('default')
    const registrar = fakeRegistrar(
      new FakeSubscription('https://push.example/1', { p256dh: 'p', auth: 'a' }),
    )
    const result = await subscribeOnDevice({ notification, registrar, publicKey: PUBLIC_KEY })
    expect(notification.requested).toBe(1)
    expect(registrar.subscribeOptions?.userVisibleOnly).toBe(true)
    expect(registrar.subscribeOptions?.applicationServerKey.length).toBe(65)
    expect(result).toEqual({
      kind: 'subscribed',
      endpoint: 'https://push.example/1',
      p256dh: 'p',
      auth: 'a',
    })
  })

  it('a granted permission subscribes without asking again', async () => {
    const notification = new FakeNotification('granted')
    const registrar = fakeRegistrar(
      new FakeSubscription('https://push.example/2', { p256dh: 'p', auth: 'a' }),
    )
    await subscribeOnDevice({ notification, registrar, publicKey: PUBLIC_KEY })
    expect(notification.requested).toBe(0)
  })

  it('a refusal answers denied and never reaches the push manager', async () => {
    const notification = new FakeNotification('default', 'denied')
    const registrar = fakeRegistrar(null)
    const result = await subscribeOnDevice({ notification, registrar, publicKey: PUBLIC_KEY })
    expect(result).toEqual({ kind: 'denied' })
    expect(registrar.subscribeOptions).toBeUndefined()
  })

  it('an already-blocked permission answers denied without asking', async () => {
    const notification = new FakeNotification('denied')
    const registrar = fakeRegistrar(null)
    const result = await subscribeOnDevice({ notification, registrar, publicKey: PUBLIC_KEY })
    expect(result).toEqual({ kind: 'denied' })
    expect(notification.requested).toBe(0)
  })
})

describe('the device opt-in kept between visits', () => {
  it('stores and reads back per endpoint', () => {
    storeDetails('https://push.example/1', true)
    storeDetails('https://push.example/2', false)
    expect(readStoredDetails('https://push.example/1')).toBe(true)
    expect(readStoredDetails('https://push.example/2')).toBe(false)
    expect(readStoredDetails('https://push.example/3')).toBe(false)
  })

  it('answers false when storage refuses', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredDetails('https://push.example/1')).toBe(false)
    expect(getItem).toHaveBeenCalled()
  })
})
