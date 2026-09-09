import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { leaderboard } from '../../app/leaderboard.js'
import type { Deps } from '../../app/types.js'
import { leaderboardResponseSchema } from '../schemas/leaderboard.js'

export function registerLeaderboardRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/leaderboard',
    {
      schema: {
        tags: ['leaderboard'],
        operationId: 'getLeaderboard',
        summary: 'Get the current leaderboard',
        response: { 200: leaderboardResponseSchema },
      },
    },
    async () => {
      const result = await leaderboard(deps)
      return {
        entries: result.entries.map((entry) => ({ ...entry, form: [...entry.form] })),
        meanRating: result.meanRating,
      }
    },
  )
}
