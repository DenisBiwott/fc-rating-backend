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

await migrate(db, { migrationsFolder: './src/infra/db/migrations' })
await migrationClient.end()
console.log('Migrations applied.')
