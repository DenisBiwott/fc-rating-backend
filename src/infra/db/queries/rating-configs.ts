import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { RatingConfig as DomainRatingConfig } from '../../../domain/rating/types.js'
import type { Queryable } from '../../../app/types.js'
import { ratingConfigs } from '../schema.js'

/**
 * The `elo` params shape from design doc §5.1 — drawScore is a fixed literal so nobody
 * "configures" it (see fc-rating-backend/docs/DATABASE.md#seeds). Exported so the HTTP layer's
 * create-rating-config request schema validates against the exact same shape, per algorithm.
 */
export const eloParamsSchema = z.object({
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

export class RatingConfigNotFoundError extends Error {
  constructor(id: string) {
    super(`Rating config not found: ${id}`)
    this.name = 'RatingConfigNotFoundError'
  }
}

export interface ResolvedRatingConfig {
  id: string
  config: DomainRatingConfig
}

export type RatingConfigRow = typeof ratingConfigs.$inferSelect
export type NewRatingConfigRow = typeof ratingConfigs.$inferInsert

/**
 * `params` is `jsonb` at the database level — untyped until Zod parses it here, per design doc
 * §4.2: "shape validated by Zod in the app layer, not the database."
 */
function toResolvedRatingConfig(row: RatingConfigRow): ResolvedRatingConfig {
  const params = eloParamsSchema.parse(row.params)
  return { id: row.id, config: { algorithm: 'elo', params } }
}

export async function getActiveRatingConfig(db: Queryable): Promise<ResolvedRatingConfig> {
  const [row] = await db
    .select()
    .from(ratingConfigs)
    .where(eq(ratingConfigs.isActive, true))
    .limit(1)
  if (row === undefined) throw new NoActiveRatingConfigError()
  return toResolvedRatingConfig(row)
}

export async function getRatingConfigById(
  db: Queryable,
  id: string,
): Promise<ResolvedRatingConfig> {
  const [row] = await db.select().from(ratingConfigs).where(eq(ratingConfigs.id, id)).limit(1)
  if (row === undefined) throw new RatingConfigNotFoundError(id)
  return toResolvedRatingConfig(row)
}

/** New configs are inactive by default (schema default) — the seeded default-elo config is the only active one at MVP; see docs/API.md's route table (no activate endpoint). */
export async function insertRatingConfig(
  db: Queryable,
  row: NewRatingConfigRow,
): Promise<RatingConfigRow> {
  const [inserted] = await db.insert(ratingConfigs).values(row).returning()
  if (inserted === undefined) throw new Error('insertRatingConfig: insert returned no row')
  return inserted
}

export async function listRatingConfigs(db: Queryable): Promise<RatingConfigRow[]> {
  return db.select().from(ratingConfigs).orderBy(ratingConfigs.createdAt)
}
