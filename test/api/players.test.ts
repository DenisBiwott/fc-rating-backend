import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/app/types.js'
import { seedActiveConfig } from '../integration/helpers/factories.js'
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

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, players restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('POST /players', () => {
  it('creates a player as admin', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/players',
      cookies,
      payload: { name: 'Alice' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'Alice', isActive: true, avatarUrl: null })

    await app.close()
  })

  it('rejects a duplicate name with 409', async () => {
    const app = buildTestApp(db)
    await app.inject({ method: 'POST', url: '/players', cookies, payload: { name: 'Bob' } })
    const response = await app.inject({
      method: 'POST',
      url: '/players',
      cookies,
      payload: { name: 'Bob' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ type: 'conflict' })

    await app.close()
  })

  it('requires auth', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/players',
      payload: { name: 'Carol' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('rejects an invalid body with 400', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'POST', url: '/players', cookies, payload: {} })

    expect(response.statusCode).toBe(400)

    await app.close()
  })
})

describe('GET /players', () => {
  it('lists players, filterable by active', async () => {
    const app = buildTestApp(db)
    await app.inject({ method: 'POST', url: '/players', cookies, payload: { name: 'Dana' } })
    const created = await app.inject({
      method: 'POST',
      url: '/players',
      cookies,
      payload: { name: 'Eve' },
    })
    const eveId = created.json<{ id: string }>().id
    await app.inject({
      method: 'PATCH',
      url: `/players/${eveId}`,
      cookies,
      payload: { isActive: false },
    })

    const all = await app.inject({ method: 'GET', url: '/players', cookies })
    expect(all.json()).toHaveLength(2)

    const activeOnly = await app.inject({ method: 'GET', url: '/players?active=true', cookies })
    expect(activeOnly.json()).toMatchObject([{ name: 'Dana' }])

    await app.close()
  })

  it('reports lastPlayedAt: null for an unplayed player, and a timestamp after a recorded match', async () => {
    const app = buildTestApp(db)
    const dana = await app.inject({ method: 'POST', url: '/players', cookies, payload: { name: 'Fay' } })
    const eve = await app.inject({ method: 'POST', url: '/players', cookies, payload: { name: 'Gia' } })
    const fayId = dana.json<{ id: string }>().id
    const giaId = eve.json<{ id: string }>().id

    const beforeMatch = await app.inject({ method: 'GET', url: '/players', cookies })
    const fayBefore = beforeMatch.json<Array<{ id: string; lastPlayedAt: string | null }>>().find(
      (p) => p.id === fayId,
    )
    expect(fayBefore?.lastPlayedAt).toBeNull()

    await app.inject({
      method: 'POST',
      url: '/matches',
      cookies,
      payload: { id: randomUUID(), homePlayerId: fayId, awayPlayerId: giaId, homeScore: 1, awayScore: 0 },
    })

    const afterMatch = await app.inject({ method: 'GET', url: '/players', cookies })
    const fayAfter = afterMatch.json<Array<{ id: string; lastPlayedAt: string | null }>>().find(
      (p) => p.id === fayId,
    )
    expect(fayAfter?.lastPlayedAt).not.toBeNull()

    await app.close()
  })
})

describe('PATCH /players/:id', () => {
  it('updates fields and returns 404 for an unknown id', async () => {
    const app = buildTestApp(db)
    const created = await app.inject({
      method: 'POST',
      url: '/players',
      cookies,
      payload: { name: 'Frank' },
    })
    const id = created.json<{ id: string }>().id

    const updated = await app.inject({
      method: 'PATCH',
      url: `/players/${id}`,
      cookies,
      payload: { name: 'Franklin' },
    })
    expect(updated.json()).toMatchObject({ name: 'Franklin' })

    const missing = await app.inject({
      method: 'PATCH',
      url: '/players/00000000-0000-7000-8000-000000000000',
      cookies,
      payload: { name: 'Nobody' },
    })
    expect(missing.statusCode).toBe(404)

    await app.close()
  })
})

describe('GET /players/:id', () => {
  it('returns a profile for an unplayed player at baseline rating', async () => {
    const app = buildTestApp(db)
    const created = await app.inject({
      method: 'POST',
      url: '/players',
      cookies,
      payload: { name: 'Grace' },
    })
    const id = created.json<{ id: string }>().id

    const response = await app.inject({ method: 'GET', url: `/players/${id}`, cookies })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ createdAt: string }>()
    expect(body).toMatchObject({
      name: 'Grace',
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      streak: null,
    })
    expect(new Date(body.createdAt).toString()).not.toBe('Invalid Date')

    await app.close()
  })

  it('returns 404 for an unknown player', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/players/00000000-0000-7000-8000-000000000000',
      cookies,
    })
    expect(response.statusCode).toBe(404)

    await app.close()
  })
})
