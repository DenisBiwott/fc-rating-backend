import 'dotenv/config'
import pino from 'pino'
import { loadConfig } from './config.js'
import { buildApp } from './http/build-app.js'
import { systemClock } from './infra/clock.js'
import { createDbClient } from './infra/db/client.js'
import { systemIds } from './infra/ids.js'
import { fromPino } from './infra/logger.js'

const config = loadConfig()
const db = createDbClient(config.DATABASE_URL)

const pinoLogger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
})

const app = buildApp(
  { db, clock: systemClock, ids: systemIds, logger: fromPino(pinoLogger) },
  config,
)

app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error(error)
  process.exit(1)
})

async function shutdown(signal: NodeJS.Signals) {
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    process.exit(0)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
