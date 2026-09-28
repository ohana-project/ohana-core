import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './index.ts'

function migrationsFolder(): string {
  return fileURLToPath(new URL('../../db/migrations', import.meta.url))
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() })
}
