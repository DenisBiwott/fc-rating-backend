import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import { sessions } from '../schema.js'

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert

export async function insertSession(db: Queryable, row: NewSessionRow): Promise<SessionRow> {
  const [inserted] = await db.insert(sessions).values(row).returning()
  if (inserted === undefined) throw new Error('insertSession: insert returned no row')
  return inserted
}

export async function findSessionById(db: Queryable, id: string): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
  return row
}

export async function findCurrentSession(db: Queryable): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(sessions).where(isNull(sessions.endedAt)).limit(1)
  return row
}

/**
 * The open session if there is one, else the most recently started closed one — what "the current
 * table" means for the leaderboard. `id` (UUID v7, time-ordered) breaks a startedAt tie.
 */
export async function findLatestSession(db: Queryable): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .orderBy(sql`${sessions.endedAt} is null desc`, desc(sessions.startedAt), desc(sessions.id))
    .limit(1)
  return row
}

export async function listSessions(db: Queryable): Promise<SessionRow[]> {
  return db.select().from(sessions).orderBy(desc(sessions.startedAt))
}

/** Returns undefined when no session has this id. */
export async function renameSessionRow(
  db: Queryable,
  id: string,
  name: string,
): Promise<SessionRow | undefined> {
  const [row] = await db.update(sessions).set({ name }).where(eq(sessions.id, id)).returning()
  return row
}

/** Only closes a still-open session — returns undefined if it's already closed (or doesn't exist), so the caller can tell those two cases apart. */
export async function closeSessionRow(
  db: Queryable,
  id: string,
  endedAt: Date,
): Promise<SessionRow | undefined> {
  const [row] = await db
    .update(sessions)
    .set({ endedAt })
    .where(and(eq(sessions.id, id), isNull(sessions.endedAt)))
    .returning()
  return row
}
