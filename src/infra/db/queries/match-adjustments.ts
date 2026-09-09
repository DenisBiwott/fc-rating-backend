import { eq } from 'drizzle-orm'
import type { Queryable, Transaction } from '../../../app/types.js'
import { matchAdjustments } from '../schema.js'

export type NewAdjustmentRow = typeof matchAdjustments.$inferInsert
export type AdjustmentRow = typeof matchAdjustments.$inferSelect

export async function insertAdjustment(
  tx: Transaction,
  row: NewAdjustmentRow,
): Promise<AdjustmentRow> {
  const [inserted] = await tx.insert(matchAdjustments).values(row).returning()
  if (inserted === undefined) throw new Error('insertAdjustment: insert returned no row')
  return inserted
}

/** Full adjustment history for one match, oldest first — powers GET /matches/:id. */
export async function adjustmentsForMatch(
  db: Queryable,
  matchId: string,
): Promise<AdjustmentRow[]> {
  return db
    .select()
    .from(matchAdjustments)
    .where(eq(matchAdjustments.matchId, matchId))
    .orderBy(matchAdjustments.sequence)
}
