import webpush from 'web-push'
import type { Logger } from '../logging.ts'
import type {
  PushCredentials,
  PushPayload,
  PushSender,
  PushSendResult,
  VapidKeys,
} from './index.ts'

/*
 * The Web Push implementation of the push port (ADR-0006): messages are
 * encrypted and signed here with the installation's VAPID keys and handed
 * to the endpoint's push service. The library's answers are narrowed to
 * the port's three: a 404 or 410 from the push service means the
 * subscription is gone — the browser was uninstalled, the permission
 * revoked, the endpoint rotated — and the caller removes the row; every
 * other failure is transient and only logged, because the next
 * occurrence's reminder sends again (ADR-0009: delivery is not assumed
 * exactly-once).
 */

/**
 * How long a push service holds an undeliverable message for an offline
 * device. A reminder that arrives days late is noise, not a reminder —
 * the queue redelivers long before this expires on any healthy
 * deployment.
 */
const PUSH_TTL_SECONDS = 6 * 60 * 60

/** The VAPID subject identifies the installation to the push services. */
const VAPID_SUBJECT = 'mailto:ohana@example.com'

/** The VAPID key pair for a fresh installation: 256-bit P-256, the shape
 *  the Web Push protocol names. */
export function generateVapidKeys(): VapidKeys {
  const keys = webpush.generateVAPIDKeys()
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}

export function createWebPushSender(vapid: VapidKeys, logger: Logger): PushSender {
  const vapidDetails = {
    subject: VAPID_SUBJECT,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  }
  return {
    async send(credentials: PushCredentials, payload: PushPayload): Promise<PushSendResult> {
      try {
        await webpush.sendNotification(
          {
            endpoint: credentials.endpoint,
            keys: { p256dh: credentials.p256dh, auth: credentials.auth },
          },
          JSON.stringify(payload),
          { vapidDetails, TTL: PUSH_TTL_SECONDS, headers: { Urgency: 'normal' } },
        )
        return 'delivered'
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode
        if (status === 404 || status === 410) return 'expired'
        logger.warn(
          { err: error, endpoint: credentials.endpoint },
          'Web Push delivery failed; the subscription is kept',
        )
        return 'failed'
      }
    },
  }
}
