import cookie from '@fastify/cookie'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { Deps } from '../app/types.js'
import type { Config } from '../config.js'
import { registerAuthDecorator } from './plugins/auth.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerHealthRoutes } from './routes/health.js'

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
  registerAuthDecorator(app)

  registerErrorHandler(app)
  registerHealthRoutes(app, deps)
  registerAuthRoutes(app, deps)

  return app
}
