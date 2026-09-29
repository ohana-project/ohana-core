// Container healthcheck for the worker service: the worker has no HTTP
// endpoint, so being healthy is a live round trip to the job database.
import { sql } from 'drizzle-orm'
import { createDb } from '../src/platform/db/index.ts'

const { db, close } = createDb(process.env.DATABASE_URL)
try {
  await db.execute(sql`select 1`)
} finally {
  await close()
}
