import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/app/types.js'
import {
  activateNewConfig,
  seedActiveConfig,
  seedPlayer,
} from '../integration/helpers/factories.js'
import { createTestDb, type TestDb } from '../integration/helpers/test-db.js'
import { buildTestApp } from './helpers/app.js'
import { loginAsAdmin, seedAdmin } from './helpers/auth.js'

let testDb: TestDb
let db: Database
let cookies: Record<string, string>

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  await seedAdmin(db)
  await seedActiveConfig(db)
  const app = buildTestApp(db)
  cookies = await loginAsAdmin(app)
  await app.close()
})

afterAll(async () => {
  await testDb.teardown()
})

describe('GET /leaderboard', () => {
  it('ranks players by rating after a recorded match', async () => {
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
        homeScore: 3,
        awayScore: 0,
      },
    })

    const response = await app.inject({ method: 'GET', url: '/leaderboard', cookies })
    expect(response.statusCode).toBe(200)
    const body = response.json<{
      entries: { playerId: string; rank: number }[]
      meanRating: number
    }>()
    expect(body.entries[0]).toMatchObject({ playerId: playerA.id, rank: 1 })

    await app.close()
  })

  it('is public — no session required', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/leaderboard' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('names the ACTIVE config, and follows it when another is activated', async () => {
    const app = buildTestApp(db)
    const ratingConfigOf = async () =>
      (
        await app.inject({ method: 'GET', url: '/leaderboard' })
      ).json<{ ratingConfig: { name: string; provisionalGames: number } }>().ratingConfig

    const seeded = await ratingConfigOf()
    expect(seeded.name).toMatch(/^test-elo-/)
    expect(seeded.provisionalGames).toBe(10)

    const switched = await activateNewConfig(db, { provisionalGames: 5 })
    expect(await ratingConfigOf()).toEqual({ name: switched.name, provisionalGames: 5 })

    await app.close()
  })
})
