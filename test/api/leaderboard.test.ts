import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

describe('GET /leaderboard?session=', () => {
  afterEach(async () => {
    await db.execute(sql`truncate table matches, sessions restart identity cascade`)
  })

  async function openSession(app: ReturnType<typeof buildTestApp>, name: string) {
    const opened = await app.inject({ method: 'POST', url: '/sessions', cookies, payload: { name } })
    return opened.json<{ id: string }>().id
  }

  it('defaults to the open session and names it; session=all-time is the all-time table', async () => {
    const app = buildTestApp(db)
    const sessionId = await openSession(app, 'FC 27')

    const byDefault = await app.inject({ method: 'GET', url: '/leaderboard' })
    expect(byDefault.statusCode).toBe(200)
    expect(byDefault.json()).toMatchObject({ session: { id: sessionId, name: 'FC 27' } })

    const allTime = await app.inject({ method: 'GET', url: '/leaderboard?session=all-time' })
    expect(allTime.statusCode).toBe(200)
    expect(allTime.json()).toMatchObject({ session: null })

    await app.close()
  })

  it("session=<id> is that session's table, from baseline", async () => {
    const app = buildTestApp(db)
    const playerA = await seedPlayer(db, `Alice-${randomUUID()}`)
    const playerB = await seedPlayer(db, `Bob-${randomUUID()}`)
    const sessionId = await openSession(app, 'FC 27')
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: {
        id: randomUUID(),
        homePlayerId: playerA.id,
        awayPlayerId: playerB.id,
        homeScore: 2,
        awayScore: 0,
        sessionId,
      },
    })

    const response = await app.inject({ method: 'GET', url: `/leaderboard?session=${sessionId}` })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ entries: { playerId: string; rating: number }[] }>()
    expect(body.entries.find((e) => e.playerId === playerA.id)).toMatchObject({ rating: 1220 })

    await app.close()
  })

  it('returns 404 for an unknown session id and 400 for anything that is neither all-time nor an id', async () => {
    const app = buildTestApp(db)

    const unknown = await app.inject({
      method: 'GET',
      url: '/leaderboard?session=00000000-0000-7000-8000-000000000000',
    })
    expect(unknown.statusCode).toBe(404)

    for (const value of ['alltime', 'current', '']) {
      const invalid = await app.inject({ method: 'GET', url: `/leaderboard?session=${value}` })
      expect(invalid.statusCode, `session=${value}`).toBe(400)
    }

    await app.close()
  })
})
