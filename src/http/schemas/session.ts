import { z } from 'zod'

export const sessionParamsSchema = z.object({ id: z.string() })

export const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  createdBy: z.string(),
})

export const sessionListResponseSchema = z.array(sessionSchema)

export const openSessionBodySchema = z.object({ name: z.string().min(1) })

export const renameSessionBodySchema = z.object({ name: z.string().min(1) })

const playerSessionDeltaSchema = z.object({ playerId: z.string(), delta: z.number() })

export const sessionSummaryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  matchCount: z.number(),
  playerDeltas: z.array(playerSessionDeltaSchema),
  biggestMover: playerSessionDeltaSchema.nullable(),
  upsetCount: z.number(),
})
