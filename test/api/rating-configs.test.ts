import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/app/types.js'
import { ratingConfigs } from '../../src/infra/db/schema.js'
import { seedActiveConfig, seedPlayer } from '../integration/helpers/factories.js'
import { createTestDb, type TestDb } from '../integration/helpers/test-db.js'
import { buildTestApp } from './helpers/app.js'
import { loginAsAdmin, seedAdmin } from './helpers/auth.js'

let testDb: TestDb
let db: Database
let cookies: Record<string, string>

const eloParams = {
  baseline: 1200,
  kProvisional: 40,
  provisionalGames: 10,
  kEstablished: 24,
  drawScore: 0.5,
}

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  await seedAdmin(db)
  await seedActiveConfig(db)
  const app = buildTestApp(db)
  cookies = await loginAsAdmin(app)
  await app.close()
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('POST /rating-configs', () => {
  it('creates an inactive config', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: { name: `what-if-${randomUUID()}`, algorithm: 'elo', params: eloParams },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ algorithm: 'elo', isActive: false, params: eloParams })

    await app.close()
  })

  it('rejects a duplicate name with 409', async () => {
    const app = buildTestApp(db)
    const name = `dup-${randomUUID()}`
    await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: { name, algorithm: 'elo', params: eloParams },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: { name, algorithm: 'elo', params: eloParams },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })
})

describe('POST /rating-configs — optional Elo features', () => {
  it('stores the features fully explicit, with every omitted default filled in', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: {
        name: `features-${randomUUID()}`,
        algorithm: 'elo',
        params: {
          ...eloParams,
          goalDifferenceFactor: { enabled: true },
          eliteK: { enabled: true, k: 16 },
          repeatOpponentDamping: { enabled: true, factor: 0.9 },
          maxDelta: 30,
          ratingFloor: 800,
        },
      },
    })

    const expected = {
      ...eloParams,
      expectationScale: 400,
      goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 },
      eliteK: { enabled: true, enterAt: 1500, exitAt: 1450, k: 16, requireEstablished: true },
      repeatOpponentDamping: { enabled: true, threshold: 3, factor: 0.9, minMultiplier: 0.25 },
      maxDelta: 30,
      ratingFloor: 800,
    }
    expect(response.statusCode).toBe(201)
    const created = response.json<{ id: string; params: unknown }>()
    expect(created.params).toEqual(expected)

    // Persisted, not just echoed: the stored jsonb no longer depends on code-level defaults.
    const [row] = await db
      .select({ params: ratingConfigs.params })
      .from(ratingConfigs)
      .where(eq(ratingConfigs.id, created.id))
    expect(row?.params).toEqual(expected)

    await app.close()
  })

  it.each([
    [
      'an inverted hysteresis band',
      { eliteK: { enabled: true, k: 16, enterAt: 1400, exitAt: 1450 } },
    ],
    ['eliteK without k', { eliteK: { enabled: true } }],
    ['a floor above the baseline', { ratingFloor: 1300 }],
    ['a damping factor above 1', { repeatOpponentDamping: { enabled: true, factor: 1.2 } }],
    ['a goal-difference cap below 1', { goalDifferenceFactor: { enabled: true, cap: 0.5 } }],
    ['a non-positive maxDelta', { maxDelta: 0 }],
    ['a non-positive expectationScale', { expectationScale: 0 }],
    ['an explicit null for an optional feature', { maxDelta: null }],
  ])('rejects %s with 400', async (_label, overrides) => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: {
        name: `bad-${randomUUID()}`,
        algorithm: 'elo',
        params: { ...eloParams, ...overrides },
      },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })
})

describe('GET /rating-configs', () => {
  it('reads a config stored before the features existed as exactly what it always meant', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/rating-configs', cookies })

    const active = response
      .json<{ isActive: boolean; params: unknown }[]>()
      .find((config) => config.isActive)
    expect(active?.params).toEqual({ ...eloParams, expectationScale: 400 })

    await app.close()
  })

  it('lists configs including the seeded active one', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/rating-configs', cookies })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ isActive: boolean }[]>().some((c) => c.isActive)).toBe(true)

    await app.close()
  })

  it('stays admin-gated — config/tuning data, not public player data', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/rating-configs' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})

describe('GET /rating-configs/:id/leaderboard', () => {
  it('replays matches through an alternate config without persisting anything', async () => {
    const app = buildTestApp(db)
    const playerA = await seedPlayer(db, `Alice-${randomUUID()}`)
    const playerB = await seedPlayer(db, `Bob-${randomUUID()}`)

    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: {
        id: randomUUID(),
        homePlayerId: playerA.id,
        awayPlayerId: playerB.id,
        homeScore: 4,
        awayScore: 0,
      },
    })

    const created = await app.inject({
      method: 'POST',
      url: '/rating-configs',
      cookies,
      payload: {
        name: `what-if-${randomUUID()}`,
        algorithm: 'elo',
        params: { ...eloParams, kEstablished: 40 },
      },
    })
    const configId = created.json<{ id: string }>().id

    const whatIf = await app.inject({
      method: 'GET',
      url: `/rating-configs/${configId}/leaderboard`,
      cookies,
    })
    expect(whatIf.statusCode).toBe(200)
    const whatIfBody = whatIf.json<{
      configId: string
      entries: { playerId: string; rank: number }[]
    }>()
    expect(whatIfBody.configId).toBe(configId)
    expect(whatIfBody.entries).toHaveLength(2)
    expect(whatIfBody.entries[0]).toMatchObject({ playerId: playerA.id, rank: 1 })

    // The active config's own leaderboard is unaffected — nothing was persisted.
    const realLeaderboard = await app.inject({ method: 'GET', url: '/leaderboard', cookies })
    expect(realLeaderboard.json<{ entries: unknown[] }>().entries).toHaveLength(2)

    await app.close()
  })

  it('returns 404 for an unknown config', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/rating-configs/00000000-0000-7000-8000-000000000000/leaderboard',
      cookies,
    })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /rating-configs/:id/rebuild', () => {
  it('rebuilds the active config and reports the match count', async () => {
    const app = buildTestApp(db)
    const playerA = await seedPlayer(db, `Alice-${randomUUID()}`)
    const playerB = await seedPlayer(db, `Bob-${randomUUID()}`)
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: {
        id: randomUUID(),
        homePlayerId: playerA.id,
        awayPlayerId: playerB.id,
        homeScore: 1,
        awayScore: 1,
      },
    })

    const activeConfig = (await db.execute<{ id: string }>(sql`select id from rating_configs where is_active`))[0]
    if (activeConfig === undefined) throw new Error('no active config seeded')

    const response = await app.inject({
      method: 'POST',
      url: `/rating-configs/${activeConfig.id}/rebuild`,
      cookies,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ configId: activeConfig.id, matchCount: 1 })

    await app.close()
  })
})
