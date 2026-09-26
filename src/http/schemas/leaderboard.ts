import { z } from 'zod'

const matchResultSchema = z.enum(['W', 'L', 'D'])

const leaderboardEntrySchema = z.object({
  rank: z.number(),
  playerId: z.string(),
  rating: z.number(),
  gamesPlayed: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  winPct: z.number(),
  form: z.array(matchResultSchema),
  streak: z.object({ result: matchResultSchema, length: z.number() }).nullable(),
  isProvisional: z.boolean(),
})

/** Omitted: the latest session's table (all-time if no session exists). */
export const leaderboardQuerySchema = z.object({
  session: z.union([z.literal('all-time'), z.uuid()]).optional(),
})

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
  meanRating: z.number(),
  ratingConfig: z.object({ name: z.string(), provisionalGames: z.number().int() }),
  session: z.object({ id: z.string(), name: z.string() }).nullable(),
})
