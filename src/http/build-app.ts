import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
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

  // Session auth is a cookie, so the frontend (a different origin in dev: 5173 vs this API's
  // 3000) needs both an explicit allowed origin and credentials:true — the wildcard default
  // origin doesn't send Access-Control-Allow-Credentials, which makes the browser drop the cookie
  // even on an otherwise-successful cross-origin request.
  void app.register(cors, { origin: config.CORS_ORIGIN, credentials: true })

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

  // @fastify/swagger's onRoute hook only exists once its plugin body has actually run, which
  // (like any app.register(...) call) avvio defers to the boot queue rather than running inline —
  // so a route added synchronously right here, in the same tick as the registrations above, would
  // be added before that hook exists and onRoute hooks never fire retroactively. app.after(...)
  // defers this callback until every plugin registered above has finished loading, guaranteeing
  // the hook is in place first. Confirmed needed by generating openapi.json without it: every
  // route served fine (app.printRoutes() showed them all) but app.swagger() reported 0 paths.
  app.after(() => {
    registerHealthRoutes(app, deps)
    registerAuthRoutes(app, deps)
    registerPlayerRoutes(app, deps)
    registerMatchRoutes(app, deps)
    registerLeaderboardRoutes(app, deps)
    registerSessionRoutes(app, deps)
    registerRatingConfigRoutes(app, deps)
  })

  return app
}
