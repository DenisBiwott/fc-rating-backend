import type { Database } from '../../../src/app/types.js'
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

export async function seedActiveConfig(
  db: Database,
  paramOverrides: Partial<{
    baseline: number
    kProvisional: number
    provisionalGames: number
    kEstablished: number
  }> = {},
) {
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

export async function seedPlayer(db: Database, name: string) {
  const [row] = await db.insert(players).values({ id: systemIds.newId(), name }).returning()
  if (row === undefined) throw new Error('seedPlayer: insert returned no row')
  return row
}
