import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { correctMatch } from '../../app/correct-match.js'
import { listMatches, type ListMatchesResult } from '../../app/list-matches.js'
import { matchDetail, type MatchDetailResult } from '../../app/match-detail.js'
import { previewMatch } from '../../app/preview-match.js'
import { recordMatch, type MatchDto } from '../../app/record-match.js'
import type { Deps } from '../../app/types.js'
import { voidMatch } from '../../app/void-match.js'
import { previewVoidMatch } from '../../app/void-match-preview.js'
import { omitUndefined } from '../omit-undefined.js'
import { requireRole, sessionUserOrThrow } from '../plugins/auth.js'
import {
  adjustmentResultResponseSchema,
  correctMatchBodySchema,
  listMatchesQuerySchema,
  listMatchesResponseSchema,
  matchDetailResponseSchema,
  matchOutcomeSchema,
  matchParamsSchema,
  previewMatchBodySchema,
  recordMatchBodySchema,
  recordMatchResponseSchema,
  voidMatchBodySchema,
  voidMatchPreviewResponseSchema,
} from '../schemas/match.js'

function serializeMatchDto(match: MatchDto) {
  return { ...match, playedAt: match.playedAt.toISOString() }
}

function serializeMatchList(result: ListMatchesResult) {
  return {
    items: result.items.map((match) => ({
      ...match,
      playedAt: match.playedAt.toISOString(),
      recordedAt: match.recordedAt.toISOString(),
    })),
    nextCursor: result.nextCursor,
  }
}

function serializeMatchDetail(result: MatchDetailResult) {
  return {
    match: {
      ...result.match,
      playedAt: result.match.playedAt.toISOString(),
      recordedAt: result.match.recordedAt.toISOString(),
    },
    adjustments: result.adjustments.map((adjustment) => ({
      ...adjustment,
      adjustedAt: adjustment.adjustedAt.toISOString(),
    })),
    outcome: result.outcome,
  }
}

export function registerMatchRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/matches/preview',
    {
      preHandler: requireRole('recorder'),
      schema: {
        tags: ['matches'],
        operationId: 'previewMatch',
        summary: 'Preview a match outcome without recording it (requires recorder role)',
        security: [{ sessionCookie: [] }],
        body: previewMatchBodySchema,
        response: { 200: matchOutcomeSchema },
      },
    },
    async (request) => previewMatch(deps, request.body),
  )

  typed.post(
    '/matches',
    {
      preHandler: requireRole('recorder'),
      schema: {
        tags: ['matches'],
        operationId: 'recordMatch',
        summary: 'Record a match result (requires recorder role); idempotent on id',
        security: [{ sessionCookie: [] }],
        body: recordMatchBodySchema,
        response: { 200: recordMatchResponseSchema },
      },
    },
    async (request) => {
      const { userId } = sessionUserOrThrow(request)
      const result = await recordMatch(
        deps,
        omitUndefined({
          ...request.body,
          playedAt:
            request.body.playedAt === undefined ? undefined : new Date(request.body.playedAt),
          recordedBy: userId,
        }),
      )
      return {
        ...result,
        match: serializeMatchDto(result.match),
        rankChanges: [...result.rankChanges],
      }
    },
  )

  typed.get(
    '/matches',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['matches'],
        operationId: 'listMatches',
        summary: 'List matches, cursor-paginated',
        security: [{ sessionCookie: [] }],
        querystring: listMatchesQuerySchema,
        response: { 200: listMatchesResponseSchema },
      },
    },
    async (request) => serializeMatchList(await listMatches(deps, omitUndefined(request.query))),
  )

  typed.get(
    '/matches/:id',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['matches'],
        operationId: 'getMatch',
        summary: 'Get a single match and its adjustment history',
        security: [{ sessionCookie: [] }],
        params: matchParamsSchema,
        response: { 200: matchDetailResponseSchema },
      },
    },
    async (request) => serializeMatchDetail(await matchDetail(deps, request.params.id)),
  )

  typed.get(
    '/matches/:id/void-preview',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['matches'],
        operationId: 'previewVoidMatch',
        summary: 'Preview the ratings/ranks that would result from voiding a match, without voiding it (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: matchParamsSchema,
        response: { 200: voidMatchPreviewResponseSchema },
      },
    },
    async (request) => {
      const result = await previewVoidMatch(deps, request.params.id)
      return { ...result, players: [...result.players], rankChanges: [...result.rankChanges] }
    },
  )

  typed.post(
    '/matches/:id/void',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['matches'],
        operationId: 'voidMatch',
        summary: 'Void a match (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: matchParamsSchema,
        body: voidMatchBodySchema,
        response: { 200: adjustmentResultResponseSchema },
      },
    },
    async (request) => {
      const { userId } = sessionUserOrThrow(request)
      const result = await voidMatch(deps, {
        matchId: request.params.id,
        reason: request.body.reason,
        adjustedBy: userId,
      })
      return { ...result, affectedPlayers: [...result.affectedPlayers] }
    },
  )

  typed.post(
    '/matches/:id/correct',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['matches'],
        operationId: 'correctMatch',
        summary: 'Correct a match (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: matchParamsSchema,
        body: correctMatchBodySchema,
        response: { 200: adjustmentResultResponseSchema },
      },
    },
    async (request) => {
      const { userId } = sessionUserOrThrow(request)
      const result = await correctMatch(deps, {
        matchId: request.params.id,
        reason: request.body.reason,
        homePlayerId: request.body.homePlayerId,
        awayPlayerId: request.body.awayPlayerId,
        homeScore: request.body.homeScore,
        awayScore: request.body.awayScore,
        adjustedBy: userId,
      })
      return { ...result, affectedPlayers: [...result.affectedPlayers] }
    },
  )
}
