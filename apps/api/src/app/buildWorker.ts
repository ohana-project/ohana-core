import { sql } from 'drizzle-orm'
import type { Db } from '../platform/db/index.ts'
import type { Logger } from '../platform/logging.ts'

export interface WorkerDeps {
  db: Db
  logger: Logger
}

export interface Worker {
  start(): Promise<void>
  stop(): Promise<void>
}

// Job handlers register here as modules add them (docs/architecture.md, Background jobs).
export function buildWorker(deps: WorkerDeps): Worker {
  return {
    async start() {
      await deps.db.execute(sql`select 1`)
      deps.logger.info('Worker started')
    },
    async stop() {
      deps.logger.info('Worker stopped')
    },
  }
}
