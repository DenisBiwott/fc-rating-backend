import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first.')
}

const migrationClient = postgres(databaseUrl, { max: 1 })
const db = drizzle(migrationClient)

// Session-scoped lock on this single connection so concurrently-starting instances (e.g. Cloud
// Run cold starts) block on each other instead of racing to apply the same migration twice.
await migrationClient`select pg_advisory_lock(hashtext('fc_rating_migrations'))`
try {
  await migrate(db, { migrationsFolder: './src/infra/db/migrations' })
  console.log('Migrations applied.')
} finally {
  await migrationClient`select pg_advisory_unlock(hashtext('fc_rating_migrations'))`
  await migrationClient.end()
}
