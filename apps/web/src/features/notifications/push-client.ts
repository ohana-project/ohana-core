/**
 * The narrow browser surface the push subscription flow needs (issue #22),
 * so the screen is testable without a browser — the service-worker
 * updates' precedent. The Web Push APIs live behind these interfaces; the
 * hooks hand them `window.Notification` and the registration's
 * `pushManager` in production and fakes in the tests.
 */

export type PushPermission = 'granted' | 'denied' | 'default'

/** The slice of `Notification` the flow touches. */
export interface NotificationContainer {
  get permission(): PushPermission
  requestPermission(): Promise<PushPermission>
}

/** The slice of `PushManager` the flow touches. */
export interface PushRegistrar {
  subscribe(options: {
    userVisibleOnly: true
    applicationServerKey: Uint8Array<ArrayBuffer>
  }): Promise<PushSubscriptionLike>
  getSubscription(): Promise<PushSubscriptionLike | null>
}

/** The slice of the browser's subscription the flow reads. */
export interface PushSubscriptionLike {
  endpoint: string
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

/** Where the device's own opt-in to details is kept between visits: the
 *  server sends by it; the switch seeds from it. */
const DETAILS_STORAGE_PREFIX = 'ohana.push.notifyDetails.'

export function readStoredDetails(endpoint: string): boolean {
  try {
    return window.localStorage.getItem(DETAILS_STORAGE_PREFIX + endpoint) === '1'
  } catch {
    return false
  }
}

export function storeDetails(endpoint: string, notifyDetails: boolean): void {
  try {
    window.localStorage.setItem(DETAILS_STORAGE_PREFIX + endpoint, notifyDetails ? '1' : '0')
  } catch {
    // A storage-less browser keeps the switch in memory only; the server's
    // value is what reminders answer to either way.
  }
}

/** The VAPID public key arrives base64url; the browser wants the bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

/**
 * The subscription flow's browser half: ask (the user gesture is the
 * caller's), register, and read the subscription back as the payload the
 * API's PUT takes.
 */
export async function subscribeOnDevice(input: {
  notification: NotificationContainer
  registrar: PushRegistrar
  publicKey: string
}): Promise<
  { kind: 'subscribed'; endpoint: string; p256dh: string; auth: string } | { kind: 'denied' }
> {
  if (input.notification.permission === 'denied') return { kind: 'denied' }
  const permission =
    input.notification.permission === 'granted'
      ? 'granted'
      : await input.notification.requestPermission()
  if (permission !== 'granted') return { kind: 'denied' }
  const subscription = await input.registrar.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(input.publicKey),
  })
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (p256dh === undefined || auth === undefined) {
    throw new Error('The browser produced a push subscription without keys')
  }
  return { kind: 'subscribed', endpoint: subscription.endpoint, p256dh, auth }
}

/** The device's current subscription, if the browser holds one. */
export async function currentSubscription(
  registrar: PushRegistrar,
): Promise<PushSubscriptionLike | null> {
  return registrar.getSubscription()
}
