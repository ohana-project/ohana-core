import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export type Db = NodePgDatabase<Record<string, never>>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx

export interface DatabaseHandle {
  db: Db
  close(): Promise<void>
}

export function createDb(databaseUrl: string): DatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 })
  return {
    db: drizzle(pool),
    close: () => pool.end(),
  }
}
