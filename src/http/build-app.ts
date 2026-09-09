import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { Deps } from '../app/types.js'
import type { Config } from '../config.js'
import { registerAuthDecorator, SESSION_COOKIE_NAME } from './plugins/auth.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerLeaderboardRoutes } from './routes/leaderboard.js'
import { registerMatchRoutes } from './routes/matches.js'
import { registerPlayerRoutes } from './routes/players.js'
import { registerRatingConfigRoutes } from './routes/rating-configs.js'
import { registerSessionRoutes } from './routes/sessions.js'

function loggerOptions(
  nodeEnv: Config['NODE_ENV'],
): Exclude<FastifyServerOptions['logger'], undefined> {
  if (nodeEnv === 'test') return false
  if (nodeEnv === 'development') return { transport: { target: 'pino-pretty' } }
  return true
}

/**
 * Builds a Fastify instance without binding a port, so both the real server (server.ts) and API
 * tests (fastify.inject) share the exact same wiring. Fastify's own request logger is configured
 * from NODE_ENV here and is independent of `deps.logger` (the use-case-facing logger) — see
 * src/infra/logger.ts.
 */
export function buildApp(deps: Deps, config: Config): FastifyInstance {
  const app = Fastify({ logger: loggerOptions(config.NODE_ENV) })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  void app.register(cookie, { secret: config.COOKIE_SECRET })

  // Must register before any routes — @fastify/swagger hooks onRoute to collect schemas, so
  // routes registered beforehand are invisible to it. See scripts/generate-openapi.ts, which
  // reads this via app.swagger() to produce openapi.json (CLAUDE.md's generated-contract rule).
  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FC Rating API',
        version: '0.1.0', // keep in sync with package.json's version
        description: "Elo-based match rating API for a friend group's EA Sports FC league.",
      },
      tags: [
        { name: 'auth' },
        { name: 'players' },
        { name: 'matches' },
        { name: 'leaderboard' },
        { name: 'sessions' },
        { name: 'rating-configs' },
        { name: 'ops' },
      ],
      security: [],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE_NAME },
        },
      },
    },
    transform: jsonSchemaTransform,
  })

  registerAuthDecorator(app)

  registerErrorHandler(app)
  registerHealthRoutes(app, deps)
  registerAuthRoutes(app, deps)
  registerPlayerRoutes(app, deps)
  registerMatchRoutes(app, deps)
  registerLeaderboardRoutes(app, deps)
  registerSessionRoutes(app, deps)
  registerRatingConfigRoutes(app, deps)

  return app
}
