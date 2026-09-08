import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../src/infra/auth/password.js'
import { createDbClient } from '../src/infra/db/client.js'
import { ratingConfigs, users } from '../src/infra/db/schema.js'
import { systemIds } from '../src/infra/ids.js'

/** Seeds per fc-rating-backend/docs/DATABASE.md#seeds. Safe to run more than once. */

const databaseUrl = process.env.DATABASE_URL
const adminPassword = process.env.ADMIN_PASSWORD
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first.')
}
if (adminPassword === undefined) {
  throw new Error('ADMIN_PASSWORD is not set — copy .env.example to .env first.')
}

const db = createDbClient(databaseUrl)

const [existingAdmin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1)
if (existingAdmin === undefined) {
  await db.insert(users).values({
    id: systemIds.newId(),
    name: 'Admin',
    role: 'admin',
    passwordHash: await hashPassword(adminPassword),
  })
  console.log('Seeded admin user.')
} else {
  console.log('Admin user already exists, skipping.')
}

const [existingConfig] = await db
  .select()
  .from(ratingConfigs)
  .where(eq(ratingConfigs.name, 'default-elo'))
  .limit(1)
if (existingConfig === undefined) {
  await db.insert(ratingConfigs).values({
    id: systemIds.newId(),
    name: 'default-elo',
    algorithm: 'elo',
    params: {
      baseline: 1200,
      kProvisional: 40,
      provisionalGames: 10,
      kEstablished: 24,
      drawScore: 0.5,
    },
    isActive: true,
  })
  console.log('Seeded default-elo rating config.')
} else {
  console.log('default-elo rating config already exists, skipping.')
}

process.exit(0)
