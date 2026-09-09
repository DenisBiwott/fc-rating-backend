import { z } from 'zod'
import { eloParamsSchema } from '../../infra/db/queries/rating-configs.js'

export const ratingConfigParamsSchema = z.object({ id: z.string() })

export const ratingConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  algorithm: z.literal('elo'),
  params: eloParamsSchema,
  isActive: z.boolean(),
})

export const ratingConfigListResponseSchema = z.array(ratingConfigSchema)

export const createRatingConfigBodySchema = z.object({
  name: z.string().min(1),
  algorithm: z.literal('elo'),
  params: eloParamsSchema,
})

export const rebuildResponseSchema = z.object({ configId: z.string(), matchCount: z.number() })

const rankedPlayerSchema = z.object({
  playerId: z.string(),
  rating: z.number(),
  gamesPlayed: z.number(),
  rank: z.number(),
})

export const whatIfLeaderboardResponseSchema = z.object({
  configId: z.string(),
  entries: z.array(rankedPlayerSchema),
})
