import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { RatingConfig as DomainRatingConfig } from '../../../domain/rating/types.js'
import type { Queryable } from '../../../app/types.js'
import { ratingConfigs } from '../schema.js'

/**
 * The `elo` params shape from design doc §5.1 — drawScore is a fixed literal so nobody
 * "configures" it (see fc-rating-backend/docs/DATABASE.md#seeds).
 */
const eloParamsSchema = z.object({
  baseline: z.number(),
  kProvisional: z.number(),
  provisionalGames: z.number().int().nonnegative(),
  kEstablished: z.number(),
  drawScore: z.literal(0.5),
})

export class NoActiveRatingConfigError extends Error {
  constructor() {
    super('No active rating config — exactly one is required (see rating_configs_one_active).')
    this.name = 'NoActiveRatingConfigError'
  }
}

export interface ActiveRatingConfig {
  id: string
  config: DomainRatingConfig
}

/**
 * `params` is `jsonb` at the database level — untyped until Zod parses it here, per design doc
 * §4.2: "shape validated by Zod in the app layer, not the database."
 */
export async function getActiveRatingConfig(db: Queryable): Promise<ActiveRatingConfig> {
  const [row] = await db
    .select()
    .from(ratingConfigs)
    .where(eq(ratingConfigs.isActive, true))
    .limit(1)
  if (row === undefined) throw new NoActiveRatingConfigError()

  const params = eloParamsSchema.parse(row.params)
  return { id: row.id, config: { algorithm: 'elo', params } }
}
