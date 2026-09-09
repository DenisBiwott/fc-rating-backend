import { z } from 'zod'
import { paginatedResponseSchema } from './common.js'
import { effectiveMatchSchema } from './match.js'

export const playerParamsSchema = z.object({ id: z.string() })

export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  isActive: z.boolean(),
})

export const playerListResponseSchema = z.array(playerSchema)

export const createPlayerBodySchema = z.object({
  name: z.string().min(1),
  avatarUrl: z.url().optional(),
})

export const updatePlayerBodySchema = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: z.url().nullable().optional(),
  isActive: z.boolean().optional(),
})

export const listPlayersQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

const matchResultSchema = z.enum(['W', 'L', 'D'])

export const playerProfileResponseSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  rating: z.number(),
  gamesPlayed: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  form: z.array(matchResultSchema),
  streak: z.object({ result: matchResultSchema, length: z.number() }).nullable(),
  bestStreak: z.object({ result: matchResultSchema, length: z.number() }).nullable(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  isProvisional: z.boolean(),
})

export const ratingHistoryEntrySchema = z.object({
  matchId: z.string(),
  sequence: z.number(),
  playedAt: z.iso.datetime(),
  before: z.number(),
  after: z.number(),
  delta: z.number(),
})

export const ratingHistoryResponseSchema = z.array(ratingHistoryEntrySchema)

export const playerMatchesResponseSchema = paginatedResponseSchema(effectiveMatchSchema)
