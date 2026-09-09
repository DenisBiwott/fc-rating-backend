import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { closeSession } from '../../app/close-session.js'
import { currentSession } from '../../app/current-session.js'
import { listSessions } from '../../app/list-sessions.js'
import { openSession } from '../../app/open-session.js'
import { sessionSummary, type SessionSummaryResult } from '../../app/session-summary.js'
import type { Deps } from '../../app/types.js'
import type { SessionRow } from '../../infra/db/queries/sessions.js'
import { requireRole, sessionUserOrThrow } from '../plugins/auth.js'
import {
  openSessionBodySchema,
  sessionListResponseSchema,
  sessionParamsSchema,
  sessionSchema,
  sessionSummaryResponseSchema,
} from '../schemas/session.js'

function toSessionDto(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    createdBy: row.createdBy,
  }
}

function toSessionSummaryDto(result: SessionSummaryResult) {
  return {
    id: result.id,
    name: result.name,
    startedAt: result.startedAt.toISOString(),
    endedAt: result.endedAt === null ? null : result.endedAt.toISOString(),
    matchCount: result.matchCount,
    playerDeltas: result.playerDeltas.map((delta) => ({ ...delta })),
    biggestMover: result.biggestMover === null ? null : { ...result.biggestMover },
    upsetCount: result.upsetCount,
  }
}

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/sessions',
    {
      preHandler: requireRole('recorder'),
      schema: { body: openSessionBodySchema, response: { 201: sessionSchema } },
    },
    async (request, reply) => {
      const { userId } = sessionUserOrThrow(request)
      const session = await openSession(deps, { name: request.body.name, createdBy: userId })
      return reply.code(201).send(toSessionDto(session))
    },
  )

  typed.get(
    '/sessions',
    {
      preHandler: requireRole('viewer'),
      schema: { response: { 200: sessionListResponseSchema } },
    },
    async () => (await listSessions(deps)).map(toSessionDto),
  )

  typed.get(
    '/sessions/current',
    {
      preHandler: requireRole('viewer'),
      schema: { response: { 200: sessionSchema, 204: z.undefined() } },
    },
    async (_request, reply) => {
      const session = await currentSession(deps)
      if (session === undefined) {
        await reply.code(204).send(undefined)
        return
      }
      return toSessionDto(session)
    },
  )

  typed.get(
    '/sessions/:id',
    {
      preHandler: requireRole('viewer'),
      schema: { params: sessionParamsSchema, response: { 200: sessionSummaryResponseSchema } },
    },
    async (request) => toSessionSummaryDto(await sessionSummary(deps, request.params.id)),
  )

  typed.post(
    '/sessions/:id/close',
    {
      preHandler: requireRole('recorder'),
      schema: { params: sessionParamsSchema, response: { 200: sessionSchema } },
    },
    async (request) => toSessionDto(await closeSession(deps, { sessionId: request.params.id })),
  )
}
