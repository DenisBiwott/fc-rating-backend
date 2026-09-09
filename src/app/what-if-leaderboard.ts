import { rankPlayers } from '../domain/leaderboard/compute.js'
import type { RankedPlayer } from '../domain/leaderboard/types.js'
import { toMatchInput } from '../domain/match/result.js'
import { replay } from '../domain/rating/engine.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { getRatingConfigById } from '../infra/db/queries/rating-configs.js'
import type { Deps } from './types.js'

export interface WhatIfLeaderboardResult {
  configId: string
  entries: readonly RankedPlayer[]
}

/**
 * Replays the full effective match log through an arbitrary config WITHOUT persisting anything —
 * the what-if view (post-MVP UI, API available from day one per design doc §6). Reuses the same
 * pure `replay()` the persisting path (src/app/replay.ts) wraps, just without the transaction,
 * advisory lock, or snapshot writes.
 *
 * Unlike leaderboard(), a player who has never played doesn't appear here (no baseline entry) —
 * replay() only ever produces table rows for players it actually folded a match for, and a
 * what-if comparison is about rating trajectories, not a full roster view.
 */
export async function whatIfLeaderboard(
  deps: Deps,
  configId: string,
): Promise<WhatIfLeaderboardResult> {
  const { config } = await getRatingConfigById(deps.db, configId)
  const effectiveMatches = (await allEffectiveMatches(deps.db)).filter((match) => !match.isVoid)
  const { table } = replay(effectiveMatches.map(toMatchInput), config)

  const ratedPlayers = [...table.entries()].map(([playerId, state]) => ({
    playerId,
    rating: state.rating,
    gamesPlayed: state.gamesPlayed,
  }))

  return { configId, entries: rankPlayers(ratedPlayers) }
}
