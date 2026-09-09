import { eq } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import { players } from '../schema.js'

export type PlayerRow = typeof players.$inferSelect
export type NewPlayerRow = typeof players.$inferInsert

export async function findPlayerById(db: Queryable, id: string): Promise<PlayerRow | undefined> {
  const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1)
  return row
}

export async function insertPlayer(db: Queryable, row: NewPlayerRow): Promise<PlayerRow> {
  const [inserted] = await db.insert(players).values(row).returning()
  if (inserted === undefined) throw new Error('insertPlayer: insert returned no row')
  return inserted
}

export async function listPlayers(
  db: Queryable,
  filter: { active?: boolean } = {},
): Promise<PlayerRow[]> {
  if (filter.active === undefined) return db.select().from(players).orderBy(players.name)
  return db
    .select()
    .from(players)
    .where(eq(players.isActive, filter.active))
    .orderBy(players.name)
}

export interface PlayerPatch {
  name?: string
  avatarUrl?: string | null
  isActive?: boolean
}

export async function updatePlayerRow(
  db: Queryable,
  id: string,
  patch: PlayerPatch,
): Promise<PlayerRow | undefined> {
  const [row] = await db
    .update(players)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(players.id, id))
    .returning()
  return row
}

export async function deletePlayerRow(db: Queryable, id: string): Promise<void> {
  await db.delete(players).where(eq(players.id, id))
}
