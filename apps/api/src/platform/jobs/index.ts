import type { Tx } from '../db/index.ts'

/**
 * A job to enqueue: the queue name and payload a worker handler consumes.
 * Payloads are plain JSON — they survive a round-trip through the queue's
 * storage, and a handler never receives a live object.
 */
export interface JobSubmission {
  name: string
  data: unknown
  /** The earliest moment the job may run; undefined means as soon as possible. */
  startAfter?: Date
}

/**
 * The jobs port (architecture.md, "Background jobs"). Submissions are sent
 * inside the caller's transaction, so a rollback takes the job with it and
 * a commit publishes the job exactly with the domain change that caused it
 * (ADR-0009). The worker side claims and executes them; handlers stay safe
 * to repeat, because delivery is at-least-once.
 */
export interface JobSender {
  sendInTx(tx: Tx, submission: JobSubmission): Promise<void>
}

/** A queue to ensure, with the creation options a queue's contract needs —
 *  the retries a cleanup job exists for are declared here, not hoped for.
 *  The pg-boss adapter applies it through `ensureQueues`. */
export interface QueueSetup {
  name: string
  options?: { retryLimit?: number; retryDelay?: number; retryBackoff?: boolean }
}
