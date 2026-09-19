import { eq } from 'drizzle-orm'
import type { Database } from '../../../src/app/types.js'
import type { EloParams } from '../../../src/domain/rating/types.js'
import { players, ratingConfigs, users } from '../../../src/infra/db/schema.js'
import { systemIds } from '../../../src/infra/ids.js'

export async function seedUser(db: Database, role: 'admin' | 'recorder' | 'viewer' = 'admin') {
  const [row] = await db
    .insert(users)
    .values({ id: systemIds.newId(), name: 'Test User', role })
    .returning()
  if (row === undefined) throw new Error('seedUser: insert returned no row')
  return row
}

export async function seedActiveConfig(db: Database, paramOverrides: Partial<EloParams> = {}) {
  const [row] = await db
    .insert(ratingConfigs)
    .values({
      id: systemIds.newId(),
      name: `test-elo-${systemIds.newId()}`,
      algorithm: 'elo',
      params: {
        baseline: 1200,
        kProvisional: 40,
        provisionalGames: 10,
        kEstablished: 24,
        drawScore: 0.5,
        ...paramOverrides,
      },
      isActive: true,
    })
    .returning()
  if (row === undefined) throw new Error('seedActiveConfig: insert returned no row')
  return row
}

/**
 * Makes a new config the active one — deactivating the current one first, since
 * rating_configs_one_active allows exactly one. Test setup only: recordMatch writes incremental
 * snapshots for the active config alone, so a config variant must be active to exercise that path.
 */
export async function activateNewConfig(db: Database, paramOverrides: Partial<EloParams> = {}) {
  await db.update(ratingConfigs).set({ isActive: false }).where(eq(ratingConfigs.isActive, true))
  return seedActiveConfig(db, paramOverrides)
}

export async function seedPlayer(db: Database, name: string) {
  const [row] = await db.insert(players).values({ id: systemIds.newId(), name }).returning()
  if (row === undefined) throw new Error('seedPlayer: insert returned no row')
  return row
}
