import type { Database } from '../../../src/app/types.js'
import type { Config } from '../../../src/config.js'
import { buildApp } from '../../../src/http/build-app.js'
import { testDeps } from '../../integration/helpers/deps.js'

export const testConfig: Config = {
  DATABASE_URL: 'unused-in-api-tests',
  ADMIN_PASSWORD: 'unused-in-api-tests',
  COOKIE_SECRET: 'test-cookie-secret-at-least-32-characters-long',
  PORT: 0,
  NODE_ENV: 'test',
}

export function buildTestApp(db: Database) {
  return buildApp(testDeps(db), testConfig)
}
