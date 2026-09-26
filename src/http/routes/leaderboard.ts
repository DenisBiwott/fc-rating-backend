import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { leaderboard, type LeaderboardScope } from '../../app/leaderboard.js'
import type { Deps } from '../../app/types.js'
import { leaderboardQuerySchema, leaderboardResponseSchema } from '../schemas/leaderboard.js'

export function registerLeaderboardRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/leaderboard',
    {
      schema: {
        tags: ['leaderboard'],
        operationId: 'getLeaderboard',
        summary: 'Get the leaderboard (latest session by default)',
        querystring: leaderboardQuerySchema,
        response: { 200: leaderboardResponseSchema },
      },
    },
    async (request) => {
      const { session } = request.query
      const scope: LeaderboardScope =
        session === undefined
          ? 'latest-session'
          : session === 'all-time'
            ? 'all-time'
            : { sessionId: session }
      const result = await leaderboard(deps, scope)
      return {
        entries: result.entries.map((entry) => ({ ...entry, form: [...entry.form] })),
        meanRating: result.meanRating,
        ratingConfig: result.ratingConfig,
        session: result.session,
      }
    },
  )
}
