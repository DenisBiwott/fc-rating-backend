import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../integration/helpers/test-db.js'
import { buildTestApp } from './helpers/app.js'

let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb()
})

afterAll(async () => {
  await testDb.teardown()
})

describe('GET /health', () => {
  it('returns ok when the database is reachable', async () => {
    const app = buildTestApp(testDb.db)
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' })

    await app.close()
  })
})

describe('unmatched routes', () => {
  it('returns an RFC 9457 problem body', async () => {
    const app = buildTestApp(testDb.db)
    const response = await app.inject({ method: 'GET', url: '/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.json()).toMatchObject({ status: 404, type: 'not-found' })

    await app.close()
  })
})
