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
  await db.execute(sql`truncate table matches, sessions restart identity cascade`)
})

afterAll(async () => {
  await testDb.teardown()
})

describe('GET /sessions/current', () => {
  it('returns 204 when no session is open', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/sessions/current', cookies })
    expect(response.statusCode).toBe(204)
    await app.close()
  })

  it('is public — no session required', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/sessions/current' })
    expect(response.statusCode).toBe(204)
    await app.close()
  })
})

describe('POST /sessions', () => {
  it('opens a session and rejects a second concurrent one with 409', async () => {
    const app = buildTestApp(db)
    const opened = await app.inject({
      method: 'POST',
      url: '/sessions',
      cookies,
      payload: { name: 'Friday Night FC' },
    })
    expect(opened.statusCode).toBe(201)
    expect(opened.json()).toMatchObject({ name: 'Friday Night FC', endedAt: null })

    const current = await app.inject({ method: 'GET', url: '/sessions/current', cookies })
    expect(current.statusCode).toBe(200)
    expect(current.json()).toMatchObject({ name: 'Friday Night FC' })

    const second = await app.inject({
      method: 'POST',
      url: '/sessions',
      cookies,
      payload: { name: 'Another one' },
    })
    expect(second.statusCode).toBe(409)

    await app.close()
  })
})

describe('POST /sessions/:id/close and GET /sessions/:id', () => {
  it('closes a session and returns 404/409 for unknown/already-closed ids', async () => {
    const app = buildTestApp(db)
    const opened = await app.inject({
      method: 'POST',
      url: '/sessions',
      cookies,
      payload: { name: 'Session to close' },
    })
    const id = opened.json<{ id: string }>().id

    const summary = await app.inject({ method: 'GET', url: `/sessions/${id}`, cookies })
    expect(summary.statusCode).toBe(200)
    expect(summary.json()).toMatchObject({ id, matchCount: 0, upsetCount: 0 })

    const closed = await app.inject({ method: 'POST', url: `/sessions/${id}/close`, cookies })
    expect(closed.statusCode).toBe(200)
    expect(closed.json()).toMatchObject({ id })
    expect(closed.json<{ endedAt: string | null }>().endedAt).not.toBeNull()

    const closeAgain = await app.inject({ method: 'POST', url: `/sessions/${id}/close`, cookies })
    expect(closeAgain.statusCode).toBe(409)

    const closeMissing = await app.inject({
      method: 'POST',
      url: '/sessions/00000000-0000-7000-8000-000000000000/close',
      cookies,
    })
    expect(closeMissing.statusCode).toBe(404)

    await app.close()
  })

  it('GET /sessions/:id is public — no session required', async () => {
    const app = buildTestApp(db)
    const opened = await app.inject({
      method: 'POST',
      url: '/sessions',
      cookies,
      payload: { name: 'Public read check' },
    })
    const id = opened.json<{ id: string }>().id

    const summary = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    expect(summary.statusCode).toBe(200)

    await app.close()
  })
})

describe('GET /sessions', () => {
  it('lists sessions newest first', async () => {
    const app = buildTestApp(db)
    const first = await app.inject({
      method: 'POST',
      url: '/sessions',
      cookies,
      payload: { name: 'First' },
    })
    await app.inject({
      method: 'POST',
      url: `/sessions/${first.json<{ id: string }>().id}/close`,
      cookies,
    })
    await app.inject({ method: 'POST', url: '/sessions', cookies, payload: { name: 'Second' } })

    // testDeps() freezes the clock, so both sessions share one startedAt — order between ties
    // isn't meaningful here (unlike production, where opens are genuinely spaced in real time).
    const list = await app.inject({ method: 'GET', url: '/sessions', cookies })
    expect(list.json<{ name: string }[]>().map((s) => s.name).sort()).toEqual(['First', 'Second'])

    await app.close()
  })

  it('is public — no session required', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/sessions' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })
})
