/**
 * The push port (architecture.md, "Push", ADR-0006): the one shape the
 * worker's reminder sending goes through. Tests substitute a recording
 * implementation; production uses the Web Push implementation below.
 */

/** The browser subscription's credentials, stored per device (issue #22). */
export interface PushCredentials {
  /** The push service's endpoint URL for this device. */
  endpoint: string
  /** The client's public ECDH key, base64url-encoded. */
  p256dh: string
  /** The authentication secret, base64url-encoded. */
  auth: string
}

/**
 * The notification the sender delivers. The payload travels as JSON — the
 * service worker parses it and calls the notifications API with the same
 * fields, so this shape is the worker–worker contract.
 */
export interface PushPayload {
  title: string
  body: string
  /** The device-side deduplication tag; one notification per reminder. */
  tag?: string
  /** The in-app path a tap on the notification opens. */
  url?: string
}

/**
 * The three answers a send can have: delivered; expired — the push service
 * rejected the subscription as gone (404/410), the caller deletes it;
 * failed — a transient refusal (network, throttling), the caller logs it
 * and the next reminder's send rides again.
 */
export type PushSendResult = 'delivered' | 'expired' | 'failed'

export interface PushSender {
  send(credentials: PushCredentials, payload: PushPayload): Promise<PushSendResult>
}

/** A VAPID key pair: the identity this installation signs pushes with. */
export interface VapidKeys {
  publicKey: string
  privateKey: string
}

/**
 * The host of a stored endpoint, for logs: endpoints work like capability
 * URLs, so their full spelling stays out of the logs — and a stored value
 * that cannot parse (the schema pins only the scheme) answers as
 * unparseable instead of throwing inside an error handler.
 */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return '<unparseable>'
  }
}

/**
 * The error as the logs may tell it: push endpoints work like capability
 * URLs, and the errors the push stack raises carry the whole endpoint —
 * web-push's own error objects keep it as a property, and a failed
 * removal keeps it among its query parameters — so only these narrowed
 * fields travel to the logs, never the raw error object.
 */
export function pushLogError(error: unknown): {
  name?: string
  statusCode?: unknown
  code?: unknown
} {
  const candidate = error as {
    name?: string
    statusCode?: unknown
    code?: unknown
    cause?: { code?: unknown }
  }
  return {
    name: candidate?.name,
    statusCode: candidate?.statusCode,
    code: candidate?.code ?? candidate?.cause?.code,
  }
}
