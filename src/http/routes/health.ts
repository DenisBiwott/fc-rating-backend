import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Deps } from '../../app/types.js'

const healthResponseSchema = z.object({ status: z.literal('ok'), db: z.literal('ok') })

/** Checks the database connection, not just process liveness — see docs/API.md#ops. */
export function registerHealthRoutes(app: FastifyInstance, deps: Deps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['ops'],
        operationId: 'getHealth',
        summary: 'Check API and database health',
        response: { 200: healthResponseSchema },
      },
    },
    async () => {
      await deps.db.execute(sql`select 1`)
      return { status: 'ok', db: 'ok' } as const
    },
  )
}
