import { and, eq, inArray } from 'drizzle-orm'
import type { Queryable, Transaction } from '../../../app/types.js'
import { matches, ratingSnapshots } from '../schema.js'

export type MatchRow = typeof matches.$inferSelect
export type SnapshotRow = typeof ratingSnapshots.$inferSelect
export type NewMatchRow = typeof matches.$inferInsert
export type NewSnapshotRow = typeof ratingSnapshots.$inferInsert

export async function findMatchById(db: Queryable, id: string): Promise<MatchRow | undefined> {
  const [row] = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return row
}

export async function insertMatch(tx: Transaction, input: NewMatchRow): Promise<MatchRow> {
  const [row] = await tx.insert(matches).values(input).returning()
  if (row === undefined) throw new Error('insertMatch: insert returned no row')
  return row
}

export async function insertSnapshots(
  tx: Transaction,
  rows: readonly NewSnapshotRow[],
): Promise<void> {
  await tx.insert(ratingSnapshots).values(rows as NewSnapshotRow[])
}

export async function snapshotsForMatch(
  db: Queryable,
  configId: string,
  matchId: string,
): Promise<SnapshotRow[]> {
  return db
    .select()
    .from(ratingSnapshots)
    .where(and(eq(ratingSnapshots.configId, configId), eq(ratingSnapshots.matchId, matchId)))
}

export async function snapshotsForMatches(
  db: Queryable,
  configId: string,
  matchIds: readonly string[],
): Promise<SnapshotRow[]> {
  if (matchIds.length === 0) return []
  return db
    .select()
    .from(ratingSnapshots)
    .where(and(eq(ratingSnapshots.configId, configId), inArray(ratingSnapshots.matchId, matchIds)))
}
