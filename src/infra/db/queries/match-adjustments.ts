import type { Transaction } from '../../../app/types.js'
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
