import {
  listEffectiveMatches,
  type EffectiveMatchDetail,
} from '../infra/db/queries/match-effective.js'
import type { Deps } from './types.js'

export interface ListMatchesInput {
  sessionId?: string
  playerId?: string
  includeVoided?: boolean
  cursor?: number
  limit?: number
}

export interface ListMatchesResult {
  items: readonly EffectiveMatchDetail[]
  nextCursor: number | null
}

const DEFAULT_LIMIT = 25

export async function listMatches(
  deps: Deps,
  input: ListMatchesInput = {},
): Promise<ListMatchesResult> {
  const limit = input.limit ?? DEFAULT_LIMIT
  const rows = await listEffectiveMatches(deps.db, { ...input, limit })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? (items[items.length - 1]?.sequence ?? null) : null

  return { items, nextCursor }
}
