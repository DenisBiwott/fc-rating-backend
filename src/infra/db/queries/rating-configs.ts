import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ELO_FEATURE_DEFAULTS as DEFAULTS } from '../../../domain/rating/elo.js'
import type { RatingConfig as DomainRatingConfig } from '../../../domain/rating/types.js'
import type { Queryable } from '../../../app/types.js'
import { ratingConfigs } from '../schema.js'

const multiplier = z.number().gt(0).max(1)

/**
 * The `elo` params shape from design doc §5.1 — drawScore is a fixed literal so nobody
 * "configures" it (see fc-rating-backend/docs/DATABASE.md#seeds). Exported so the HTTP layer's
 * create-rating-config request schema validates against the exact same shape, per algorithm.
 *
 * Everything after drawScore is an optional, default-off refinement (see EloParams). Defaults are
 * filled here, on the way in, so a created config is stored fully explicit and its meaning never
 * shifts if a code-level default does; a config stored before expectationScale existed reads back
 * as 400, which is what it always meant. `.exactOptional()` (not `.optional()`) because EloParams
 * only allows an absent key, never an explicit undefined.
 */
export const eloParamsSchema = z
  .object({
    baseline: z.number(),
    kProvisional: z.number(),
    provisionalGames: z.number().int().nonnegative(),
    kEstablished: z.number(),
    drawScore: z.literal(0.5),
    expectationScale: z.number().positive().default(DEFAULTS.expectationScale),
    goalDifferenceFactor: z
      .object({
        enabled: z.boolean(),
        divisor: z.number().positive().default(DEFAULTS.goalDifferenceFactor.divisor),
        // >= 1 so a goal difference can only ever raise K, and a 0 difference stays exactly 1.
        cap: z.number().min(1).default(DEFAULTS.goalDifferenceFactor.cap),
      })
      .exactOptional(),
    eliteK: z
      .object({
        enabled: z.boolean(),
        enterAt: z.number().default(DEFAULTS.eliteK.enterAt),
        exitAt: z.number().default(DEFAULTS.eliteK.exitAt),
        k: z.number().positive(),
        requireEstablished: z.boolean().default(DEFAULTS.eliteK.requireEstablished),
      })
      .refine((eliteK) => eliteK.exitAt <= eliteK.enterAt, {
        message: 'exitAt must not exceed enterAt — the hysteresis band would be inverted',
        path: ['exitAt'],
      })
      .exactOptional(),
    repeatOpponentDamping: z
      .object({
        enabled: z.boolean(),
        threshold: z.number().int().nonnegative().default(DEFAULTS.repeatOpponentDamping.threshold),
        factor: multiplier.default(DEFAULTS.repeatOpponentDamping.factor),
        minMultiplier: multiplier.default(DEFAULTS.repeatOpponentDamping.minMultiplier),
      })
      .exactOptional(),
    maxDelta: z.number().positive().exactOptional(),
    ratingFloor: z.number().exactOptional(),
  })
  // A floor above the baseline would jump every new player to the floor after one match, and
  // would make below-floor states reachable — which the engine's properties assume they aren't.
  .refine((params) => params.ratingFloor === undefined || params.ratingFloor <= params.baseline, {
    message: 'ratingFloor must not exceed baseline',
    path: ['ratingFloor'],
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
  name: string
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
  return { id: row.id, name: row.name, config: { algorithm: 'elo', params } }
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
