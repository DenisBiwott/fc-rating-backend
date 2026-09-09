import type { FastifyInstance } from 'fastify'
import type { Database } from '../../../src/app/types.js'
import { hashPassword } from '../../../src/infra/auth/password.js'
import { users } from '../../../src/infra/db/schema.js'
import { systemIds } from '../../../src/infra/ids.js'

export const TEST_ADMIN_PASSWORD = 'correct horse battery staple'

export async function seedAdmin(db: Database): Promise<void> {
  await db.insert(users).values({
    id: systemIds.newId(),
    name: 'Admin',
    role: 'admin',
    passwordHash: await hashPassword(TEST_ADMIN_PASSWORD),
  })
}

/** Logs in against the already-built app and returns a Cookie header value for authenticated requests. */
export async function loginAsAdmin(app: FastifyInstance): Promise<Record<string, string>> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { password: TEST_ADMIN_PASSWORD },
  })
  const cookie = response.cookies.find((c) => c.name === 'fc_session')
  if (cookie === undefined) throw new Error('login did not set a session cookie')
  return { [cookie.name]: cookie.value }
}
