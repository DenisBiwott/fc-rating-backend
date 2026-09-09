import { eq } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import { users } from '../schema.js'

export type UserRow = typeof users.$inferSelect

/** Single shared admin login (see docs/API.md#auth) — at MVP there is exactly one user row. */
export async function findAdminUser(db: Queryable): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1)
  return row
}
