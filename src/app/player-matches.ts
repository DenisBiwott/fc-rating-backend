import type { EffectiveMatch } from '../domain/match/types.js'
import { effectiveMatchesForPlayer } from '../infra/db/queries/match-effective.js'
import { findPlayerById } from '../infra/db/queries/players.js'
import { PlayerNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export interface PlayerMatchesInput {
  playerId: string
  cursor?: number
  limit?: number
}

export interface PlayerMatchesResult {
  items: readonly EffectiveMatch[]
  nextCursor: number | null
}

const DEFAULT_LIMIT = 25

/**
 * Newest-first, cursor-paginated in memory over effectiveMatchesForPlayer's full (ascending,
 * non-void) result — fine at friend-group scale, per docs/ARCHITECTURE.md#concurrency-model's
 * "just replay everything" precedent. A SQL-level paginated query is the fix if this ever stops
 * being cheap.
 */
export async function playerMatches(
  deps: Deps,
  input: PlayerMatchesInput,
): Promise<PlayerMatchesResult> {
  const player = await findPlayerById(deps.db, input.playerId)
  if (player === undefined) throw new PlayerNotFoundError(input.playerId)

  const limit = input.limit ?? DEFAULT_LIMIT
  const { cursor } = input
  const all = await effectiveMatchesForPlayer(deps.db, input.playerId)
  const newestFirst = [...all].reverse()
  const afterCursor =
    cursor === undefined ? newestFirst : newestFirst.filter((match) => match.sequence < cursor)

  const items = afterCursor.slice(0, limit)
  const nextCursor = afterCursor.length > limit ? (items[items.length - 1]?.sequence ?? null) : null

  return { items, nextCursor }
}
