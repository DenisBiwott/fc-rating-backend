import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/app/types.js'
import { hashPassword } from '../../src/infra/auth/password.js'
import { users } from '../../src/infra/db/schema.js'
import { systemIds } from '../../src/infra/ids.js'
import { createTestDb, type TestDb } from '../integration/helpers/test-db.js'
import { buildTestApp } from './helpers/app.js'

let testDb: TestDb
let db: Database

const ADMIN_PASSWORD = 'correct horse battery staple'

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  await db.insert(users).values({
    id: systemIds.newId(),
    name: 'Admin',
    role: 'admin',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
  })
})

afterAll(async () => {
  await testDb.teardown()
})

describe('POST /auth/login', () => {
  it('sets a session cookie and returns the user on a correct password', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: ADMIN_PASSWORD },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ user: { name: 'Admin', role: 'admin' } })
    expect(response.cookies.some((cookie) => cookie.name === 'fc_session')).toBe(true)

    await app.close()
  })

  it('returns 401 on a wrong password', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'wrong' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('returns 400 on a missing password', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: {} })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ type: 'validation-error' })

    await app.close()
  })
})

describe('GET /auth/me', () => {
  it('returns 401 with no session cookie', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'GET', url: '/auth/me' })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('returns the logged-in user after login', async () => {
    const app = buildTestApp(db)
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: ADMIN_PASSWORD },
    })
    const cookie = loginResponse.cookies.find((c) => c.name === 'fc_session')
    if (cookie === undefined) throw new Error('login did not set a session cookie')

    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [cookie.name]: cookie.value },
    })

    expect(meResponse.statusCode).toBe(200)
    expect(meResponse.json()).toMatchObject({ user: { name: 'Admin', role: 'admin' } })

    await app.close()
  })
})

describe('POST /auth/logout', () => {
  it('clears the session cookie', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({ method: 'POST', url: '/auth/logout' })

    expect(response.statusCode).toBe(204)
    const cookie = response.cookies.find((c) => c.name === 'fc_session')
    expect(cookie?.value).toBe('')

    await app.close()
  })
})

describe('role enforcement', () => {
  it('rejects an unsigned/tampered cookie the same as no cookie', async () => {
    const app = buildTestApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { fc_session: 'not-a-real-signed-value' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})
