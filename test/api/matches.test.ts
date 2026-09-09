import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/app/types.js'
import { seedActiveConfig, seedPlayer } from '../integration/helpers/factories.js'
import { createTestDb, type TestDb } from '../integration/helpers/test-db.js'
import { buildTestApp } from './helpers/app.js'
import { loginAsAdmin, seedAdmin } from './helpers/auth.js'

let testDb: TestDb
let db: Database
let cookies: Record<string, string>
let playerAId: string
let playerBId: string

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  await seedAdmin(db)
  await seedActiveConfig(db)
  const app = buildTestApp(db)
  cookies = await loginAsAdmin(app)
  await app.close()
})

beforeEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments restart identity cascade`,
  )
  playerAId = (await seedPlayer(db, `Alice-${randomUUID()}`)).id
  playerBId = (await seedPlayer(db, `Bob-${randomUUID()}`)).id
})

afterAll(async () => {
  await testDb.teardown()
})

describe('POST /matches/preview', () => {
  it('returns an outcome without writing anything', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/matches/preview',
      cookies,
      payload: { homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 3, awayScore: 1 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ upset: false })

    const list = await app.inject({ method: 'GET', url: '/matches', cookies })
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(0)

    await app.close()
  })
})

describe('POST /matches', () => {
  it('records a match and is idempotent on retry', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    const payload = {
      id: matchId,
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 2,
      awayScore: 0,
    }

    const first = await app.inject({ method: 'POST', url: '/matches', cookies, payload })
    expect(first.statusCode).toBe(200)
    const firstBody = first.json<{ match: { id: string }; rankChanges: unknown[] }>()
    expect(firstBody.match.id).toBe(matchId)

    const retry = await app.inject({ method: 'POST', url: '/matches', cookies, payload })
    expect(retry.statusCode).toBe(200)
    const retryBody = retry.json<{ match: { id: string }; rankChanges: unknown[] }>()
    expect(retryBody.match.id).toBe(matchId)
    expect(retryBody.rankChanges).toHaveLength(0)

    await app.close()
  })

  it('rejects a match against yourself with 422', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerAId,
        homeScore: 1,
        awayScore: 0,
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ type: 'validation-error' })

    await app.close()
  })
})

describe('GET /matches and GET /matches/:id', () => {
  it('lists newest first and returns match detail', async () => {
    const app = buildTestApp(db)
    const firstId = randomUUID()
    const secondId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: firstId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 1, awayScore: 0 },
    })
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: secondId, homePlayerId: playerBId, awayPlayerId: playerAId, homeScore: 2, awayScore: 2 },
    })

    const list = await app.inject({ method: 'GET', url: '/matches', cookies })
    const items = list.json<{ items: { id: string }[] }>().items
    expect(items.map((m) => m.id)).toEqual([secondId, firstId])

    const detail = await app.inject({ method: 'GET', url: `/matches/${firstId}`, cookies })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      match: { id: firstId, isVoid: false },
      adjustments: [],
    })

    await app.close()
  })

  it('are public — no session required', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: matchId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 1, awayScore: 0 },
    })

    const list = await app.inject({ method: 'GET', url: '/matches' })
    expect(list.statusCode).toBe(200)

    const detail = await app.inject({ method: 'GET', url: `/matches/${matchId}` })
    expect(detail.statusCode).toBe(200)

    await app.close()
  })
})

describe('GET /matches/:id/void-preview', () => {
  it('previews without persisting, and stays admin-gated (not public like the other GET routes)', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: matchId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 1, awayScore: 0 },
    })

    const unauthed = await app.inject({ method: 'GET', url: `/matches/${matchId}/void-preview` })
    expect(unauthed.statusCode).toBe(401)

    const preview = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/void-preview`,
      cookies,
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json<{ players: { playerId: string }[] }>().players.map((p) => p.playerId).sort()).toEqual(
      [playerAId, playerBId].sort(),
    )

    const detail = await app.inject({ method: 'GET', url: `/matches/${matchId}` })
    expect(detail.json()).toMatchObject({ match: { isVoid: false } })

    await app.close()
  })
})

describe('POST /matches/:id/void', () => {
  it('excludes the match from the leaderboard replay and zeroes its outcome', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: matchId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 5, awayScore: 0 },
    })

    const voided = await app.inject({
      method: 'POST',
      url: `/matches/${matchId}/void`,
      cookies,
      payload: { reason: 'Wrong players' },
    })
    expect(voided.statusCode).toBe(200)
    expect(voided.json()).toMatchObject({ match: { isVoid: true } })

    const detail = await app.inject({ method: 'GET', url: `/matches/${matchId}`, cookies })
    expect(detail.json()).toMatchObject({ match: { isVoid: true }, outcome: null })
    expect(detail.json<{ adjustments: unknown[] }>().adjustments).toHaveLength(1)

    await app.close()
  })

  it('requires a reason', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: matchId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 1, awayScore: 0 },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/matches/${matchId}/void`,
      cookies,
      payload: {},
    })
    expect(response.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /matches/:id/correct', () => {
  it('overlays a replacement result', async () => {
    const app = buildTestApp(db)
    const matchId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: matchId, homePlayerId: playerAId, awayPlayerId: playerBId, homeScore: 1, awayScore: 0 },
    })

    const corrected = await app.inject({
      method: 'POST',
      url: `/matches/${matchId}/correct`,
      cookies,
      payload: {
        reason: 'Scoreboard was wrong',
        homePlayerId: playerAId,
        awayPlayerId: playerBId,
        homeScore: 3,
        awayScore: 3,
      },
    })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({ match: { homeScore: 3, awayScore: 3, isVoid: false } })

    await app.close()
  })
})
