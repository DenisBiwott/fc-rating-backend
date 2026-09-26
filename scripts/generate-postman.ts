import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { z } from 'zod'
import { loginBodySchema } from '../src/http/schemas/auth.js'
import {
  correctMatchBodySchema,
  previewMatchBodySchema,
  recordMatchBodySchema,
  voidMatchBodySchema,
} from '../src/http/schemas/match.js'
import { createPlayerBodySchema, updatePlayerBodySchema } from '../src/http/schemas/player.js'
import { createRatingConfigBodySchema } from '../src/http/schemas/rating-config.js'
import { openSessionBodySchema, renameSessionBodySchema } from '../src/http/schemas/session.js'

/**
 * Generates the Postman collection (and a local + production environment) from the committed
 * openapi.json — so the collection can never list a route the contract doesn't have, and a route
 * the contract gains can't be silently missing: generation fails until it's covered here. Never
 * hand-edit the output; change this file and regenerate. Usage: docs/POSTMAN.md.
 *
 *   pnpm generate:postman          writes postman/*.json
 *   pnpm generate:postman:check    exits 1 if the committed files are stale
 */

const OUT_DIR = './postman'
const COLLECTION_PATH = `${OUT_DIR}/fc-rating.postman_collection.json`
const LOCAL_ENV_PATH = `${OUT_DIR}/local.postman_environment.json`
const PRODUCTION_ENV_PATH = `${OUT_DIR}/production.postman_environment.json`
const PRODUCTION_URL = 'https://fc-rating-1067185865527.europe-west1.run.app'

// --- the parts of openapi.json this reads ------------------------------------------------------

interface OpenApiParameter {
  name: string
  in: string
  required?: boolean
  schema?: { type?: string; enum?: string[] }
}
interface OpenApiOperation {
  operationId: string
  summary?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: unknown
}
interface OpenApiDocument {
  info: { title: string; description?: string }
  paths: Record<string, Record<string, OpenApiOperation>>
}

// --- hand-maintained knowledge the contract doesn't carry -----------------------------------------

/** Folder per OpenAPI tag, in this order. An unknown tag fails generation. */
const FOLDERS: Record<string, string> = {
  ops: 'Health',
  auth: 'Auth',
  players: 'Players',
  matches: 'Matches',
  leaderboard: 'Leaderboard',
  sessions: 'Sessions',
  'rating-configs': 'Rating configs',
}

/** Which collection variable fills a `{id}` path parameter, by the path's first segment. */
const ID_VARIABLES: Record<string, string> = {
  players: 'playerId',
  matches: 'matchId',
  sessions: 'sessionId',
  'rating-configs': 'configId',
}

const RECOMMENDED_CONFIG = {
  name: 'elo-tuned-v1',
  algorithm: 'elo',
  params: {
    baseline: 1200,
    kProvisional: 32,
    provisionalGames: 10,
    kEstablished: 20,
    drawScore: 0.5,
    expectationScale: 400,
    goalDifferenceFactor: { enabled: true, divisor: 3, cap: 1.5 },
    eliteK: { enabled: true, enterAt: 1350, exitAt: 1320, k: 14, requireEstablished: true },
    repeatOpponentDamping: { enabled: false, threshold: 3, factor: 0.85, minMultiplier: 0.3 },
    maxDelta: 35,
    ratingFloor: 900,
  },
}

/**
 * An example body for every operation that takes one, validated against the route's own Zod
 * schema at generation time — a schema change that breaks an example fails here, not in Postman.
 */
const BODIES: Record<string, { schema: z.ZodType; example: unknown }> = {
  login: { schema: loginBodySchema, example: { password: '{{adminPassword}}' } },
  createPlayer: { schema: createPlayerBodySchema, example: { name: 'New Player' } },
  updatePlayer: { schema: updatePlayerBodySchema, example: { name: 'Renamed Player' } },
  previewMatch: {
    schema: previewMatchBodySchema,
    example: {
      homePlayerId: '{{homePlayerId}}',
      awayPlayerId: '{{awayPlayerId}}',
      homeScore: 2,
      awayScore: 1,
    },
  },
  recordMatch: {
    schema: recordMatchBodySchema,
    example: {
      id: '{{$guid}}',
      homePlayerId: '{{homePlayerId}}',
      awayPlayerId: '{{awayPlayerId}}',
      homeScore: 2,
      awayScore: 1,
    },
  },
  voidMatch: { schema: voidMatchBodySchema, example: { reason: 'Recorded by mistake' } },
  correctMatch: {
    schema: correctMatchBodySchema,
    example: {
      reason: 'Wrong score entered',
      homePlayerId: '{{homePlayerId}}',
      awayPlayerId: '{{awayPlayerId}}',
      homeScore: 1,
      awayScore: 1,
    },
  },
  openSession: { schema: openSessionBodySchema, example: { name: 'Friday night' } },
  renameSession: { schema: renameSessionBodySchema, example: { name: 'FC 26' } },
  createRatingConfig: { schema: createRatingConfigBodySchema, example: RECOMMENDED_CONFIG },
}

/** Response fields captured into collection variables, so the next request can use them. */
const CAPTURES: Record<string, { variable: string; path: string }> = {
  createPlayer: { variable: 'playerId', path: 'id' },
  recordMatch: { variable: 'matchId', path: 'match.id' },
  openSession: { variable: 'sessionId', path: 'id' },
  createRatingConfig: { variable: 'configId', path: 'id' },
}

const NOTES: Record<string, string> = {
  login:
    'Postman keeps the session cookie in its cookie jar, so every request after this one is ' +
    'logged in. Rate-limited to 5 attempts per 15 minutes per IP (a 429 means wait).',
  logout:
    'Last in its folder on purpose: running the whole folder logs out at the end, not midway.',
  recordMatch:
    '`id` is the idempotency key. `{{$guid}}` makes a fresh one on every send, so every send ' +
    'records a NEW match. To retry one submission safely, replace it with a fixed UUID. ' +
    'Add `"sessionId"` to attach the match to a session (the web app does this automatically).',
  previewMatch:
    'Pass the same optional `sessionId` the match will be recorded with, or the preview ignores ' +
    'repeat-opponent damping.',
  createRatingConfig:
    'Creates the config INACTIVE. The example body is the recommended `elo-tuned-v1`; replace ' +
    'it with any entry of `scripts/rating-config-candidates.json`. Check the response echoes ' +
    'every feature. Adopting it: docs/RATING_CONFIGS.md.',
  rebuildRatingConfig: 'Uses `{{configId}}`, captured by "Create a rating config".',
  getLeaderboard:
    'Without `session`: the open session\'s table (else the most recently closed one; all-time if ' +
    'no session exists). Set `session` to `all-time`, or to a session id such as `{{sessionId}}`.',
  renameSession:
    'Uses `{{sessionId}}`, captured by "Open a new session". Works on closed sessions too.',
}

// --- Postman collection v2.1 building blocks -------------------------------------------------------

const script = (lines: string[]) => ({ type: 'text/javascript', exec: lines })

function testEvents(operationId: string) {
  const lines: string[] = []
  if (operationId === 'login')
    lines.push("pm.test('logged in', () => pm.response.to.have.status(200))")
  const capture = CAPTURES[operationId]
  if (capture !== undefined) {
    lines.push(
      'if (pm.response.code >= 200 && pm.response.code < 300) {',
      `  const value = pm.response.json().${capture.path}`,
      `  pm.collectionVariables.set('${capture.variable}', value)`,
      `  console.log('${capture.variable} =', value)`,
      '}',
    )
  }
  return lines.length === 0 ? [] : [{ listen: 'test', script: script(lines) }]
}

function queryParameter(parameter: OpenApiParameter) {
  const value =
    parameter.schema?.enum?.[0] ??
    (parameter.name === 'limit'
      ? '20'
      : parameter.name.endsWith('Id')
        ? `{{${parameter.name}}}`
        : '')
  const allowed =
    parameter.schema?.enum === undefined ? '' : ` One of: ${parameter.schema.enum.join(', ')}.`
  return {
    key: parameter.name,
    value,
    disabled: parameter.required !== true,
    description: `${parameter.required === true ? 'Required' : 'Optional'}.${allowed}`,
  }
}

function roleFrom(summary: string): string | undefined {
  return /\(requires (\w+) role\)/.exec(summary)?.[1]
}

function requestItem(method: string, path: string, operation: OpenApiOperation) {
  const summary = operation.summary ?? operation.operationId
  const name = summary.replace(/\s*\(requires \w+ role\)/, '')
  const segments = path.split('/').filter((segment) => segment !== '')
  const resource = segments[0] ?? ''

  const pathVariables = (operation.parameters ?? [])
    .filter((parameter) => parameter.in === 'path')
    .map((parameter) => {
      const variable = ID_VARIABLES[resource]
      if (variable === undefined) {
        throw new Error(
          `${operation.operationId}: no collection variable for /${resource}/{${parameter.name}} — add one to ID_VARIABLES`,
        )
      }
      return { key: parameter.name, value: `{{${variable}}}` }
    })
  const query = (operation.parameters ?? [])
    .filter((parameter) => parameter.in === 'query')
    .map(queryParameter)
  const postmanPath = segments.map((segment) => segment.replace(/^\{(.+)\}$/, ':$1'))

  let body: object | undefined
  if (operation.requestBody !== undefined) {
    const entry = BODIES[operation.operationId]
    if (entry === undefined) {
      throw new Error(
        `${operation.operationId} takes a request body but has no example — add one to BODIES`,
      )
    }
    // {{$guid}} is a Postman dynamic variable; validate with a stand-in UUID in its place.
    const resolved: unknown = JSON.parse(
      JSON.stringify(entry.example).replaceAll('{{$guid}}', '00000000-0000-4000-8000-000000000000'),
    )
    const check = entry.schema.safeParse(resolved)
    if (!check.success) {
      throw new Error(
        `${operation.operationId}: example body fails its schema — ${check.error.message}`,
      )
    }
    body = {
      mode: 'raw',
      raw: JSON.stringify(entry.example, null, 2),
      options: { raw: { language: 'json' } },
    }
  }

  const role = roleFrom(summary)
  const description = [
    summary,
    `\`${method.toUpperCase()} ${path}\` · operationId \`${operation.operationId}\``,
    role === undefined
      ? 'No login needed.'
      : `Requires the **${role}** role — run Auth → Log in first.`,
    NOTES[operation.operationId],
  ]
    .filter((line) => line !== undefined)
    .join('\n\n')

  return {
    name,
    event: testEvents(operation.operationId),
    request: {
      method: method.toUpperCase(),
      header: body === undefined ? [] : [{ key: 'Content-Type', value: 'application/json' }],
      ...(body === undefined ? {} : { body }),
      url: {
        raw: `{{baseUrl}}/${postmanPath.join('/')}${query.length > 0 ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`,
        host: ['{{baseUrl}}'],
        path: postmanPath,
        ...(query.length > 0 ? { query } : {}),
        ...(pathVariables.length > 0 ? { variable: pathVariables } : {}),
      },
      description,
    },
  }
}

const COLLECTION_DESCRIPTION = `Every route in \`openapi.json\`, generated by \`scripts/generate-postman.ts\` — never hand-edit this file; regenerate it (\`pnpm generate:postman\`).

**Setup:** import this collection and both environments from \`fc-rating-backend/postman/\`, pick an environment (top right), and set \`adminPassword\` — for Production, as the **Current value** only, so it's never synced to Postman's servers.

**Use:** run **Auth → Log in with the shared admin password** first; Postman keeps the session cookie, so every request after it is logged in. IDs are captured as you go (\`playerId\`, \`matchId\`, \`sessionId\`, \`configId\`) and fill the \`:id\` of the requests that need them. For matches, set \`homePlayerId\`/\`awayPlayerId\` in the collection variables (copy IDs from **Players → List players**).

Full guide: \`docs/POSTMAN.md\`. Adopting a rating config: \`docs/RATING_CONFIGS.md\`.`

function buildCollection(document: OpenApiDocument) {
  const folders = new Map<string, ReturnType<typeof requestItem>[]>()
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const tag = operation.tags?.[0] ?? ''
      if (FOLDERS[tag] === undefined) {
        throw new Error(`${operation.operationId}: tag '${tag}' has no folder — add it to FOLDERS`)
      }
      folders.set(tag, [...(folders.get(tag) ?? []), requestItem(method, path, operation)])
    }
  }
  const operationIds = new Set(
    Object.values(document.paths).flatMap((operations) =>
      Object.values(operations).map((operation) => operation.operationId),
    ),
  )
  for (const operationId of [
    ...Object.keys(BODIES),
    ...Object.keys(CAPTURES),
    ...Object.keys(NOTES),
  ]) {
    if (!operationIds.has(operationId)) {
      throw new Error(
        `'${operationId}' is configured here but no longer in openapi.json — remove it`,
      )
    }
  }

  const variable = (key: string, description: string, value = '') => ({ key, value, description })
  // Destructive requests last in their folder, so "Run folder" doesn't delete or log out midway.
  const isLast = (item: ReturnType<typeof requestItem>) =>
    item.request.method === 'DELETE' || item.request.url.path.join('/') === 'auth/logout'
  for (const [tag, items] of folders) {
    folders.set(tag, [...items.filter((item) => !isLast(item)), ...items.filter(isLast)])
  }

  return {
    info: {
      name: document.info.title,
      description: COLLECTION_DESCRIPTION,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      variable('baseUrl', 'Overridden by the selected environment.', 'http://localhost:3000'),
      variable('homePlayerId', 'Set by hand, for the match requests.'),
      variable('awayPlayerId', 'Set by hand, for the match requests.'),
      variable('playerId', 'Captured by Players → Create a player.'),
      variable('matchId', 'Captured by Matches → Record a match result; idempotent on id.'),
      variable('sessionId', 'Captured by Sessions → Open a new session.'),
      variable('configId', 'Captured by Rating configs → Create a rating config.'),
    ],
    item: Object.entries(FOLDERS)
      .filter(([tag]) => folders.has(tag))
      .map(([tag, name]) => ({ name, item: folders.get(tag) ?? [] })),
  }
}

function environment(name: string, baseUrl: string, adminPassword: string) {
  return {
    name,
    values: [
      { key: 'baseUrl', value: baseUrl, type: 'default', enabled: true },
      { key: 'adminPassword', value: adminPassword, type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  }
}

const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

const document = JSON.parse(await readFile('./openapi.json', 'utf8')) as OpenApiDocument
const outputs: [string, string][] = [
  [COLLECTION_PATH, serialize(buildCollection(document))],
  // The local password is .env.example's placeholder; production's is left blank on purpose.
  [
    LOCAL_ENV_PATH,
    serialize(environment('FC Rating — Local', 'http://localhost:3000', 'changeme')),
  ],
  [PRODUCTION_ENV_PATH, serialize(environment('FC Rating — Production', PRODUCTION_URL, ''))],
]

if (process.argv.includes('--check')) {
  const stale: string[] = []
  for (const [path, content] of outputs) {
    if ((await readFile(path, 'utf8').catch(() => null)) !== content) stale.push(path)
  }
  if (stale.length > 0) {
    console.error(`Stale: ${stale.join(', ')} — run \`pnpm generate:postman\` and commit the diff.`)
    process.exitCode = 1
  } else {
    console.log('Postman collection and environments are up to date.')
  }
} else {
  await mkdir(OUT_DIR, { recursive: true })
  for (const [path, content] of outputs) await writeFile(path, content)
  console.log(`Wrote ${outputs.map(([path]) => path).join(', ')}`)
}
