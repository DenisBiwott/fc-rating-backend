import { eq } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import { players } from '../schema.js'

export type PlayerRow = typeof players.$inferSelect

export async function findPlayerById(db: Queryable, id: string): Promise<PlayerRow | undefined> {
  const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1)
  return row
}
