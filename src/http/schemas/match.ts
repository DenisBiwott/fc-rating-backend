import { z } from 'zod'
import { paginatedResponseSchema, paginationQuerySchema } from './common.js'

export const matchParamsSchema = z.object({ id: z.string() })

/** Mirrors the domain EffectiveMatch shape (src/domain/match/types.ts) — no playedAt/session/recordedBy. */
export const effectiveMatchSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number(),
  awayScore: z.number(),
  isVoid: z.boolean(),
})

/** Mirrors EffectiveMatchDetail (src/infra/db/queries/match-effective.ts) — the list/detail shape. */
export const effectiveMatchDetailSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number(),
  awayScore: z.number(),
  isVoid: z.boolean(),
  playedAt: z.iso.datetime(),
  sessionId: z.string().nullable(),
  recordedBy: z.string(),
  recordedAt: z.iso.datetime(),
  decidedOnPenalties: z.boolean(),
})

const matchDtoSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number(),
  awayScore: z.number(),
  decidedOnPenalties: z.boolean(),
  playedAt: z.iso.datetime(),
  sessionId: z.string().nullable(),
  recordedBy: z.string(),
})

const ratingStateSchema = z.object({ rating: z.number(), gamesPlayed: z.number() })

const participantOutcomeSchema = z.object({
  playerId: z.string(),
  before: ratingStateSchema,
  after: ratingStateSchema,
  expectedScore: z.number(),
  actualScore: z.union([z.literal(1), z.literal(0.5), z.literal(0)]),
  delta: z.number(),
  wasProvisional: z.boolean(),
})

export const matchOutcomeSchema = z.object({
  home: participantOutcomeSchema,
  away: participantOutcomeSchema,
  upset: z.boolean(),
})

export const recordMatchBodySchema = z.object({
  id: z.uuid(),
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  decidedOnPenalties: z.boolean().optional(),
  playedAt: z.iso.datetime().optional(),
  sessionId: z.string().optional(),
})

export const previewMatchBodySchema = z.object({
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
})

export const rankChangeSchema = z.object({ playerId: z.string(), from: z.number(), to: z.number() })

export const recordMatchResponseSchema = z.object({
  match: matchDtoSchema,
  outcome: matchOutcomeSchema,
  rankChanges: z.array(rankChangeSchema),
})

export const listMatchesQuerySchema = paginationQuerySchema.extend({
  sessionId: z.string().optional(),
  playerId: z.string().optional(),
  includeVoided: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export const listMatchesResponseSchema = paginatedResponseSchema(effectiveMatchDetailSchema)

export const matchDetailResponseSchema = z.object({
  match: effectiveMatchDetailSchema,
  adjustments: z.array(
    z.object({
      id: z.string(),
      matchId: z.string(),
      sequence: z.number(),
      type: z.enum(['void', 'correct']),
      reason: z.string(),
      newHomePlayerId: z.string().nullable(),
      newAwayPlayerId: z.string().nullable(),
      newHomeScore: z.number().nullable(),
      newAwayScore: z.number().nullable(),
      adjustedBy: z.string(),
      adjustedAt: z.iso.datetime(),
    }),
  ),
  outcome: matchOutcomeSchema.nullable(),
})

export const voidMatchBodySchema = z.object({ reason: z.string().min(1) })

export const correctMatchBodySchema = z.object({
  reason: z.string().min(1),
  homePlayerId: z.string(),
  awayPlayerId: z.string(),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
})

export const adjustmentResultResponseSchema = z.object({
  match: effectiveMatchSchema,
  affectedPlayers: z.array(z.string()),
})

export const voidMatchPreviewResponseSchema = z.object({
  matchId: z.string(),
  players: z.array(
    z.object({
      playerId: z.string(),
      ratingBefore: z.number(),
      gamesPlayedBefore: z.number(),
      ratingAfter: z.number(),
      gamesPlayedAfter: z.number(),
    }),
  ),
  rankChanges: z.array(rankChangeSchema),
})
