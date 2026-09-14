import 'dotenv/config'
import postgres from 'postgres'

/**
 * Drops both the public schema (our tables/views) and the drizzle schema (migration
 * bookkeeping). Dropping only public leaves __drizzle_migrations intact, so the next db:migrate
 * thinks every migration already ran and silently does nothing — followed by db:seed erroring
 * with "relation users does not exist". Followed by db:migrate + db:seed — see package.json's
 * db:reset.
 */

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first.')
}
if (databaseUrl.includes('neon.tech') && process.env.CONFIRM_PROD_RESET !== 'yes') {
  throw new Error(
    'Refusing to reset what looks like the production Neon database. If this is really ' +
      'intentional, re-run with CONFIRM_PROD_RESET=yes.',
  )
}

const client = postgres(databaseUrl, { max: 1 })
await client`drop schema if exists public cascade`
await client`drop schema if exists drizzle cascade`
await client`create schema public`
await client.end()
console.log('Dropped and recreated the public schema (and cleared drizzle migration state).')
