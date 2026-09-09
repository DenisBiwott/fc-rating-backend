import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRatingConfig } from '../../app/create-rating-config.js'
import { listRatingConfigs } from '../../app/list-rating-configs.js'
import { rebuildConfig } from '../../app/rebuild-config.js'
import type { Deps } from '../../app/types.js'
import { whatIfLeaderboard } from '../../app/what-if-leaderboard.js'
import { eloParamsSchema, type RatingConfigRow } from '../../infra/db/queries/rating-configs.js'
import { requireRole } from '../plugins/auth.js'
import {
  createRatingConfigBodySchema,
  rebuildResponseSchema,
  ratingConfigListResponseSchema,
  ratingConfigParamsSchema,
  ratingConfigSchema,
  whatIfLeaderboardResponseSchema,
} from '../schemas/rating-config.js'

/** `params` is jsonb (untyped `unknown` at the Drizzle level) — re-validate with the same schema the query layer parses it with (rating-configs.ts's `toResolvedRatingConfig`) rather than trusting the DB's shape blindly. */
function toRatingConfigDto(row: RatingConfigRow) {
  return {
    id: row.id,
    name: row.name,
    algorithm: row.algorithm,
    params: eloParamsSchema.parse(row.params),
    isActive: row.isActive,
  }
}

export function registerRatingConfigRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/rating-configs',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['rating-configs'],
        operationId: 'listRatingConfigs',
        summary: 'List rating configs (requires admin role)',
        security: [{ sessionCookie: [] }],
        response: { 200: ratingConfigListResponseSchema },
      },
    },
    async () => (await listRatingConfigs(deps)).map(toRatingConfigDto),
  )

  typed.post(
    '/rating-configs',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['rating-configs'],
        operationId: 'createRatingConfig',
        summary: 'Create a rating config (requires admin role)',
        security: [{ sessionCookie: [] }],
        body: createRatingConfigBodySchema,
        response: { 201: ratingConfigSchema },
      },
    },
    async (request, reply) => {
      const config = await createRatingConfig(deps, request.body)
      return reply.code(201).send(toRatingConfigDto(config))
    },
  )

  typed.post(
    '/rating-configs/:id/rebuild',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['rating-configs'],
        operationId: 'rebuildRatingConfig',
        summary: 'Rebuild rating snapshots for a config by replaying matches (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: ratingConfigParamsSchema,
        response: { 200: rebuildResponseSchema },
      },
    },
    async (request) => rebuildConfig(deps, request.params.id),
  )

  typed.get(
    '/rating-configs/:id/leaderboard',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['rating-configs'],
        operationId: 'getRatingConfigLeaderboard',
        summary: 'Preview the leaderboard a rating config would produce (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: ratingConfigParamsSchema,
        response: { 200: whatIfLeaderboardResponseSchema },
      },
    },
    async (request) => {
      const result = await whatIfLeaderboard(deps, request.params.id)
      return { configId: result.configId, entries: result.entries.map((entry) => ({ ...entry })) }
    },
  )
}
