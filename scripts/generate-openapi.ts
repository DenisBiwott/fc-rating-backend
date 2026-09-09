import { readFile, writeFile } from 'node:fs/promises'
import type { Database } from '../src/app/types.js'
import type { Config } from '../src/config.js'
import { buildApp } from '../src/http/build-app.js'
import { systemClock } from '../src/infra/clock.js'
import { systemIds } from '../src/infra/ids.js'
import { consoleLogger } from '../src/infra/logger.js'

const OUTPUT_PATH = './openapi.json'

const config: Config = {
  DATABASE_URL: 'unused',
  ADMIN_PASSWORD: 'unused',
  COOKIE_SECRET: 'x'.repeat(32),
  PORT: 3000,
  NODE_ENV: 'test',
}

// Schema registration never touches deps.db — only request handlers do, and this script never
// sends a request, so a real connection would be pure overhead (and would require Postgres and
// DATABASE_URL just to generate a document).
const db = undefined as unknown as Database

const app = buildApp({ db, clock: systemClock, ids: systemIds, logger: consoleLogger }, config)
await app.ready()
const json = JSON.stringify(app.swagger(), null, 2) + '\n'
await app.close()

if (process.argv.includes('--check')) {
  const committed = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
  if (committed !== json) {
    console.error('openapi.json is stale — run `pnpm generate:openapi` and commit the diff.')
    process.exitCode = 1
  } else {
    console.log('openapi.json is up to date.')
  }
} else {
  await writeFile(OUTPUT_PATH, json)
  console.log('Wrote openapi.json')
}
