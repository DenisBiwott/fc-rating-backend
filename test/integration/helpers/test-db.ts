import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { postgresTypes } from '../../../src/infra/db/connection-options.js'
import * as schema from '../../../src/infra/db/schema.js'

/**
 * A fresh, isolated Postgres *database* per test file, per docs/TESTING.md's "fresh schema per
 * test file" — one level up from a schema, not down. Drizzle's generated migration hardcodes
 * every type and foreign key to the literal "public" schema (pgTable defaults there unless you
 * opt into pgSchema()), so creating a same-database "test_xxx" schema and pointing search_path at
 * it doesn't work: "CREATE TYPE public.adjustment_type" still targets the real public schema and
 * collides with the dev database's own types. A separate database sidesteps this entirely — its
 * own "public" schema is a distinct, empty one.
 */

const adminUrl =
  process.env.DATABASE_URL ?? 'postgres://fc_rating:fc_rating@localhost:5432/fc_rating'

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>
  teardown: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const dbName = `test_${randomUUID().replaceAll('-', '')}`
  const url = new URL(adminUrl)

  const admin = postgres(url.toString(), { max: 1 })
  await admin.unsafe(`create database "${dbName}"`)
  await admin.end()

  url.pathname = `/${dbName}`
  const sql = postgres(url.toString(), { max: 5, types: postgresTypes })
  const db = drizzle(sql, { schema })

  await migrate(db, { migrationsFolder: 'src/infra/db/migrations' })

  return {
    db,
    teardown: async () => {
      await sql.end()
      const admin2 = postgres(new URL(adminUrl).toString(), { max: 1 })
      await admin2.unsafe(`drop database "${dbName}"`)
      await admin2.end()
    },
  }
}
