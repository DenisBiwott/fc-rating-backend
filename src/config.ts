import { z } from 'zod'

/**
 * Every env var the HTTP layer needs, parsed once at startup — a missing or malformed var fails
 * fast here rather than at first use deep in a request handler. Scripts (migrate/seed/reset) read
 * process.env directly and don't go through this, per docs/CONFIGURATION.md.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters.'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env)
}
